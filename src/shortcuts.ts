export type ShortcutActionId =
  | "answer"
  | "screenshot_answer"
  | "toggle_overlay"
  | "toggle_shortcut_hints"
  | "toggle_transcript"
  | "end_interview"
  | "toggle_auto_answer"
  | "send_transcript_1"
  | "send_transcript_2"
  | "send_transcript_3"
  | "send_transcript_4"
  | "send_transcript_5";

export interface ShortcutDef {
  id: ShortcutActionId;
  label: string;
  defaultAccel: string;
}

export const SHORTCUT_CATALOG: ShortcutDef[] = [
  { id: "answer", label: "回答问题", defaultAccel: "Ctrl+Alt+A" },
  {
    id: "screenshot_answer",
    label: "截图并回答最新问题",
    defaultAccel: "Ctrl+Alt+S",
  },
  {
    id: "toggle_overlay",
    label: "隐藏 / 显示悬浮窗",
    defaultAccel: "Ctrl+Alt+D",
  },
  {
    id: "toggle_shortcut_hints",
    label: "隐藏 / 显示键盘快捷方式",
    defaultAccel: "Ctrl+Alt+K",
  },
  {
    id: "toggle_transcript",
    label: "隐藏 / 显示转录面板",
    defaultAccel: "Ctrl+Alt+T",
  },
  {
    id: "end_interview",
    label: "结束面试（需二次确认）",
    defaultAccel: "Ctrl+Alt+Q",
  },
  {
    id: "toggle_auto_answer",
    label: "切换自动回答",
    defaultAccel: "Ctrl+Alt+X",
  },
  {
    id: "send_transcript_1",
    label: "发送面试官转录 1",
    defaultAccel: "Ctrl+Alt+1",
  },
  {
    id: "send_transcript_2",
    label: "发送面试官转录 2",
    defaultAccel: "Ctrl+Alt+2",
  },
  {
    id: "send_transcript_3",
    label: "发送面试官转录 3",
    defaultAccel: "Ctrl+Alt+3",
  },
  {
    id: "send_transcript_4",
    label: "发送面试官转录 4",
    defaultAccel: "Ctrl+Alt+4",
  },
  {
    id: "send_transcript_5",
    label: "发送面试官转录 5",
    defaultAccel: "Ctrl+Alt+5",
  },
];

export type ShortcutMap = Record<string, string>;

export function defaultShortcutMap(): ShortcutMap {
  const m: ShortcutMap = {};
  for (const s of SHORTCUT_CATALOG) m[s.id] = s.defaultAccel;
  return m;
}

export function mergeShortcutMap(stored?: ShortcutMap | null): ShortcutMap {
  const base = defaultShortcutMap();
  if (!stored) return base;
  for (const [k, v] of Object.entries(stored)) {
    if (k in base && typeof v === "string" && v.trim()) base[k] = v.trim();
  }
  return base;
}

export function splitAccel(accel: string): string[] {
  return accel
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
}

export interface ShortcutStatusItem {
  id: string;
  label: string;
  accelerator: string;
  occupied: boolean;
  registered: boolean;
}
