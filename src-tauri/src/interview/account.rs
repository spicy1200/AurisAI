use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMeta {
    pub model: String,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewMaterials {
    pub resume: String,
    pub jd: String,
    pub ready: bool,
    pub profile_name: String,
    pub language: String,
    pub skills: String,
    #[serde(default)]
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewProfileSummary {
    pub id: String,
    pub name: String,
    pub language: String,
    pub ready: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewAnswer {
    pub question: String,
    pub answer: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewRound {
    pub id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewMe {
    pub user_id: String,
    pub email: String,
    pub balance_minutes: i32,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(rename = "Success")]
    success: Option<bool>,
    #[serde(rename = "ErrorMessage")]
    error_message: Option<String>,
    #[serde(rename = "ErrorCode")]
    error_code: Option<String>,
    #[serde(rename = "Model")]
    model: Option<String>,
    #[serde(rename = "Configured")]
    configured: Option<bool>,
    #[serde(rename = "SessionId")]
    session_id: Option<String>,
    #[serde(rename = "Title")]
    title: Option<String>,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
    #[serde(rename = "UpdatedAt")]
    updated_at: Option<String>,
    #[serde(rename = "Reply")]
    reply: Option<String>,
    #[serde(rename = "Sessions")]
    sessions: Option<Vec<SessionJson>>,
    #[serde(rename = "Messages")]
    messages: Option<Vec<MessageJson>>,
    #[serde(rename = "Resume")]
    resume: Option<String>,
    #[serde(rename = "Jd")]
    jd: Option<String>,
    #[serde(rename = "Ready")]
    ready: Option<bool>,
    #[serde(rename = "RoundId")]
    round_id: Option<String>,
    #[serde(rename = "Answer")]
    answer: Option<String>,
    #[serde(rename = "Question")]
    question: Option<String>,
    #[serde(rename = "Answers")]
    answers: Option<Vec<AnswerJson>>,
    #[serde(rename = "Rounds")]
    rounds: Option<Vec<RoundJson>>,
    #[serde(rename = "UserId")]
    user_id: Option<String>,
    #[serde(rename = "Email")]
    email: Option<String>,
    #[serde(rename = "BalanceMinutes")]
    balance_minutes: Option<i32>,
    #[serde(rename = "ProfileName")]
    profile_name: Option<String>,
    #[serde(rename = "Language")]
    language: Option<String>,
    #[serde(rename = "Skills")]
    skills: Option<String>,
    #[serde(rename = "ProfileId")]
    profile_id: Option<String>,
    #[serde(rename = "Profiles")]
    profiles: Option<Vec<ProfileJson>>,
}

#[derive(Debug, Deserialize)]
struct ProfileJson {
    #[serde(rename = "ProfileId")]
    profile_id: String,
    #[serde(rename = "ProfileName")]
    profile_name: Option<String>,
    #[serde(rename = "Language")]
    language: Option<String>,
    #[serde(rename = "Ready")]
    ready: Option<bool>,
    #[serde(rename = "IsActive")]
    is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SessionJson {
    #[serde(rename = "SessionId")]
    session_id: String,
    #[serde(rename = "Title")]
    title: Option<String>,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
    #[serde(rename = "UpdatedAt")]
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageJson {
    #[serde(rename = "Role")]
    role: String,
    #[serde(rename = "Content")]
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnswerJson {
    #[serde(rename = "Question")]
    question: String,
    #[serde(rename = "Answer")]
    answer: String,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RoundJson {
    #[serde(rename = "RoundId")]
    round_id: String,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
}

fn action_url(base: &str) -> String {
    crate::interview::auth::action_url(base)
}

pub const AUTH_EXPIRED_MSG: &str = "登录已过期，请重新登录";

fn looks_like_auth_failure(error_code: Option<&str>, error_message: Option<&str>) -> bool {
    let code = error_code.unwrap_or("").to_ascii_lowercase();
    let msg = error_message.unwrap_or("").to_ascii_lowercase();
    code.contains("authorization")
        || msg.contains("authorization verify failed")
        || msg.contains("token has expired")
        || msg.contains("invalid token")
        || msg.contains("登录已过期")
        || msg.contains("请先登录")
        || msg.contains("未登录")
}

fn post_authed(
    base_url: &str,
    token: &str,
    body: serde_json::Value,
    timeout_secs: u64,
) -> Result<Envelope, String> {
    crate::interview::auth::require_login_token(token)?;
    let url = action_url(base_url);
    if url.is_empty() {
        return Err("请先在设置中填写接口地址".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("无法创建请求: {e}"))?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token.trim()))
        .json(&body)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let status_u = status.as_u16();
    let text = resp
        .text()
        .map_err(|e| format!("读取响应失败: {e}"))?;
    if status == reqwest::StatusCode::UNAUTHORIZED || status_u == 215 {
        return Err(AUTH_EXPIRED_MSG.into());
    }
    let data: Envelope =
        serde_json::from_str(&text).map_err(|e| format!("响应无法解析: {e}"))?;
    if looks_like_auth_failure(
        data.error_code.as_deref(),
        data.error_message.as_deref(),
    ) {
        return Err(AUTH_EXPIRED_MSG.into());
    }
    Ok(data)
}

fn unwrap(data: Envelope, fallback: &str) -> Result<Envelope, String> {
    if data.success != Some(true) {
        if looks_like_auth_failure(
            data.error_code.as_deref(),
            data.error_message.as_deref(),
        ) {
            return Err(AUTH_EXPIRED_MSG.into());
        }
        return Err(data
            .error_message
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback.to_string()));
    }
    Ok(data)
}

pub fn get_llm_meta(base: &str, token: &str) -> Result<LlmMeta, String> {
    let data = unwrap(
        post_authed(base, token, serde_json::json!({ "Action": "GetLlmMeta" }), 20)?,
        "无法读取生成配置",
    )?;
    Ok(LlmMeta {
        model: data.model.unwrap_or_default(),
        configured: data.configured.unwrap_or(false),
    })
}

pub fn list_sessions(base: &str, token: &str) -> Result<Vec<ChatSession>, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "ListChatSessions" }),
            20,
        )?,
        "无法列出闲聊",
    )?;
    Ok(data
        .sessions
        .unwrap_or_default()
        .into_iter()
        .map(|s| ChatSession {
            id: s.session_id,
            title: s.title.unwrap_or_else(|| "新对话".into()),
            created_at: s.created_at.unwrap_or_default(),
            updated_at: s.updated_at.unwrap_or_default(),
        })
        .collect())
}

pub fn create_session(base: &str, token: &str) -> Result<ChatSession, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "CreateChatSession" }),
            20,
        )?,
        "无法新建闲聊",
    )?;
    Ok(ChatSession {
        id: data.session_id.unwrap_or_default(),
        title: data.title.unwrap_or_else(|| "新对话".into()),
        created_at: data.created_at.unwrap_or_default(),
        updated_at: data.updated_at.unwrap_or_default(),
    })
}

