mod audio;
mod config;
mod db;
mod detect;
mod llm;
mod stt;

use audio::Recorder;
use config::{load_settings, save_settings, Settings};
use db::{ChatSession, ChatStore};
use llm::{ChatMessage, DeepSeekClient};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub recorder: Mutex<Option<Recorder>>,
    pub messages: Mutex<Vec<ChatMessage>>,
    pub last_transcript: Mutex<String>,
    pub last_recording: Mutex<Option<String>>,
    pub store: ChatStore,
    pub current_session_id: Mutex<Option<String>>,
}

#[derive(Serialize)]
pub struct StopResult {
    pub path: String,
    pub text: String,
    pub stt_error: Option<String>,
    pub quality_hint: Option<String>,
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<AppState>>) -> Settings {
    state.settings.lock().clone()
}

#[tauri::command]
fn save_app_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<(), String> {
    save_settings(&app, &settings)?;
    *state.settings.lock() = settings;
    Ok(())
}

#[tauri::command]
fn start_recording(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut slot = state.recorder.lock();
    if slot.is_some() {
        return Err("已在录音中".into());
    }
    let include_mic = state.settings.lock().include_mic;
    let out_dir = recordings_dir(&app)?;
    let recorder = Recorder::start(include_mic, out_dir).map_err(|e| e.to_string())?;
    *slot = Some(recorder);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<'_, Arc<AppState>>) -> Result<StopResult, String> {
    let recorder = state
        .recorder
        .lock()
        .take()
        .ok_or_else(|| "当前未在录音".to_string())?;

    let path = recorder.stop().map_err(|e| e.to_string())?;
    let path_str = path.display().to_string();
    *state.last_recording.lock() = Some(path_str.clone());

    let settings = state.settings.lock().clone();
    let quality_hint = stt::model_quality_hint(&settings.whisper_model_path);
    match stt::transcribe_file(
        &settings.whisper_cli_path,
        &settings.whisper_model_path,
        &path,
        &settings.whisper_language,
    ) {
        Ok(text) => {
            *state.last_transcript.lock() = text.clone();
            Ok(StopResult {
                path: path_str,
                text,
                stt_error: None,
                quality_hint,
            })
        }
        Err(e) => Ok(StopResult {
            path: path_str,
            text: String::new(),
            stt_error: Some(e),
            quality_hint,
        }),
    }
}

#[tauri::command]
fn test_transcribe(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<StopResult, String> {
    let wav = PathBuf::from(path.trim());
    if path.trim().is_empty() {
        return Err("请先选择要测试的 wav 文件".into());
    }
    if !wav.exists() {
        return Err(format!("文件不存在: {}", wav.display()));
    }
    let settings = state.settings.lock().clone();
    let path_str = wav.display().to_string();
    let quality_hint = stt::model_quality_hint(&settings.whisper_model_path);
    match stt::transcribe_file(
        &settings.whisper_cli_path,
        &settings.whisper_model_path,
        &wav,
        &settings.whisper_language,
    ) {
        Ok(text) => Ok(StopResult {
            path: path_str,
            text,
            stt_error: None,
            quality_hint,
        }),
        Err(e) => Ok(StopResult {
            path: path_str,
            text: String::new(),
            stt_error: Some(e),
            quality_hint,
        }),
    }
}

#[tauri::command]
fn set_transcript(state: State<'_, Arc<AppState>>, text: String) {
    *state.last_transcript.lock() = text;
}

#[tauri::command]
fn polish_transcript(state: State<'_, Arc<AppState>>, text: String) -> Result<String, String> {
    let settings = state.settings.lock().clone();
    let polished = DeepSeekClient::polish_transcript(&settings, &text)?;
    *state.last_transcript.lock() = polished.clone();
    Ok(polished)
}

#[tauri::command]
fn get_last_recording(state: State<'_, Arc<AppState>>) -> Option<String> {
    state.last_recording.lock().clone()
}

#[tauri::command]
fn get_recordings_dir(app: AppHandle) -> Result<String, String> {
    Ok(recordings_dir(&app)?.display().to_string())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开失败: {e}"))
}

#[tauri::command]
fn open_recordings_folder(app: AppHandle) -> Result<(), String> {
    let dir = recordings_dir(&app)?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("打开文件夹失败: {e}"))
}

