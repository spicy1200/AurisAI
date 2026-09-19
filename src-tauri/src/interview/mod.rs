use crate::audio::{LiveCapture, LiveChannel, PcmFrame};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPayload {
    pub channel: String,
    pub kind: String,
    pub text: String,
}

pub struct LiveInterview {
    pub stop: Arc<AtomicBool>,
    pub cancel: watch::Sender<bool>,
    pub mic_enabled: Arc<AtomicBool>,
}

impl LiveInterview {
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.cancel.send(true);
    }

    pub fn set_mic_enabled(&self, enabled: bool) {
        self.mic_enabled.store(enabled, Ordering::SeqCst);
    }
}

pub fn pack_frame(frame: &PcmFrame) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + frame.pcm.len());
    out.push(frame.channel.wire_byte());
    out.extend_from_slice(&frame.pcm);
    out
}

pub mod account;
pub mod auth;

pub fn with_token(ws_url: &str, token: &str) -> String {
    let url = ws_url.trim();
    let token = token.trim();
    if token.is_empty() {
        return url.to_string();
    }
    if url.contains('?') {
        format!("{url}&token={token}")
    } else {
        format!("{url}?token={token}")
    }
}

pub async fn run_session(
    app: AppHandle,
    url: String,
    mut cancel_rx: watch::Receiver<bool>,
    stop: Arc<AtomicBool>,
    mic_enabled: Arc<AtomicBool>,
    mic_device_id: Option<String>,
    system_device_id: Option<String>,
) -> Result<(), String> {
    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("连接开面服务失败: {e}"))?;
    let (mut write, mut read) = ws.split();

    let channels = [
        LiveChannel::Interviewer.as_str(),
        LiveChannel::SelfMic.as_str(),
    ];
    let hello = serde_json::json!({ "type": "hello", "channels": channels });
    write
        .send(Message::Text(hello.to_string().into()))
        .await
        .map_err(|e| format!("发送 hello 失败: {e}"))?;

    let (tx, mut pcm_rx) = tokio::sync::mpsc::channel::<PcmFrame>(48);
    let capture = LiveCapture::start(tx, mic_device_id, system_device_id, mic_enabled)
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "interview-status",
        serde_json::json!({
            "listening": true,
            "notice": "面试进行中。连接有效期间按时长计费（静默也会扣）。听题失败不会自动结束。"
        }),
    );

    let send_loop = async {
        while let Some(frame) = pcm_rx.recv().await {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if write
                .send(Message::Binary(pack_frame(&frame).into()))
                .await
                .is_err()
            {
                break;
            }
        }
        let _ = write
            .send(Message::Text(
                serde_json::json!({"type":"end"}).to_string().into(),
            ))
            .await;
        let _ = write.close().await;
    };

    let recv_loop = async {
        while let Some(msg) = read.next().await {
            let Ok(msg) = msg else { break };
            match msg {
                Message::Text(text) => {
                    dispatch_server_text(&app, &text);
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    tokio::select! {
        _ = send_loop => {}
        _ = recv_loop => {}
        _ = cancel_rx.changed() => {}
    }

    stop.store(true, Ordering::SeqCst);
    capture.stop();
    let _ = app.emit(
        "interview-status",
        serde_json::json!({
            "listening": false,
            "sessionEnded": true,
            "notice": "听题连接已结束。"
        }),
    );
    Ok(())
}

fn dispatch_server_text(app: &AppHandle, text: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match kind {
        "transcript" => {
            let payload = TranscriptPayload {
                channel: v
                    .get("channel")
                    .and_then(|x| x.as_str())
                    .unwrap_or("interviewer")
                    .to_string(),
                kind: v
                    .get("kind")
                    .and_then(|x| x.as_str())
                    .unwrap_or("partial")
                    .to_string(),
                text: v.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            };
            let _ = app.emit("interview-transcript", payload);
        }
        "asr_error" => {
            let _ = app.emit("interview-error", v);
        }
        "session" | "status" | "ended" | "error" => {
            // Forward as notices only — never let server payloads drive shell teardown.
            // Teardown is owned by run_session's final emit + explicit user stop.
            let mut notice = v.get("notice").and_then(|x| x.as_str()).unwrap_or("");
            if notice.is_empty() {
                notice = v.get("message").and_then(|x| x.as_str()).unwrap_or("");
            }
            if kind == "ended" {
                let _ = app.emit(
                    "interview-status",
                    serde_json::json!({
                        "notice": if notice.is_empty() {
                            "服务端已结束听题通道".to_string()
                        } else {
                            notice.to_string()
                        }
                    }),
                );
            } else if kind == "error" && !notice.is_empty() {
                let _ = app.emit(
                    "interview-error",
                    serde_json::json!({ "message": notice }),
                );
            } else if !notice.is_empty() {
                let _ = app.emit(
                    "interview-status",
                    serde_json::json!({ "notice": notice }),
                );
            } else if kind == "status" {
                if let Some(listening) = v.get("listening").and_then(|x| x.as_bool()) {
                    let _ = app.emit(
                        "interview-status",
                        serde_json::json!({ "listening": listening }),
                    );
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{LiveChannel, PcmFrame};

    #[test]
    fn pack_frame_prefixes_channel() {
        let frame = PcmFrame {
            channel: LiveChannel::Interviewer,
            pcm: vec![9, 8],
        };
        assert_eq!(pack_frame(&frame), vec![0, 9, 8]);
        let self_frame = PcmFrame {
            channel: LiveChannel::SelfMic,
            pcm: vec![1],
        };
        assert_eq!(pack_frame(&self_frame), vec![1, 1]);
    }

    #[test]
    fn token_appended_to_query() {
        assert_eq!(
            with_token("ws://127.0.0.1:9541/ws/interview", "abc"),
            "ws://127.0.0.1:9541/ws/interview?token=abc"
        );
        assert_eq!(
            with_token("ws://h/ws/interview?x=1", "t"),
            "ws://h/ws/interview?x=1&token=t"
        );
        assert_eq!(
            with_token("ws://h/ws/interview", ""),
            "ws://h/ws/interview"
        );
    }
}
