use crate::shortcuts::{merge_bindings, ShortcutAction, ShortcutStatusItem};
use crate::AppState;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewWindow,
};
use tauri::utils::config::Color;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const OVERLAY_LABEL: &str = "overlay";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayUiState {
    pub show_overlay: bool,
    pub show_transcript: bool,
    pub show_answer: bool,
    pub show_shortcut_hints: bool,
    pub auto_answer: bool,
    pub attach_screenshot: bool,
    pub use_mode: String,
}

impl Default for OverlayUiState {
    fn default() -> Self {
        Self {
            show_overlay: true,
            show_transcript: true,
            show_answer: true,
            show_shortcut_hints: true,
            auto_answer: false,
            attach_screenshot: false,
            use_mode: "meeting".into(),
        }
    }
}

fn emit_shortcut(app: &AppHandle, action: &str) {
    let _ = app.emit(
        "overlay-shortcut",
        serde_json::json!({ "action": action }),
    );
}

pub fn probe_bindings(
    app: &AppHandle,
    bindings: &HashMap<String, String>,
) -> Result<Vec<ShortcutStatusItem>, String> {
    let merged = merge_bindings(bindings);
    let mut items = Vec::new();
    let gs = app.global_shortcut();

    for action in ShortcutAction::all() {
        let id = action.id().to_string();
        let accel = merged
            .get(&id)
            .cloned()
            .unwrap_or_else(|| action.default_accelerator().to_string());
        let shortcut: Shortcut = accel
            .parse()
            .map_err(|e| format!("无效快捷键 {accel}: {e}"))?;

        if gs.is_registered(shortcut.clone()) {
            items.push(ShortcutStatusItem {
                id,
                label: action.label_zh().to_string(),
                accelerator: accel,
                occupied: false,
                registered: true,
            });
            continue;
        }

        let occupied = match gs.on_shortcut(shortcut.clone(), |_app, _s, _e| {}) {
            Ok(()) => {
                let _ = gs.unregister(shortcut);
                false
            }
            Err(_) => true,
        };

        items.push(ShortcutStatusItem {
            id,
            label: action.label_zh().to_string(),
            accelerator: accel,
            occupied,
            registered: false,
        });
    }
    Ok(items)
}

pub fn register_bindings(
    app: &AppHandle,
    bindings: &HashMap<String, String>,
) -> Result<Vec<ShortcutStatusItem>, String> {
    let merged = merge_bindings(bindings);
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let mut items = Vec::new();
    for action in ShortcutAction::all() {
        let id = action.id().to_string();
        let accel = merged
            .get(&id)
            .cloned()
            .unwrap_or_else(|| action.default_accelerator().to_string());
        let action_id = id.clone();
        let shortcut: Shortcut = match accel.parse() {
            Ok(s) => s,
            Err(e) => {
                items.push(ShortcutStatusItem {
                    id,
                    label: action.label_zh().to_string(),
                    accelerator: accel,
                    occupied: true,
                    registered: false,
                });
                let _ = e;
                continue;
            }
        };

        let registered = gs
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    emit_shortcut(&app, &action_id);
                }
            })
            .is_ok();

        items.push(ShortcutStatusItem {
            id,
            label: action.label_zh().to_string(),
            accelerator: accel,
            occupied: !registered,
            registered,
        });
    }
    Ok(items)
}

pub fn unregister_all(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("卸载快捷键失败: {e}"))
}

fn close_orphan_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.close();
    }
}

fn apply_shell_geometry(win: &WebviewWindow) -> Result<(), String> {
    let monitor = win
        .primary_monitor()
        .map_err(|e| format!("获取显示器失败: {e}"))?
        .ok_or_else(|| "未找到主显示器".to_string())?;
    let size = monitor.size();
    let scale = monitor.scale_factor();
    // Full work area, transparent chrome — modules float inside without a big opaque frame.
    let width = (size.width as f64 / scale) - 16.0;
    let height = (size.height as f64 / scale) - 16.0;
    win.set_size(LogicalSize::new(width.max(640.0), height.max(420.0)))
        .map_err(|e| format!("设置窗口大小失败: {e}"))?;
    win.set_position(LogicalPosition::new(8.0, 8.0))
        .map_err(|e| format!("设置窗口位置失败: {e}"))?;
    Ok(())
}

