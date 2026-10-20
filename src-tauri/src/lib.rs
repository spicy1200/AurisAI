mod audio;
mod capture;
mod config;
mod detect;
mod interview;
mod overlay;
mod shortcuts;

use config::{load_settings, save_settings, Settings};
use interview::account::{
    ChatMessage, ChatSession, InterviewAnswer, InterviewMaterials, InterviewMe, InterviewProfileSummary,
    InterviewRound, LlmMeta,
};
use interview::LiveInterview;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub live: Mutex<Option<LiveInterview>>,
    pub current_round_id: Mutex<Option<String>>,
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<AppState>>) -> Settings {
    state.settings.lock().clone()
}

#[tauri::command]
fn save_app_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    mut settings: Settings,
) -> Result<(), String> {
    // AuthScreen may persist URL/settings while React still has an empty token.
    // Never wipe an already-loaded login that way; logout_interview clears explicitly.
    {
        let current = state.settings.lock();
        if settings.interview_token.trim().is_empty()
            && !current.interview_token.trim().is_empty()
        {
            settings.interview_token = current.interview_token.clone();
            if settings.interview_email.trim().is_empty() {
                settings.interview_email = current.interview_email.clone();
            }
        }
    }
    save_settings(&app, &settings)?;
    *state.settings.lock() = settings;
    Ok(())
}

fn api_creds(state: &AppState) -> Result<(String, String), String> {
    let settings = state.settings.lock();
    interview::auth::require_login_token(&settings.interview_token)?;
    Ok((
        settings.api_http_url.clone(),
        settings.interview_token.clone(),
    ))
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
async fn send_chat_message(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    text: String,
) -> Result<String, String> {
    let (base, token) = api_creds(&state)?;
    let content = text.trim().to_string();
    if content.is_empty() {
        return Err("请输入要发送的内容".into());
    }
    if session_id.trim().is_empty() {
        return Err("请先新建闲聊".into());
    }
    run_blocking(move || {
        let (reply, _) = interview::account::send_chat(&base, &token, &session_id, &content)?;
        Ok(reply)
    })
    .await
}

#[tauri::command]
async fn create_chat_session(state: State<'_, Arc<AppState>>) -> Result<ChatSession, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::create_session(&base, &token)).await
}

#[tauri::command]
async fn list_chat_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ChatSession>, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::list_sessions(&base, &token)).await
}

#[tauri::command]
async fn load_chat_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Vec<ChatMessage>, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::get_session(&base, &token, &session_id)).await
}

#[tauri::command]
async fn delete_chat_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::delete_session(&base, &token, &session_id)).await
}

#[tauri::command]
async fn get_llm_meta(state: State<'_, Arc<AppState>>) -> Result<LlmMeta, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::get_llm_meta(&base, &token)).await
}

#[tauri::command]
async fn get_interview_materials(
    state: State<'_, Arc<AppState>>,
    profile_id: Option<String>,
) -> Result<InterviewMaterials, String> {
    let (base, token) = api_creds(&state)?;
    let profile_id = profile_id.unwrap_or_default();
    run_blocking(move || {
        interview::account::get_materials(&base, &token, &profile_id)
    })
    .await
}

#[tauri::command]
async fn list_interview_profiles(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<InterviewProfileSummary>, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::list_profiles(&base, &token)).await
}

#[tauri::command]
async fn save_interview_materials(
    state: State<'_, Arc<AppState>>,
    resume: String,
    jd: String,
    profile_name: String,
    language: String,
    skills: String,
    profile_id: Option<String>,
    create_new: Option<bool>,
) -> Result<InterviewMaterials, String> {
    let (base, token) = api_creds(&state)?;
    let profile_id = profile_id.unwrap_or_default();
    let create_new = create_new.unwrap_or(false);
    run_blocking(move || {
        interview::account::save_materials(
            &base,
            &token,
            &resume,
            &jd,
            &profile_name,
            &language,
            &skills,
            &profile_id,
            create_new,
        )
    })
    .await
}

#[tauri::command]
async fn delete_interview_profile(
    state: State<'_, Arc<AppState>>,
    profile_id: String,
) -> Result<InterviewMaterials, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::delete_profile(&base, &token, &profile_id)).await
}

#[tauri::command]
async fn list_interview_answers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<InterviewAnswer>, String> {
    let (base, token) = api_creds(&state)?;
    let Some(round_id) = state.current_round_id.lock().clone() else {
        return Ok(Vec::new());
    };
    run_blocking(move || interview::account::list_answers(&base, &token, &round_id)).await
}

