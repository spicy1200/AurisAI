use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutAction {
    Answer,
    ScreenshotAnswer,
    ToggleOverlay,
    ToggleShortcutHints,
    ToggleTranscript,
    EndInterview,
    ToggleAutoAnswer,
    SendTranscript1,
    SendTranscript2,
    SendTranscript3,
    SendTranscript4,
    SendTranscript5,
}

impl ShortcutAction {
    pub fn all() -> &'static [ShortcutAction] {
        &[
            ShortcutAction::Answer,
            ShortcutAction::ScreenshotAnswer,
            ShortcutAction::ToggleOverlay,
            ShortcutAction::ToggleShortcutHints,
            ShortcutAction::ToggleTranscript,
            ShortcutAction::EndInterview,
            ShortcutAction::ToggleAutoAnswer,
            ShortcutAction::SendTranscript1,
            ShortcutAction::SendTranscript2,
            ShortcutAction::SendTranscript3,
            ShortcutAction::SendTranscript4,
            ShortcutAction::SendTranscript5,
        ]
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            ShortcutAction::Answer => "回答问题",
            ShortcutAction::ScreenshotAnswer => "截图并回答最新问题",
            ShortcutAction::ToggleOverlay => "隐藏 / 显示悬浮窗",
            ShortcutAction::ToggleShortcutHints => "隐藏 / 显示键盘快捷方式",
            ShortcutAction::ToggleTranscript => "隐藏 / 显示转录面板",
            ShortcutAction::EndInterview => "结束面试（需二次确认）",
            ShortcutAction::ToggleAutoAnswer => "切换自动回答",
            ShortcutAction::SendTranscript1 => "发送面试官转录 1",
            ShortcutAction::SendTranscript2 => "发送面试官转录 2",
            ShortcutAction::SendTranscript3 => "发送面试官转录 3",
            ShortcutAction::SendTranscript4 => "发送面试官转录 4",
            ShortcutAction::SendTranscript5 => "发送面试官转录 5",
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            ShortcutAction::Answer => "answer",
            ShortcutAction::ScreenshotAnswer => "screenshot_answer",
            ShortcutAction::ToggleOverlay => "toggle_overlay",
            ShortcutAction::ToggleShortcutHints => "toggle_shortcut_hints",
            ShortcutAction::ToggleTranscript => "toggle_transcript",
            ShortcutAction::EndInterview => "end_interview",
            ShortcutAction::ToggleAutoAnswer => "toggle_auto_answer",
            ShortcutAction::SendTranscript1 => "send_transcript_1",
            ShortcutAction::SendTranscript2 => "send_transcript_2",
            ShortcutAction::SendTranscript3 => "send_transcript_3",
            ShortcutAction::SendTranscript4 => "send_transcript_4",
            ShortcutAction::SendTranscript5 => "send_transcript_5",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "answer" => Some(Self::Answer),
            "screenshot_answer" => Some(Self::ScreenshotAnswer),
            "toggle_overlay" => Some(Self::ToggleOverlay),
            "toggle_shortcut_hints" => Some(Self::ToggleShortcutHints),
            "toggle_transcript" => Some(Self::ToggleTranscript),
            "end_interview" => Some(Self::EndInterview),
            "toggle_auto_answer" => Some(Self::ToggleAutoAnswer),
            "send_transcript_1" => Some(Self::SendTranscript1),
            "send_transcript_2" => Some(Self::SendTranscript2),
            "send_transcript_3" => Some(Self::SendTranscript3),
            "send_transcript_4" => Some(Self::SendTranscript4),
            "send_transcript_5" => Some(Self::SendTranscript5),
            _ => None,
        }
    }

    pub fn default_accelerator(&self) -> &'static str {
        match self {
            ShortcutAction::Answer => "Ctrl+Alt+A",
            ShortcutAction::ScreenshotAnswer => "Ctrl+Alt+S",
            ShortcutAction::ToggleOverlay => "Ctrl+Alt+D",
            ShortcutAction::ToggleShortcutHints => "Ctrl+Alt+K",
            ShortcutAction::ToggleTranscript => "Ctrl+Alt+T",
            ShortcutAction::EndInterview => "Ctrl+Alt+Q",
            ShortcutAction::ToggleAutoAnswer => "Ctrl+Alt+X",
            ShortcutAction::SendTranscript1 => "Ctrl+Alt+1",
            ShortcutAction::SendTranscript2 => "Ctrl+Alt+2",
            ShortcutAction::SendTranscript3 => "Ctrl+Alt+3",
            ShortcutAction::SendTranscript4 => "Ctrl+Alt+4",
            ShortcutAction::SendTranscript5 => "Ctrl+Alt+5",
        }
    }
}

pub fn default_bindings() -> HashMap<String, String> {
    ShortcutAction::all()
        .iter()
        .map(|a| (a.id().to_string(), a.default_accelerator().to_string()))
        .collect()
}

pub fn merge_bindings(stored: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = default_bindings();
    for (k, v) in stored {
        if ShortcutAction::from_id(k).is_some() && !v.trim().is_empty() {
            out.insert(k.clone(), v.trim().to_string());
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatusItem {
    pub id: String,
    pub label: String,
    pub accelerator: String,
    pub occupied: bool,
    pub registered: bool,
}
