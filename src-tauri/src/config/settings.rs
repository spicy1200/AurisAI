use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub interview_ws_url: String,
    pub interview_token: String,
    pub interview_email: String,
    pub api_http_url: String,
    pub mic_device_id: String,
    pub system_audio_device_id: String,
    /// action id -> accelerator, e.g. "answer" -> "Ctrl+Alt+A"
    pub shortcuts: HashMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interview_ws_url: "ws://127.0.0.1:8089/ws/interview".into(),
            interview_token: String::new(),
            interview_email: String::new(),
            api_http_url: "http://127.0.0.1:8089".into(),
            mic_device_id: String::new(),
            system_audio_device_id: String::new(),
            shortcuts: crate::shortcuts::default_bindings(),
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
        Ok(raw) => {
            let mut settings: Settings = serde_json::from_str(&raw).unwrap_or_default();
            if settings.shortcuts.is_empty() {
                settings.shortcuts = crate::shortcuts::default_bindings();
            } else {
                settings.shortcuts = crate::shortcuts::merge_bindings(&settings.shortcuts);
            }
            if remap_legacy_local_ports(&mut settings) {
                let _ = save_settings(app, &settings);
            }
            settings
        }
        Err(_) => {
            let settings = Settings::default();
            let _ = save_settings(app, &settings);
            settings
        }
    }
}

fn remap_legacy_local_ports(settings: &mut Settings) -> bool {
    let mut changed = false;
    let http = settings.api_http_url.trim().trim_end_matches('/');
    if http == "http://127.0.0.1:9541" {
        settings.api_http_url = "http://127.0.0.1:8089".into();
        changed = true;
    }
    if settings.interview_ws_url.trim() == "ws://127.0.0.1:9541/ws/interview" {
        settings.interview_ws_url = "ws://127.0.0.1:8089/ws/interview".into();
        changed = true;
    }
    changed
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化设置失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入设置失败: {e}"))
}