#[tauri::command]
async fn delete_interview_round(
    state: State<'_, Arc<AppState>>,
    round_id: String,
) -> Result<(), String> {
    let (base, token) = api_creds(&state)?;
    let round_id = round_id.trim().to_string();
    if round_id.is_empty() {
        return Err("缺少场次".into());
    }
    run_blocking(move || interview::account::delete_round(&base, &token, &round_id)).await
}

#[tauri::command]
async fn list_interview_rounds(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<InterviewRound>, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::list_rounds(&base, &token)).await
}

#[tauri::command]
async fn list_interview_answers_for_round(
    state: State<'_, Arc<AppState>>,
    round_id: String,
) -> Result<Vec<InterviewAnswer>, String> {
    let (base, token) = api_creds(&state)?;
    let round_id = round_id.trim().to_string();
    if round_id.is_empty() {
        return Err("请选择一场面试".into());
    }
    run_blocking(move || interview::account::list_answers(&base, &token, &round_id)).await
}

#[tauri::command]
async fn get_interview_me(state: State<'_, Arc<AppState>>) -> Result<InterviewMe, String> {
    let (base, token) = api_creds(&state)?;
    run_blocking(move || interview::account::get_interview_me(&base, &token)).await
}

#[tauri::command]
async fn generate_interview_answer(
    state: State<'_, Arc<AppState>>,
    question: String,
) -> Result<InterviewAnswer, String> {
    let (base, token) = api_creds(&state)?;
    let Some(round_id) = state.current_round_id.lock().clone() else {
        return Err("请先开始面试".into());
    };
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err("请输入或选择当前问题".into());
    }
    // Offload blocking HTTP so the async runtime (and live WS) keep breathing.
    tauri::async_runtime::spawn_blocking(move || {
        interview::account::generate_answer(&base, &token, &round_id, &question)
    })
    .await
    .map_err(|e| format!("出答任务失败: {e}"))?
}

#[tauri::command]
fn list_meeting_apps() -> Vec<String> {
    detect::list_meeting_apps()
}

