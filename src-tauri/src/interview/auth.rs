use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewAccount {
    pub user_id: String,
    pub email: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
struct AuthJson {
    #[serde(rename = "Success")]
    success: Option<bool>,
    #[serde(rename = "ErrorMessage")]
    error_message: Option<String>,
    #[serde(rename = "Token")]
    token: Option<String>,
    #[serde(rename = "UserId")]
    user_id: Option<String>,
    #[serde(rename = "Email")]
    email: Option<String>,
}

pub fn action_url(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

pub fn require_login_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        Err("请先登录后再开面".into())
    } else {
        Ok(())
    }
}

pub fn validate_email(email: &str) -> Result<String, String> {
    let email = email.trim().to_lowercase();
    let ok = email.contains('@')
        && email.contains('.')
        && !email.starts_with('@')
        && !email.ends_with('@')
        && email.split('@').count() == 2;
    if ok {
        Ok(email)
    } else {
        Err("邮箱格式不正确".into())
    }
}

pub fn validate_register(email: &str, password: &str, code: &str) -> Result<(), String> {
    validate_email(email)?;
    if password.len() < 6 {
        return Err("密码至少 6 位".into());
    }
    if code.trim().is_empty() {
        return Err("验证码不能为空".into());
    }
    Ok(())
}

fn post_action(base_url: &str, body: serde_json::Value) -> Result<AuthJson, String> {
    let url = action_url(base_url);
    if url.is_empty() {
        return Err("请先在设置中填写接口地址".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("无法创建请求: {e}"))?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    resp.json()
        .map_err(|e| format!("响应无法解析: {e}"))
}

fn unwrap_ok(data: AuthJson, fallback: &str) -> Result<AuthJson, String> {
    if data.success != Some(true) {
        return Err(data
            .error_message
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback.to_string()));
    }
    Ok(data)
}

fn account_from(data: AuthJson, email: &str) -> Result<InterviewAccount, String> {
    let token = data.token.unwrap_or_default();
    if token.is_empty() {
        return Err("成功但未返回令牌".into());
    }
    Ok(InterviewAccount {
        user_id: data.user_id.unwrap_or_default(),
        email: data.email.unwrap_or_else(|| email.to_string()),
        token,
    })
}

pub fn login(base_url: &str, email: &str, password: &str) -> Result<InterviewAccount, String> {
    let email = validate_email(email)?;
    if password.is_empty() {
        return Err("请输入邮箱和密码".into());
    }
    let data = post_action(
        base_url,
        serde_json::json!({
            "Action": "UserLogin",
            "Email": email,
            "Password": password,
        }),
    )?;
    account_from(unwrap_ok(data, "邮箱或密码错误")?, &email)
}

pub fn send_email_code(base_url: &str, email: &str, purpose: &str) -> Result<String, String> {
    let email = validate_email(email)?;
    let purpose = if purpose == "reset" { "reset" } else { "register" };
    let data = post_action(
        base_url,
        serde_json::json!({
            "Action": "SendEmailCode",
            "Email": email,
            "Purpose": purpose,
        }),
    )?;
    let data = unwrap_ok(data, "发送验证码失败")?;
    Ok(data
        .error_message
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "验证码已发送".into()))
}

pub fn register(
    base_url: &str,
    email: &str,
    password: &str,
    code: &str,
) -> Result<InterviewAccount, String> {
    validate_register(email, password, code)?;
    let email = validate_email(email)?;
    let data = post_action(
        base_url,
        serde_json::json!({
            "Action": "UserRegister",
            "Email": email,
            "Password": password,
            "Code": code.trim(),
        }),
    )?;
    account_from(unwrap_ok(data, "注册失败")?, &email)
}

pub fn reset_password(
    base_url: &str,
    email: &str,
    password: &str,
    code: &str,
) -> Result<String, String> {
    validate_register(email, password, code)?;
    let email = validate_email(email)?;
    let data = post_action(
        base_url,
        serde_json::json!({
            "Action": "ResetPassword",
            "Email": email,
            "Password": password,
            "Code": code.trim(),
        }),
    )?;
    let data = unwrap_ok(data, "重置失败")?;
    Ok(data
        .error_message
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "密码已重置，请使用新密码登录".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_url_strips_slash() {
        assert_eq!(action_url("http://127.0.0.1:9541/"), "http://127.0.0.1:9541");
        assert_eq!(action_url("  http://127.0.0.1:9541  "), "http://127.0.0.1:9541");
    }

    #[test]
    fn empty_token_requires_login() {
        assert!(require_login_token("").is_err());
        assert!(require_login_token("  ").is_err());
        assert!(require_login_token("jwt").is_ok());
    }

    #[test]
    fn register_requires_code_and_password() {
        assert_eq!(
            validate_register("a@example.com", "secret1", ""),
            Err("验证码不能为空".into())
        );
        assert_eq!(
            validate_register("a@example.com", "123", "111111"),
            Err("密码至少 6 位".into())
        );
        assert_eq!(
            validate_register("bad", "secret1", "111111"),
            Err("邮箱格式不正确".into())
        );
        assert!(validate_register("user@163.com", "secret1", "111111").is_ok());
    }

    #[test]
    fn send_code_rejects_bad_email() {
        assert_eq!(
            validate_email("not-an-email"),
            Err("邮箱格式不正确".into())
        );
        assert!(validate_email("a@example.com").is_ok());
    }
}
