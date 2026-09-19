use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter};
use wasapi::{get_default_device, initialize_mta, DeviceCollection, Direction};

use super::recorder::capture_stream;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceLists {
    pub microphones: Vec<AudioDeviceInfo>,
    pub system_outputs: Vec<AudioDeviceInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioPermissionStatus {
    /// 麦克风采集是否可用
    pub microphone: bool,
    /// 录屏 / 系统音频（loopback）是否可用
    pub screen_and_system: bool,
}

static TEST_HANDLE: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>> = Mutex::new(None);

fn probe_direction(direction: Direction) -> bool {
    if initialize_mta().ok().is_err() {
        return false;
    }
    let Ok(device) = get_default_device(&direction) else {
        return false;
    };
    device.get_iaudioclient().is_ok()
}

pub fn check_audio_permissions() -> AudioPermissionStatus {
    std::thread::spawn(|| AudioPermissionStatus {
        microphone: probe_direction(Direction::Capture),
        screen_and_system: probe_direction(Direction::Render),
    })
    .join()
    .unwrap_or(AudioPermissionStatus {
        microphone: false,
        screen_and_system: false,
    })
}

fn list_direction(direction: Direction) -> Result<Vec<AudioDeviceInfo>, String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM MTA init failed: {e:?}"))?;
    let collection =
        DeviceCollection::new(&direction).map_err(|e| format!("获取设备列表失败: {e}"))?;
    let n = collection
        .get_nbr_devices()
        .map_err(|e| format!("读取设备数量失败: {e}"))?;
    let mut out = Vec::new();
    for i in 0..n {
        let Ok(device) = collection.get_device_at_index(i) else {
            continue;
        };
        let Ok(id) = device.get_id() else {
            continue;
        };
        let name = device
            .get_friendlyname()
            .unwrap_or_else(|_| format!("设备 {}", i + 1));
        out.push(AudioDeviceInfo { id, name });
    }
    Ok(out)
}

pub fn list_audio_devices() -> Result<AudioDeviceLists, String> {
    // WASAPI/COM is more reliable on a dedicated OS thread than the async pool.
    std::thread::spawn(|| {
        Ok(AudioDeviceLists {
            microphones: list_direction(Direction::Capture)?,
            system_outputs: list_direction(Direction::Render)?,
        })
    })
    .join()
    .map_err(|_| "读取音频设备失败".to_string())?
}

pub fn stop_device_test() {
    let mut guard = TEST_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((stop, handle)) = guard.take() {
        stop.store(true, Ordering::SeqCst);
        let _ = handle.join();
    }
}

pub fn start_device_test(
    app: AppHandle,
    kind: String,
    device_id: String,
) -> Result<(), String> {
    stop_device_test();
    let kind_label = match kind.as_str() {
        "mic" => "mic",
        "system" => "system",
        _ => return Err("未知的测试类型".into()),
    };
    let direction = match kind_label {
        "mic" => Direction::Capture,
        _ => Direction::Render,
    };
    let device_id = {
        let trimmed = device_id.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    };
    let stop = Arc::new(AtomicBool::new(false));
    let stop_c = Arc::clone(&stop);
    let handle = thread::spawn(move || {
        let mut last_emit = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_millis(50))
            .unwrap_or_else(std::time::Instant::now);
        let mut pending_peak = 0.0f32;
        if let Err(e) = capture_stream(direction, device_id, stop_c, |mono| {
            let mut sum = 0.0f32;
            for &s in mono {
                sum += s * s;
            }
            let rms = if mono.is_empty() {
                0.0
            } else {
                (sum / mono.len() as f32).sqrt()
            };
            pending_peak = pending_peak.max(rms);
            if last_emit.elapsed() >= std::time::Duration::from_millis(50) {
                let level = (pending_peak * 4.0).clamp(0.0, 1.0);
                pending_peak = 0.0;
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    "audio-test-level",
                    serde_json::json!({
                        "kind": kind_label,
                        "level": level,
                    }),
                );
            }
        }) {
            let _ = app.emit(
                "audio-test-error",
                serde_json::json!({ "message": e }),
            );
        }
        let _ = app.emit(
            "audio-test-level",
            serde_json::json!({
                "kind": kind_label,
                "level": 0.0,
            }),
        );
    });
    *TEST_HANDLE.lock().unwrap_or_else(|e| e.into_inner()) = Some((stop, handle));
    Ok(())
}