#[tauri::command]
fn is_interviewing(state: State<'_, Arc<AppState>>) -> bool {
    state.live.lock().is_some()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InterviewAccountView {
    user_id: String,
    email: String,
    token: String,
}

fn persist_interview_account(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    account: interview::auth::InterviewAccount,
) -> Result<InterviewAccountView, String> {
    let mut settings = state.settings.lock().clone();
    settings.interview_token = account.token.clone();
    settings.interview_email = account.email.clone();
    save_settings(app, &settings)?;
    *state.settings.lock() = settings;
    Ok(InterviewAccountView {
        user_id: account.user_id,
        email: account.email,
        token: account.token,
    })
}

#[tauri::command]
async fn login_interview(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    email: String,
    password: String,
) -> Result<InterviewAccountView, String> {
    let base = state.settings.lock().api_http_url.clone();
    let account =
        run_blocking(move || interview::auth::login(&base, &email, &password)).await?;
    persist_interview_account(&app, &state, account)
}

#[tauri::command]
async fn send_interview_email_code(
    state: State<'_, Arc<AppState>>,
    email: String,
    purpose: String,
) -> Result<String, String> {
    let base = state.settings.lock().api_http_url.clone();
    run_blocking(move || interview::auth::send_email_code(&base, &email, &purpose)).await
}

#[tauri::command]
async fn register_interview(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    email: String,
    password: String,
    code: String,
) -> Result<InterviewAccountView, String> {
    let base = state.settings.lock().api_http_url.clone();
    let account =
        run_blocking(move || interview::auth::register(&base, &email, &password, &code)).await?;
    persist_interview_account(&app, &state, account)
}

#[tauri::command]
async fn reset_interview_password(
    state: State<'_, Arc<AppState>>,
    email: String,
    password: String,
    code: String,
) -> Result<String, String> {
    let base = state.settings.lock().api_http_url.clone();
    run_blocking(move || interview::auth::reset_password(&base, &email, &password, &code)).await
}

#[tauri::command]
fn logout_interview(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut settings = state.settings.lock().clone();
    settings.interview_token.clear();
    settings.interview_email.clear();
    save_settings(&app, &settings)?;
    *state.settings.lock() = settings;
    *state.current_round_id.lock() = None;
    Ok(())
}

#[tauri::command]
async fn start_interview(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let settings = state.settings.lock().clone();
    interview::auth::require_login_token(&settings.interview_token)?;
    let http = settings.api_http_url.clone();
    let token = settings.interview_token.clone();
    let round_id = tauri::async_runtime::spawn_blocking(move || {
        interview::account::create_round(&http, &token)
    })
    .await
    .map_err(|e| format!("开场失败: {e}"))??;
    *state.current_round_id.lock() = Some(round_id);
    let url = interview::with_token(&settings.interview_ws_url, &settings.interview_token);
    if url.trim().is_empty() {
        return Err("请先在设置中填写开面 WebSocket 地址".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let mic_enabled = Arc::new(AtomicBool::new(true));
    let (cancel, rx) = tokio::sync::watch::channel(false);
    {
        let mut live = state.live.lock();
        if live.is_some() {
            return Err("已在面试中".into());
        }
        *live = Some(LiveInterview {
            stop: Arc::clone(&stop),
            cancel,
            mic_enabled: Arc::clone(&mic_enabled),
        });
    }

    let app_bg = app.clone();
    let state_bg = state.inner().clone();
    let mic_id = {
        let t = settings.mic_device_id.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    };
    let system_id = {
        let t = settings.system_audio_device_id.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    };
    tauri::async_runtime::spawn(async move {
        let result = interview::run_session(
            app_bg.clone(),
            url,
            rx,
            stop,
            mic_enabled,
            mic_id,
            system_id,
        )
        .await;
        state_bg.live.lock().take();
        if let Err(e) = result {
            let _ = app_bg.emit(
                "interview-error",
                serde_json::json!({ "message": e }),
            );
        }
        let _ = app_bg.emit(
            "interview-status",
            serde_json::json!({
                "listening": false,
                "sessionEnded": true,
                "notice": "听题连接已结束。"
            }),
        );
    });
    Ok(())
}

#[tauri::command]
fn set_interview_mic_capture(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), String> {
    let live = state.live.lock();
    if let Some(session) = live.as_ref() {
        session.set_mic_enabled(enabled);
        Ok(())
    } else {
        Err("当前未在面试".into())
    }
}

#[tauri::command]
fn stop_interview(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let live = state.live.lock();
    if let Some(session) = live.as_ref() {
        session.request_stop();
        Ok(())
    } else {
        Err("当前未在面试".into())
    }
}

#[tauri::command]
fn list_audio_devices() -> Result<audio::AudioDeviceLists, String> {
    audio::list_audio_devices()
}

#[tauri::command]
fn check_audio_permissions() -> audio::AudioPermissionStatus {
    audio::check_audio_permissions()
}

#[tauri::command]
fn start_audio_device_test(
    app: AppHandle,
    kind: String,
    device_id: String,
) -> Result<(), String> {
    audio::start_device_test(app, kind, device_id)
}

#[tauri::command]
fn stop_audio_device_test() {
    audio::stop_device_test();
}

#[tauri::command]
fn capture_screenshot_base64() -> Result<String, String> {
    capture::capture_primary_png_base64()
}

fn load_app_icon() -> Option<tauri::image::Image<'static>> {
    let img = image::load_from_memory(include_bytes!("../icons/128x128.png"))
        .ok()?
        .into_rgba8();
    let width = img.width();
    let height = img.height();
    Some(tauri::image::Image::new_owned(img.into_raw(), width, height))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let settings = load_settings(app.handle());
            app.manage(Arc::new(AppState {
                settings: Mutex::new(settings),
                live: Mutex::new(None),
                current_round_id: Mutex::new(None),
            }));
            if let (Some(window), Some(icon)) = (app.get_webview_window("main"), load_app_icon()) {
                let _ = window.set_icon(icon);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_app_settings,
            send_chat_message,
            create_chat_session,
            list_chat_sessions,
            load_chat_session,
            delete_chat_session,
            get_llm_meta,
            get_interview_materials,
            list_interview_profiles,
            save_interview_materials,
            delete_interview_profile,
            list_interview_answers,
            delete_interview_round,
            list_interview_rounds,
            list_interview_answers_for_round,
            get_interview_me,
            generate_interview_answer,
            list_meeting_apps,
            is_interviewing,
            login_interview,
            send_interview_email_code,
            register_interview,
            reset_interview_password,
            logout_interview,
            start_interview,
            set_interview_mic_capture,
            stop_interview,
            list_audio_devices,
            check_audio_permissions,
            start_audio_device_test,
            stop_audio_device_test,
            overlay::probe_shortcuts,
            overlay::register_interview_shortcuts,
            overlay::unregister_interview_shortcuts,
            overlay::enter_interview_overlay,
            overlay::exit_interview_overlay,
            overlay::set_interview_overlay_visible,
            overlay::set_interview_shell_expanded,
            overlay::list_shortcut_catalog,
            capture_screenshot_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AurisAI");
}
