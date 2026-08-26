use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub system_prompt: String,
    pub include_mic: bool,
    pub whisper_cli_path: String,
    pub whisper_model_path: String,
    pub whisper_language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
            system_prompt: "你是会议助手。用户会提供会议录音转写文本，请用简洁中文帮助总结要点、待办，或回答用户追问。".into(),
            include_mic: false,
            whisper_cli_path: String::new(),
            whisper_model_path: String::new(),
            whisper_language: "zh".into(),
        }
    }
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return Settings::default();
    };
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => {
            let settings = Settings::default();
            let _ = save_settings(app, &settings);
            settings
        }
    }
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化设置失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入设置失败: {e}"))
}
