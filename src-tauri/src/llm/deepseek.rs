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