pub fn get_session(base: &str, token: &str, session_id: &str) -> Result<Vec<ChatMessage>, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "GetChatSession", "SessionId": session_id }),
            20,
        )?,
        "无法打开闲聊",
    )?;
    Ok(data
        .messages
        .unwrap_or_default()
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect())
}

pub fn delete_session(base: &str, token: &str, session_id: &str) -> Result<(), String> {
    unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "DeleteChatSession", "SessionId": session_id }),
            20,
        )?,
        "无法删除闲聊",
    )?;
    Ok(())
}

pub fn send_chat(base: &str, token: &str, session_id: &str, text: &str) -> Result<(String, String), String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({
                "Action": "SendChatMessage",
                "SessionId": session_id,
                "Text": text,
            }),
            150,
        )?,
        "闲聊生成失败",
    )?;
    Ok((
        data.reply.unwrap_or_default(),
        data.title.unwrap_or_else(|| "新对话".into()),
    ))
}

pub fn get_materials(base: &str, token: &str, profile_id: &str) -> Result<InterviewMaterials, String> {
    let mut body = serde_json::json!({ "Action": "GetInterviewMaterials" });
    if !profile_id.trim().is_empty() {
        body["ProfileId"] = serde_json::json!(profile_id.trim());
    }
    let data = unwrap(post_authed(base, token, body, 20)?, "无法读取简历和职位描述")?;
    Ok(materials_from(data))
}

