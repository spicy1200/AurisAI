use crate::config::Settings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
}

pub struct DeepSeekClient;

impl DeepSeekClient {
    pub fn send(
        settings: &Settings,
        history: &mut Vec<ChatMessage>,
        user_content: String,
    ) -> Result<String, String> {
        if settings.api_key.trim().is_empty() {
            return Err("请先在设置中配置 DeepSeek API Key".into());
        }

        if history.is_empty() {
            history.push(ChatMessage {
                role: "system".into(),
                content: settings.system_prompt.clone(),
            });
        }

        history.push(ChatMessage {
            role: "user".into(),
            content: user_content,
        });

        let reply = match Self::chat_once(settings, &history.clone()) {
            Ok(r) => r,
            Err(e) => {
                history.pop();
                return Err(e);
            }
        };

        history.push(ChatMessage {
            role: "assistant".into(),
            content: reply.clone(),
        });

        Ok(reply)
    }

    /// One-shot correction of ASR text; does not touch chat history.
    pub fn polish_transcript(settings: &Settings, rough: &str) -> Result<String, String> {
        if settings.api_key.trim().is_empty() {
            return Err("请先在设置中配置 DeepSeek API Key".into());
        }
        let rough = rough.trim();
        if rough.is_empty() {
            return Err("没有可校对的转写文本".into());
        }
        let messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "你是中文语音转写校对助手。用户会给你一段可能有同音错字、断句错误的会议转写草稿。请结合语境修正为通顺、准确的简体中文。要求：1) 尽量保留原意，不要编造未出现的关键信息；2) 只输出修正后的正文，不要解释。".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: format!("请校对下面的会议转写草稿：\n\n{rough}"),
            },
        ];
        Self::chat_once(settings, &messages)
    }

    fn chat_once(settings: &Settings, messages: &[ChatMessage]) -> Result<String, String> {
        let base = settings.base_url.trim_end_matches('/');
        let url = format!("{base}/chat/completions");

        let body = ChatRequest {
            model: settings.model.clone(),
            messages: messages.to_vec(),
            stream: false,
        };

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

        let resp = client
            .post(&url)
            .bearer_auth(settings.api_key.trim())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("请求 DeepSeek 失败: {e}"))?;

        let status = resp.status();
        let text = resp
            .text()
            .map_err(|e| format!("读取响应失败: {e}"))?;

        if !status.is_success() {
            return Err(format!("DeepSeek 错误 ({status}): {text}"));
        }

        let parsed: ChatResponse =
            serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}\n{text}"))?;
        Ok(parsed
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default())
    }
}
