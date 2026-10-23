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

const DEV_API_HTTP_URL: &str = "http://127.0.0.1:8089";
const DEV_INTERVIEW_WS_URL: &str = "ws://127.0.0.1:8089/ws/interview";
const PROD_API_HTTP_URL: &str = "https://aurisai.mmming.cn/interview-api";
const PROD_INTERVIEW_WS_URL: &str = "wss://aurisai.mmming.cn/interview-api/ws/interview";

fn default_api_http_url() -> String {
    if cfg!(debug_assertions) {
        DEV_API_HTTP_URL.into()
    } else {
        PROD_API_HTTP_URL.into()
    }
}

fn default_interview_ws_url() -> String {
    if cfg!(debug_assertions) {
        DEV_INTERVIEW_WS_URL.into()
    } else {
        PROD_INTERVIEW_WS_URL.into()
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interview_ws_url: default_interview_ws_url(),
            interview_token: String::new(),
            interview_email: String::new(),
            api_http_url: default_api_http_url(),
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

fn is_local_api_http(url: &str) -> bool {
    matches!(
        url.trim().trim_end_matches('/'),
        "http://127.0.0.1:8089"
            | "http://127.0.0.1:9541"
            | "http://localhost:8089"
            | "http://localhost:9541"
    )
}

fn is_local_interview_ws(url: &str) -> bool {
    matches!(
        url.trim(),
        "ws://127.0.0.1:8089/ws/interview"
            | "ws://127.0.0.1:9541/ws/interview"
            | "ws://localhost:8089/ws/interview"
            | "ws://localhost:9541/ws/interview"
    )
}

/// Release builds ship with production API. Migrate leftover localhost defaults
/// from older installs so packaged apps do not keep calling 127.0.0.1.
fn remap_legacy_local_ports(settings: &mut Settings) -> bool {
    let mut changed = false;
    if cfg!(debug_assertions) {
        let http = settings.api_http_url.trim().trim_end_matches('/');
        if http == "http://127.0.0.1:9541" {
            settings.api_http_url = DEV_API_HTTP_URL.into();
            changed = true;
        }
        if settings.interview_ws_url.trim() == "ws://127.0.0.1:9541/ws/interview" {
            settings.interview_ws_url = DEV_INTERVIEW_WS_URL.into();
            changed = true;
        }
        return changed;
    }

    if is_local_api_http(&settings.api_http_url) {
        settings.api_http_url = PROD_API_HTTP_URL.into();
        changed = true;
    }
    if is_local_interview_ws(&settings.interview_ws_url) {
        settings.interview_ws_url = PROD_INTERVIEW_WS_URL.into();
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