pub fn list_profiles(base: &str, token: &str) -> Result<Vec<InterviewProfileSummary>, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "ListInterviewProfiles" }),
            20,
        )?,
        "无法列出档案",
    )?;
    Ok(data
        .profiles
        .unwrap_or_default()
        .into_iter()
        .map(|p| InterviewProfileSummary {
            id: p.profile_id,
            name: p
                .profile_name
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "默认档案".into()),
            language: p.language.unwrap_or_default(),
            ready: p.ready.unwrap_or(false),
            is_active: p.is_active.unwrap_or(false),
        })
        .collect())
}

fn materials_from(data: Envelope) -> InterviewMaterials {
    InterviewMaterials {
        resume: data.resume.unwrap_or_default(),
        jd: data.jd.unwrap_or_default(),
        ready: data.ready.unwrap_or(false),
        profile_name: data
            .profile_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "默认档案".into()),
        language: data.language.unwrap_or_default(),
        skills: data.skills.unwrap_or_default(),
        profile_id: data.profile_id.unwrap_or_default(),
    }
}

pub fn save_materials(
    base: &str,
    token: &str,
    resume: &str,
    jd: &str,
    profile_name: &str,
    language: &str,
    skills: &str,
    profile_id: &str,
    create_new: bool,
) -> Result<InterviewMaterials, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({
                "Action": "SaveInterviewMaterials",
                "Resume": resume,
                "Jd": jd,
                "ProfileName": profile_name,
                "Language": language,
                "Skills": skills,
                "ProfileId": profile_id,
                "CreateNew": create_new,
            }),
            20,
        )?,
        "无法保存档案",
    )?;
    Ok(materials_from(data))
}

pub fn delete_profile(base: &str, token: &str, profile_id: &str) -> Result<InterviewMaterials, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({
                "Action": "DeleteInterviewProfile",
                "ProfileId": profile_id,
            }),
            20,
        )?,
        "无法删除档案",
    )?;
    Ok(materials_from(data))
}

pub fn create_round(base: &str, token: &str) -> Result<String, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "CreateInterviewRound" }),
            20,
        )?,
        "无法开场",
    )?;
    data.round_id.filter(|s| !s.is_empty()).ok_or_else(|| "成功但未返回场次".into())
}

pub fn delete_round(base: &str, token: &str, round_id: &str) -> Result<(), String> {
    unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "DeleteInterviewRound", "RoundId": round_id }),
            20,
        )?,
        "无法删除面试场次",
    )?;
    Ok(())
}

pub fn list_rounds(base: &str, token: &str) -> Result<Vec<InterviewRound>, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "ListInterviewRounds" }),
            20,
        )?,
        "无法列出面试场次",
    )?;
    Ok(data
        .rounds
        .unwrap_or_default()
        .into_iter()
        .map(|r| InterviewRound {
            id: r.round_id,
            created_at: r.created_at.unwrap_or_default(),
        })
        .collect())
}

pub fn get_interview_me(base: &str, token: &str) -> Result<InterviewMe, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "InterviewMe" }),
            20,
        )?,
        "无法读取账户",
    )?;
    Ok(InterviewMe {
        user_id: data.user_id.unwrap_or_default(),
        email: data.email.unwrap_or_default(),
        balance_minutes: data.balance_minutes.unwrap_or(0).max(0),
    })
}

pub fn list_answers(base: &str, token: &str, round_id: &str) -> Result<Vec<InterviewAnswer>, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({ "Action": "ListInterviewAnswers", "RoundId": round_id }),
            20,
        )?,
        "无法读取本场出答",
    )?;
    Ok(data
        .answers
        .unwrap_or_default()
        .into_iter()
        .map(|a| InterviewAnswer {
            question: a.question,
            answer: a.answer,
            created_at: a.created_at.unwrap_or_default(),
        })
        .collect())
}

pub fn generate_answer(
    base: &str,
    token: &str,
    round_id: &str,
    question: &str,
) -> Result<InterviewAnswer, String> {
    let data = unwrap(
        post_authed(
            base,
            token,
            serde_json::json!({
                "Action": "GenerateInterviewAnswer",
                "RoundId": round_id,
                "Question": question,
            }),
            150,
        )?,
        "出答生成失败",
    )?;
    Ok(InterviewAnswer {
        question: data.question.unwrap_or_else(|| question.to_string()),
        answer: data.answer.unwrap_or_default(),
        created_at: data.created_at.unwrap_or_default(),
    })
}