fn ensure_session(state: &AppState) -> Result<String, String> {
    let mut cur = state.current_session_id.lock();
    if let Some(id) = cur.clone() {
        return Ok(id);
    }
    let session = state.store.create_session(None)?;
    *cur = Some(session.id.clone());
    Ok(session.id)
}

fn persist_current(state: &AppState) -> Result<(), String> {
    let Some(id) = state.current_session_id.lock().clone() else {
        return Ok(());
    };
    let messages = state.messages.lock().clone();
    state.store.save_messages(&id, &messages)
}

#[tauri::command]
fn deepseek_send(
    state: State<'_, Arc<AppState>>,
    text: String,
    include_transcript: bool,
) -> Result<String, String> {
    let _ = ensure_session(&state)?;
    let settings = state.settings.lock().clone();
    let mut content = text.trim().to_string();
    if include_transcript {
        let transcript = state.last_transcript.lock().clone();
        if transcript.trim().is_empty() && content.is_empty() {
            return Err("没有可发送的内容：请先录音转写，或输入追问".into());
        }
        if !transcript.trim().is_empty() {
            content = if content.is_empty() {
                format!("请根据以下会议转写内容总结要点并列出待办：\n\n{transcript}")
            } else {
                format!("会议转写：\n{transcript}\n\n用户请求：\n{content}")
            };
        }
    } else if content.is_empty() {
        return Err("请输入要发送的内容".into());
    }

    let reply = {
        let mut history = state.messages.lock();
        DeepSeekClient::send(&settings, &mut history, content)?
    };
    persist_current(&state)?;
    Ok(reply)
}

#[tauri::command]
fn deepseek_new_session(state: State<'_, Arc<AppState>>) -> Result<ChatSession, String> {
    // Persist previous if any
    let _ = persist_current(&state);
    state.messages.lock().clear();
    let session = state.store.create_session(None)?;
    *state.current_session_id.lock() = Some(session.id.clone());
    Ok(session)
}

#[tauri::command]
fn get_chat_history(state: State<'_, Arc<AppState>>) -> Vec<ChatMessage> {
    state
        .messages
        .lock()
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect()
}

#[tauri::command]
fn list_chat_sessions(state: State<'_, Arc<AppState>>) -> Result<Vec<ChatSession>, String> {
    state.store.list_sessions()
}

#[tauri::command]
fn load_chat_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Vec<ChatMessage>, String> {
    let _ = persist_current(&state);
    let messages = state.store.get_messages(&session_id)?;
    *state.messages.lock() = messages.clone();
    *state.current_session_id.lock() = Some(session_id);
    Ok(messages
        .into_iter()
        .filter(|m| m.role != "system")
        .collect())
}

#[tauri::command]
fn delete_chat_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), String> {
    state.store.delete_session(&session_id)?;
    let mut cur = state.current_session_id.lock();
    if cur.as_deref() == Some(session_id.as_str()) {
        *cur = None;
        state.messages.lock().clear();
    }
    Ok(())
}

#[tauri::command]
fn get_current_session_id(state: State<'_, Arc<AppState>>) -> Option<String> {
    state.current_session_id.lock().clone()
}

#[tauri::command]
fn list_meeting_apps() -> Vec<String> {
    detect::list_meeting_apps()
}

#[tauri::command]
fn is_recording(state: State<'_, Arc<AppState>>) -> bool {
    state.recorder.lock().is_some()
}

fn recordings_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resuorce")
        .join("AurisAI-recordings");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建录音目录失败: {e}"))?;
    std::fs::canonicalize(&dir).or_else(|_| Ok(dir))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = load_settings(app.handle());
            let store = ChatStore::open(db::db_path()).expect("open chat sqlite");
            app.manage(Arc::new(AppState {
                settings: Mutex::new(settings),
                recorder: Mutex::new(None),
                messages: Mutex::new(Vec::new()),
                last_transcript: Mutex::new(String::new()),
                last_recording: Mutex::new(None),
                store,
                current_session_id: Mutex::new(None),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_app_settings,
            start_recording,
            stop_recording,
            test_transcribe,
            set_transcript,
            polish_transcript,
            get_last_recording,
            get_recordings_dir,
            open_path,
            open_recordings_folder,
            deepseek_send,
            deepseek_new_session,
            get_chat_history,
            list_chat_sessions,
            load_chat_session,
            delete_chat_session,
            get_current_session_id,
            list_meeting_apps,
            is_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AurisAI");
}