fn pin_overlay_shell(win: &WebviewWindow) {
    let _ = win.set_decorations(false);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_content_protected(true);
    let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
    let _ = win.show();
    let _ = win.unminimize();
    // After show: Windows can drop HWND_TOPMOST if this runs too early.
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

/// Transform the *main* window into the interview shell (no second webview).
/// Secondary windows were blank under Tauri CSP / External URL; in-place is reliable.
pub fn enter_overlay(app: &AppHandle, use_mode: &str) -> Result<(), String> {
    close_orphan_overlay(app);

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    apply_shell_geometry(&main)?;
    // Default click-through; frontend toggles ignore off only over interactive hits.
    let _ = main.set_ignore_cursor_events(true);
    pin_overlay_shell(&main);

    let _ = app.emit(
        "overlay-ui-enter",
        OverlayUiState {
            use_mode: use_mode.to_string(),
            ..OverlayUiState::default()
        },
    );
    Ok(())
}

pub fn exit_overlay(app: &AppHandle) -> Result<(), String> {
    let _ = unregister_all(app);
    close_orphan_overlay(app);

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_ignore_cursor_events(false);
        let _ = main.set_content_protected(false);
        let _ = main.set_always_on_top(false);
        let _ = main.set_skip_taskbar(false);
        let _ = main.set_decorations(false);
        let _ = main.set_background_color(Some(Color(0, 0, 0, 0)));
        let _ = main.set_size(LogicalSize::new(900.0, 620.0));
        let _ = main.center();
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }

    let _ = app.emit("overlay-ui-exit", serde_json::json!({}));
    Ok(())
}

pub fn set_overlay_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    // Shell lives on main — toggle always-on-top hide via minimize/show of main.
    if let Some(main) = app.get_webview_window("main") {
        if visible {
            let _ = main.set_ignore_cursor_events(true);
            pin_overlay_shell(&main);
        } else {
            let _ = main.hide();
        }
    }
    Ok(())
}

/// Collapse/expand only affects front-end modules; keep full transparent work area
/// so bottom-left shortcut strip and top menubar can stay independent.
pub fn set_shell_expanded(app: &AppHandle, _expanded: bool) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    apply_shell_geometry(&main)?;
    let _ = main.show();
    Ok(())
}

#[tauri::command]
pub fn probe_shortcuts(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ShortcutStatusItem>, String> {
    let bindings = state.settings.lock().shortcuts.clone();
    probe_bindings(&app, &bindings)
}

#[tauri::command]
pub fn register_interview_shortcuts(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ShortcutStatusItem>, String> {
    let bindings = state.settings.lock().shortcuts.clone();
    register_bindings(&app, &bindings)
}

#[tauri::command]
pub fn unregister_interview_shortcuts(app: AppHandle) -> Result<(), String> {
    unregister_all(&app)
}

#[tauri::command]
pub fn enter_interview_overlay(app: AppHandle, use_mode: String) -> Result<(), String> {
    enter_overlay(&app, &use_mode)
}

#[tauri::command]
pub fn exit_interview_overlay(app: AppHandle) -> Result<(), String> {
    exit_overlay(&app)
}

#[tauri::command]
pub fn set_interview_overlay_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    set_overlay_visible(&app, visible)
}

#[tauri::command]
pub fn set_interview_shell_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    set_shell_expanded(&app, expanded)
}

#[tauri::command]
pub fn list_shortcut_catalog() -> Vec<ShortcutStatusItem> {
    ShortcutAction::all()
        .iter()
        .map(|a| ShortcutStatusItem {
            id: a.id().to_string(),
            label: a.label_zh().to_string(),
            accelerator: a.default_accelerator().to_string(),
            occupied: false,
            registered: false,
        })
        .collect()
}
