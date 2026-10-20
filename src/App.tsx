import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AUTH_EXPIRED_EVENT,
  AUTH_EXPIRED_MSG,
  invoke,
  isAuthExpiredError,
} from "./tauri";
import { appLogo, sideLogo } from "./brand";
import { resolveWebBase, WEB_PATHS, webPageUrl } from "./site";
import { AuthScreen, type InterviewAccount } from "./AuthScreen";
import { ChatMarkdown } from "./ChatMarkdown";
import InterviewOverlay from "./InterviewOverlay";
import {
  OnboardGuide,
  readOnboardDone,
  writeOnboardDone,
  type OnboardPrepare,
} from "./OnboardGuide";
import { AppFrame, TitleBar, WindowControls, beginWindowDrag } from "./TitleBar";
import {
  defaultShortcutMap,
  mergeShortcutMap,
  SHORTCUT_CATALOG,
  splitAccel,
  type ShortcutMap,
  type ShortcutStatusItem,
} from "./shortcuts";
import "./App.css";

type Page = "chat" | "records" | "me";
type SettingsTab = "general" | "shortcuts" | "audio" | "account" | "about";
type UiTheme = "system" | "light" | "dark";
type UiAccent = "default" | "blue" | "green" | "orange";
type UiLanguage = "auto" | "zh" | "en";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "常规" },
  { id: "shortcuts", label: "快捷键" },
  { id: "audio", label: "音频与权限" },
  { id: "account", label: "账户" },
  { id: "about", label: "关于" },
];

function uiPrefsKey(kind: "theme" | "accent" | "language") {
  return `aurisai-ui-${kind}`;
}

function readUiTheme(): UiTheme {
  try {
    const v = localStorage.getItem(uiPrefsKey("theme"));
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

function readUiAccent(): UiAccent {
  try {
    const v = localStorage.getItem(uiPrefsKey("accent"));
    if (v === "default" || v === "blue" || v === "green" || v === "orange") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "default";
}

function readUiLanguage(): UiLanguage {
  try {
    const v = localStorage.getItem(uiPrefsKey("language"));
    if (v === "auto" || v === "zh" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

function accentCss(accent: UiAccent): { accent: string; hover: string } {
  switch (accent) {
    case "blue":
      return { accent: "#2563eb", hover: "#1d4ed8" };
    case "green":
      return { accent: "#16a34a", hover: "#15803d" };
    case "orange":
      return { accent: "#ea580c", hover: "#c2410c" };
    default:
      return { accent: "#3d6b7a", hover: "#315866" };
  }
}

function resolveTheme(theme: UiTheme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

interface InterviewAnswer {
  question: string;
  answer: string;
  created_at: string;
}

interface InterviewRound {
  id: string;
  created_at: string;
}

interface InterviewMeView {
  user_id: string;
  email: string;
  balance_minutes: number;
}

interface MaterialsView {
  resume: string;
  jd: string;
  ready: boolean;
  profile_name?: string;
  language?: string;
  skills?: string;
  profile_id?: string;
}

interface ProfileSummary {
  id: string;
  name: string;
  language: string;
  ready: boolean;
  is_active: boolean;
}

type ProfileEditorDraft = {
  resume: string;
  jd: string;
  name: string;
  language: string;
  skills: string;
  profileId: string;
};

function editorContentKey(
  d: Pick<ProfileEditorDraft, "resume" | "jd" | "name" | "language" | "skills">,
) {
  return JSON.stringify({
    resume: d.resume,
    jd: d.jd,
    name: (d.name || "").trim() || "默认档案",
    language: d.language || "",
    skills: d.skills || "",
  });
}

const PROFILE_LANGUAGES = ["中文", "English"] as const;

type AccessMode = "ask" | "full";
type InterviewUseMode = "meeting" | "stealth";

const INTERVIEW_USE_MODE_KEY = "auris.interviewUseMode";

function readStoredInterviewUseMode(): InterviewUseMode {
  try {
    const v = sessionStorage.getItem(INTERVIEW_USE_MODE_KEY);
    if (v === "meeting" || v === "stealth") return v;
  } catch {
    /* ignore */
  }
  return "meeting";
}

function persistInterviewUseMode(mode: InterviewUseMode) {
  try {
    sessionStorage.setItem(INTERVIEW_USE_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function clearStoredInterviewUseMode() {
  try {
    sessionStorage.removeItem(INTERVIEW_USE_MODE_KEY);
  } catch {
    /* ignore */
  }
}

function accessStorageKey(email: string) {
  return `aurisai-access-mode:${email.trim().toLowerCase()}`;
}

function afterPaint(fn: () => void) {
  let cancelled = false;
  const id = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!cancelled) fn();
    });
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(id);
  };
}

function formatRoundTime(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return raw || "未记录时间";
  }
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 3V12A8.5 8.5 0 1 1 21 12Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="6.5" width="17" height="11" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function IconHeadset() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 13v-1a7 7 0 0 1 14 0v1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M5 13v3.5A1.5 1.5 0 0 0 6.5 18H8v-5H6.5A1.5 1.5 0 0 0 5 13ZM19 13v3.5a1.5 1.5 0 0 1-1.5 1.5H16v-5h1.5A1.5 1.5 0 0 1 19 13Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M9.8 9.6a2.2 2.2 0 1 1 3.4 1.85c-.7.45-1.2.95-1.2 1.75V14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M12 16.8v.3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconGuide() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4H17l-1.4 3.4L17 10.8H8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M6 20V4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconExit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M14 12H4m0 0 2.5-2.5M4 12l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M4.9 6.4l1.6 1.6M17.5 16l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.6l1.6-1.6M17.5 8l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="6.5"
        width="17"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M7 14h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSpeaker() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 9.5h3.2L12.5 6v12l-4.8-3.5H4.5V9.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9.2a3.2 3.2 0 0 1 0 5.6M17.8 7a5.6 5.6 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPermCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8.2 12.2l2.4 2.4 5.2-5.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 10.5v5M12 8.2v.3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function settingsTabIcon(tab: SettingsTab) {
  switch (tab) {
    case "general":
      return <IconSliders />;
    case "shortcuts":
      return <IconKeyboard />;
    case "audio":
      return <IconSpeaker />;
    case "account":
      return <IconUser />;
    case "about":
      return <IconInfo />;
  }
}

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5.5 19.2c.7-3.1 3.2-5 6.5-5s5.8 1.9 6.5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v6h6M8 13h8M8 17h5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRecords() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="8"
        y="2.5"
        width="8"
        height="3.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M16 4.5h2A2 2 0 0 1 20 6.5v13A2 2 0 0 1 18 21.5H6A2 2 0 0 1 4 19.5v-13A2 2 0 0 1 6 4.5h2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8 11h.01M8 15.5h.01M12 11h6M12 15.5h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M12 5v14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevron({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const d =
    dir === "left"
      ? "M14.5 6.5 9 12l5.5 5.5"
      : dir === "right"
        ? "M9.5 6.5 15 12l-5.5 5.5"
        : dir === "up"
          ? "M6.5 14.5 12 9l5.5 5.5"
          : "M6.5 9.5 12 15l5.5-5.5";
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Settings {
  interview_ws_url: string;
  interview_token: string;
  interview_email: string;
  api_http_url: string;
  mic_device_id: string;
  system_audio_device_id: string;
  shortcuts: ShortcutMap;
}

interface AudioDeviceInfo {
  id: string;
  name: string;
}

interface AudioDeviceLists {
  microphones: AudioDeviceInfo[];
  system_outputs: AudioDeviceInfo[];
}

interface AudioPermissionStatus {
  microphone: boolean;
  screen_and_system: boolean;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
}

interface TranscriptLive {
  channel: string;
  kind: string;
  text: string;
}

const defaultSettings: Settings = {
  interview_ws_url: "ws://127.0.0.1:8089/ws/interview",
  interview_token: "",
  interview_email: "",
  api_http_url: "http://127.0.0.1:8089",
  mic_device_id: "",
  system_audio_device_id: "",
  shortcuts: defaultShortcutMap(),
};

const WAVE_BAR_PATTERN = Array.from({ length: 52 }, (_, i) => {
  const t = i / 51;
  return (
    0.18 +
    0.55 * Math.abs(Math.sin(t * Math.PI * 4.1)) +
    0.27 * Math.abs(Math.sin(t * Math.PI * 9.3 + 1.2))
  );
});

function AudioWaveform({ level }: { level: number }) {
  const live = level > 0.02;
  return (
    <div className={live ? "audio-wave live" : "audio-wave"} aria-hidden="true">
      {WAVE_BAR_PATTERN.map((shape, i) => {
        const h = Math.max(0.12, shape * (0.22 + level * 0.78));
        return (
          <span
            key={i}
            style={{ height: `${(h * 100).toFixed(1)}%` }}
          />
        );
      })}
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("chat");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => readUiTheme());
  const [uiAccent, setUiAccent] = useState<UiAccent>(() => readUiAccent());
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => readUiLanguage());
  const [audioDevices, setAudioDevices] = useState<AudioDeviceLists>({
    microphones: [],
    system_outputs: [],
  });
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [audioDevicesError, setAudioDevicesError] = useState("");
  const [audioPerms, setAudioPerms] = useState<AudioPermissionStatus>({
    microphone: false,
    screen_and_system: false,
  });
  const [testingMic, setTestingMic] = useState(false);
  const [testingSystem, setTestingSystem] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [profileName, setProfileName] = useState("默认档案");
  const [profileLanguage, setProfileLanguage] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [materialsReady, setMaterialsReady] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [, setAnswers] = useState<InterviewAnswer[]>([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [recordsCollapsed, setRecordsCollapsed] = useState(false);
  const [profileCollapsed, setProfileCollapsed] = useState(false);
  const [interviewing, setInterviewing] = useState(false);
  const [, setInterviewerFinals] = useState<string[]>([]);
  const [, setInterviewerPartial] = useState("");
  const [, setSelfFinals] = useState<string[]>([]);
  const [, setSelfPartial] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [showMeMenu, setShowMeMenu] = useState(false);
  const [balanceMinutes, setBalanceMinutes] = useState(0);
  const [showOnboard, setShowOnboard] = useState(() => !readOnboardDone());
  const [onboardSeq, setOnboardSeq] = useState(0);
  const [showOnboardDemo, setShowOnboardDemo] = useState(false);
  const [rounds, setRounds] = useState<InterviewRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [recordAnswers, setRecordAnswers] = useState<InterviewAnswer[]>([]);
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const [approveAsk, setApproveAsk] = useState<{
    title: string;
    detail: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [chatAlert, setChatAlert] = useState<string | null>(null);
  const [showInterviewModeModal, setShowInterviewModeModal] = useState(false);
  const [interviewUseMode, setInterviewUseMode] =
    useState<InterviewUseMode>("meeting");
  const [interviewShell, setInterviewShell] = useState(false);
  const [, setShowInterviewPanel] = useState(true);
  const [shortcutStatuses, setShortcutStatuses] = useState<ShortcutStatusItem[]>(
    [],
  );
  const [rebindingId, setRebindingId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const meMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const interviewReconcileOnceRef = useRef(false);
  const authExpiredHandlingRef = useRef(false);
  const interviewingRef = useRef(false);
  const overlayGenRef = useRef(0);
  const onboardShellRef = useRef(false);
  const materialsEpochRef = useRef(0);
  const addingProfileRef = useRef(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const editorRef = useRef<ProfileEditorDraft>({
    resume: "",
    jd: "",
    name: "默认档案",
    language: "",
    skills: "",
    profileId: "",
  });
  const cleanContentKeyRef = useRef(
    editorContentKey({
      resume: "",
      jd: "",
      name: "默认档案",
      language: "",
      skills: "",
    }),
  );
  const profileDraftsRef = useRef(new Map<string, ProfileEditorDraft>());

  const clearLocalSession = useCallback(() => {
    setResumeText("");
    setJdText("");
    setProfileName("默认档案");
    setProfileLanguage("");
    setSkillsText("");
    setMaterialsReady(false);
    setProfileId("");
    setProfiles([]);
    profileDraftsRef.current.clear();
    editorRef.current = {
      resume: "",
      jd: "",
      name: "默认档案",
      language: "",
      skills: "",
      profileId: "",
    };
    cleanContentKeyRef.current = editorContentKey(editorRef.current);
    setSessions([]);
    setChat([]);
    setCurrentSessionId(null);
    setRounds([]);
    setRecordAnswers([]);
    setSelectedRoundId(null);
    setInterviewShell(false);
    setInterviewing(false);
    clearStoredInterviewUseMode();
    setSettings((prev) => ({
      ...prev,
      interview_token: "",
    }));
  }, []);

  const handleAuthExpired = useCallback(async () => {
    if (authExpiredHandlingRef.current) return;
    authExpiredHandlingRef.current = true;
    try {
      try {
        await invoke("stop_interview");
      } catch {
        /* ignore */
      }
      try {
        await invoke("unregister_interview_shortcuts");
      } catch {
        /* ignore */
      }
      try {
        await invoke("exit_interview_overlay");
      } catch {
        /* ignore */
      }
      try {
        await invoke("logout_interview");
      } catch {
        /* ignore */
      }
      clearLocalSession();
      setStatus(AUTH_EXPIRED_MSG);
      setError("");
    } finally {
      window.setTimeout(() => {
        authExpiredHandlingRef.current = false;
      }, 500);
    }
  }, [clearLocalSession]);

  useEffect(() => {
    const onExpired = () => {
      void handleAuthExpired();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [handleAuthExpired]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await invoke<ChatSession[]>("list_chat_sessions");
      setSessions(list);
    } catch {
      /* ignore */
    }
  }, []);

  const applyEditorDraft = useCallback((draft: ProfileEditorDraft, asClean: boolean) => {
    setResumeText(draft.resume);
    setJdText(draft.jd);
    setProfileName(draft.name.trim() || "默认档案");
    setProfileLanguage(draft.language);
    setSkillsText(draft.skills);
    setMaterialsReady(Boolean(draft.resume.trim() && draft.jd.trim()));
    setProfileId(draft.profileId);
    editorRef.current = draft;
    if (asClean) {
      cleanContentKeyRef.current = editorContentKey(draft);
      if (draft.profileId) profileDraftsRef.current.delete(draft.profileId);
    }
  }, []);

  const applyMaterials = useCallback((mat: MaterialsView) => {
    const anyMat = mat as MaterialsView & {
      profileName?: string;
      profileId?: string;
      Resume?: string;
      Jd?: string;
    };
    applyEditorDraft(
      {
        resume: mat.resume ?? anyMat.Resume ?? "",
        jd: mat.jd ?? anyMat.Jd ?? "",
        name: (mat.profile_name ?? anyMat.profileName)?.trim() || "默认档案",
        language: mat.language || "",
        skills: mat.skills || "",
        profileId: mat.profile_id ?? anyMat.profileId ?? "",
      },
      true,
    );
  }, [applyEditorDraft]);

  const isEditorDirty = useCallback(() => {
    return editorContentKey(editorRef.current) !== cleanContentKeyRef.current;
  }, []);

  const stashCurrentDraft = useCallback(() => {
    const cur = editorRef.current;
    if (!cur.profileId) return;
    if (isEditorDirty()) {
      profileDraftsRef.current.set(cur.profileId, { ...cur });
    } else {
      profileDraftsRef.current.delete(cur.profileId);
    }
  }, [isEditorDirty]);

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await invoke<ProfileSummary[]>("list_interview_profiles");
      setProfiles(list);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshMaterials = useCallback(
    async (opts?: { quiet?: boolean; profileId?: string }) => {
      const epoch = materialsEpochRef.current;
      const requestedId = (opts?.profileId || "").trim();
      try {
        if (!requestedId) {
          const curId = editorRef.current.profileId;
          if (isEditorDirty()) {
            await refreshProfiles();
            return true;
          }
          const localDraft = curId ? profileDraftsRef.current.get(curId) : undefined;
          if (localDraft) {
            applyEditorDraft(localDraft, false);
            await refreshProfiles();
            return true;
          }
        }
        if (requestedId) {
          const draft = profileDraftsRef.current.get(requestedId);
          if (draft) {
            applyEditorDraft(draft, false);
            await refreshProfiles();
            return true;
          }
        }
        const mat = await invoke<MaterialsView>("get_interview_materials", {
          profileId: requestedId || undefined,
        });
        if (epoch !== materialsEpochRef.current) return false;
        const loadedId = (mat.profile_id || requestedId).trim();
        const draft = loadedId ? profileDraftsRef.current.get(loadedId) : undefined;
        if (draft) {
          applyEditorDraft(draft, false);
        } else {
          applyMaterials(mat);
        }
        await refreshProfiles();
        return true;
      } catch (e) {
        if (isAuthExpiredError(e)) {
          return false;
        }
        if (!opts?.quiet) {
          setError(`档案加载失败：${e}`);
        }
        return false;
      }
    },
    [applyEditorDraft, applyMaterials, isEditorDirty, refreshProfiles],
  );

  const refreshAnswers = useCallback(async () => {
    try {
      const list = await invoke<InterviewAnswer[]>("list_interview_answers");
      setAnswers(list);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await invoke<InterviewMeView>("get_interview_me");
      setBalanceMinutes(Math.max(0, me.balance_minutes || 0));
      if (me.email) {
        setSettings((prev) =>
          prev.interview_email === me.email
            ? prev
            : { ...prev, interview_email: me.email },
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshRounds = useCallback(async () => {
    try {
      const list = await invoke<InterviewRound[]>("list_interview_rounds");
      setRounds(list);
    } catch {
      /* ignore */
    }
  }, []);

  const openRound = useCallback(async (roundId: string) => {
    setSelectedRoundId(roundId);
    try {
      const list = await invoke<InterviewAnswer[]>("list_interview_answers_for_round", {
        roundId,
      });
      setRecordAnswers(list);
    } catch (e) {
      setRecordAnswers([]);
      setError(String(e));
    }
  }, []);

  async function openWebPage(
    path: string,
    query: Record<string, string | number | undefined | null> = {},
  ) {
    const url = webPageUrl(path, query);
    setShowMeMenu(false);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  }

  function accountWebQuery() {
    return {
      email: settings.interview_email.trim() || undefined,
      minutes: balanceMinutes,
    };
  }

  function persistAccessMode(mode: AccessMode) {
    setAccessMode(mode);
    try {
      if (settings.interview_email.trim()) {
        localStorage.setItem(accessStorageKey(settings.interview_email), mode);
      }
    } catch {
      /* ignore */
    }
  }

  function requireApprove(title: string, detail: string): Promise<boolean> {
    if (accessMode === "full") {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      setApproveAsk({ title, detail, resolve });
    });
  }

  interviewingRef.current = interviewing;

  function leaveOnboardOverlay() {
    setShowOnboardDemo(false);
    setShowInterviewModeModal(false);
    if (interviewingRef.current || !onboardShellRef.current) return;
    onboardShellRef.current = false;
    overlayGenRef.current += 1;
    setInterviewShell(false);
    if (isTauri()) {
      void invoke("exit_interview_overlay").catch(() => undefined);
    }
  }

  function prepareOnboard(prep: OnboardPrepare) {
    setPage(prep.page);
    setShowMeMenu(false);
    setShowSettings(false);
    setShowInterviewModeModal(prep.modeModal);
    setShowOnboardDemo(prep.demoPanel);
    if (prep.demoPanel) {
      const gen = overlayGenRef.current + 1;
      overlayGenRef.current = gen;
      onboardShellRef.current = true;
      setInterviewShell(true);
      if (!isTauri()) return;
      void invoke("enter_interview_overlay", { useMode: "meeting" })
        .then(async () => {
          if (overlayGenRef.current !== gen) return;
          const win = getCurrentWindow();
          await win.setIgnoreCursorEvents(false);
          await win.setAlwaysOnTop(true);
        })
        .catch(() => undefined);
      return;
    }
    if (onboardShellRef.current && !interviewingRef.current) {
      onboardShellRef.current = false;
      overlayGenRef.current += 1;
      setInterviewShell(false);
      if (isTauri()) {
        void invoke("exit_interview_overlay").catch(() => undefined);
      }
    }
  }

  function dismissOnboard() {
    writeOnboardDone();
    setShowOnboard(false);
    leaveOnboardOverlay();
  }

  function replayOnboard() {
    leaveOnboardOverlay();
    setShowMeMenu(false);
    setShowSettings(false);
    setOnboardSeq((n) => n + 1);
    setShowOnboard(true);
  }

  useEffect(() => {
    if (!isTauri()) {
      setError(
        "请在桌面窗口中使用（npm run tauri dev），不要用浏览器打开 localhost:1420",
      );
      return;
    }
    if (interviewReconcileOnceRef.current) {
      return;
    }
    interviewReconcileOnceRef.current = true;
    (async () => {
      try {
        const s = await invoke<Settings>("get_settings");
        setSettings({
          ...defaultSettings,
          ...s,
          shortcuts: mergeShortcutMap(s.shortcuts),
        });
      } catch (e) {
        setError(String(e));
      }
      await refreshSessions();
      await refreshMaterials({ quiet: true });
      await refreshMe();
      try {
        const meta = await invoke<{ model: string; configured: boolean }>(
          "get_llm_meta",
        );
        setLlmModel(meta.model);
      } catch {
        /* ignore */
      }

      // Reconcile UI shell with Rust live session after WebView reload / HMR.
      try {
        const live = await invoke<boolean>("is_interviewing");
        if (live) {
          const mode = readStoredInterviewUseMode();
          setInterviewUseMode(mode);
          try {
            const registered = await invoke<ShortcutStatusItem[]>(
              "register_interview_shortcuts",
            );
            setShortcutStatuses(registered);
            await invoke("enter_interview_overlay", { useMode: mode });
            setInterviewing(true);
            setInterviewShell(true);
            setShowInterviewPanel(false);
            await refreshAnswers();
            await refreshMe();
            setStatus(
              mode === "stealth"
                ? "面试进行中（防切屏）。听题与出答在桌面悬浮壳，不进闲聊。连接有效则扣时。"
                : "面试进行中。听题与出答在桌面悬浮壳，不进闲聊。连接有效则扣时。",
            );
          } catch (e) {
            try {
              await invoke("stop_interview");
            } catch {
              /* ignore */
            }
            try {
              await invoke("unregister_interview_shortcuts");
              await invoke("exit_interview_overlay");
            } catch {
              /* ignore */
            }
            clearStoredInterviewUseMode();
            setInterviewing(false);
            setInterviewShell(false);
            setError(String(e));
          }
        } else {
          setInterviewing(false);
          setInterviewShell(false);
          clearStoredInterviewUseMode();
          try {
            await invoke("unregister_interview_shortcuts");
            await invoke("exit_interview_overlay");
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore reconcile errors */
      }
    })();
  }, [refreshSessions, refreshMaterials, refreshMe, refreshAnswers]);

  useEffect(() => {
    if (page === "me" || page === "records") {
      pageHeadingRef.current?.focus();
    }
  }, [page]);

  useEffect(() => {
    const resolved = resolveTheme(uiTheme);
    document.documentElement.setAttribute("data-theme", resolved);
    try {
      localStorage.setItem(uiPrefsKey("theme"), uiTheme);
    } catch {
      /* ignore */
    }
    if (uiTheme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.setAttribute(
        "data-theme",
        mq.matches ? "dark" : "light",
      );
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [uiTheme]);

  useEffect(() => {
    const { accent, hover } = accentCss(uiAccent);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-hover", hover);
    try {
      localStorage.setItem(uiPrefsKey("accent"), uiAccent);
    } catch {
      /* ignore */
    }
  }, [uiAccent]);

  useEffect(() => {
    try {
      localStorage.setItem(uiPrefsKey("language"), uiLanguage);
    } catch {
      /* ignore */
    }
  }, [uiLanguage]);

  useEffect(() => {
    if (!showSettings || settingsTab !== "shortcuts" || !isTauri()) return;
    void refreshShortcutProbe();
  }, [showSettings, settingsTab]);

  useEffect(() => {
    if (!rebindingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      const key =
        e.key.length === 1
          ? e.key.toUpperCase()
          : e.key === " "
            ? "Space"
            : e.key;
      parts.push(key);
      if (parts.length < 2) return;
      const accel = parts.join("+");
      const nextMap = {
        ...mergeShortcutMap(settings.shortcuts),
        [rebindingId]: accel,
      };
      void persistSettingsPatch({ shortcuts: nextMap });
      setRebindingId(null);
      window.setTimeout(() => void refreshShortcutProbe(), 50);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rebindingId, settings.shortcuts]);

  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  useEffect(() => {
    if (!showSettings || settingsTab !== "audio" || !isTauri()) return;
    let cancelled = false;
    setAudioDevicesLoading(true);
    setAudioDevicesError("");
    void (async () => {
      try {
        const [raw, perms] = await Promise.all([
          invoke<Record<string, unknown>>("list_audio_devices"),
          invoke<AudioPermissionStatus>("check_audio_permissions"),
        ]);
        if (cancelled) return;
        const microphones = (Array.isArray(raw.microphones)
          ? raw.microphones
          : []) as AudioDeviceInfo[];
        const system_outputs = (Array.isArray(raw.system_outputs)
          ? raw.system_outputs
          : Array.isArray(raw.systemOutputs)
            ? raw.systemOutputs
            : []) as AudioDeviceInfo[];
        setAudioDevices({ microphones, system_outputs });
        setAudioPerms({
          microphone: Boolean(perms.microphone),
          screen_and_system: Boolean(
            perms.screen_and_system ??
              (perms as { screenAndSystem?: boolean }).screenAndSystem,
          ),
        });
        if (microphones.length === 0 && system_outputs.length === 0) {
          setAudioDevicesError("未读到本机音频设备，请检查系统声音设置后重试。");
        }
      } catch (e) {
        if (!cancelled) {
          setAudioDevicesError(String(e));
          setError(String(e));
        }
      } finally {
        if (!cancelled) setAudioDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings, settingsTab]);

  async function openPrivacySettings(kind: "microphone" | "screen") {
    const url =
      kind === "microphone"
        ? "ms-settings:privacy-microphone"
        : "ms-settings:privacy-graphicscapture";
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshAudioPermissions() {
    if (!isTauri()) return;
    try {
      const perms = await invoke<AudioPermissionStatus>("check_audio_permissions");
      setAudioPerms({
        microphone: Boolean(perms.microphone),
        screen_and_system: Boolean(
          perms.screen_and_system ??
            (perms as { screenAndSystem?: boolean }).screenAndSystem,
        ),
      });
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!showSettings || settingsTab !== "audio" || !isTauri()) return;
    let unLevel: (() => void) | undefined;
    let unErr: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unLevel = await listen<{ kind?: string; level?: number }>(
        "audio-test-level",
        (ev) => {
          const kind = ev.payload.kind;
          const level = Number(ev.payload.level ?? 0);
          if (kind === "mic") setMicLevel(level);
          if (kind === "system") setSystemLevel(level);
        },
      );
      unErr = await listen<{ message?: string }>("audio-test-error", (ev) => {
        setError(ev.payload.message || "设备测试失败");
        setTestingMic(false);
        setTestingSystem(false);
        setMicLevel(0);
        setSystemLevel(0);
      });
    })();
    return () => {
      unLevel?.();
      unErr?.();
    };
  }, [showSettings, settingsTab]);

  useEffect(() => {
    if (showSettings && settingsTab === "audio") return;
    if (!testingMic && !testingSystem) return;
    setTestingMic(false);
    setTestingSystem(false);
    setMicLevel(0);
    setSystemLevel(0);
    if (isTauri()) {
      void invoke("stop_audio_device_test").catch(() => undefined);
    }
  }, [showSettings, settingsTab, testingMic, testingSystem]);

  async function persistSettingsPatch(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await invoke("save_app_settings", { settings: next });
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleAudioTest(kind: "mic" | "system") {
    if (!isTauri()) return;
    const active = kind === "mic" ? testingMic : testingSystem;
    if (active) {
      await invoke("stop_audio_device_test");
      setTestingMic(false);
      setTestingSystem(false);
      setMicLevel(0);
      setSystemLevel(0);
      return;
    }
    const deviceId =
      kind === "mic"
        ? settings.mic_device_id
        : settings.system_audio_device_id;
    try {
      await invoke("start_audio_device_test", { kind, deviceId });
      setTestingMic(kind === "mic");
      setTestingSystem(kind === "system");
      if (kind === "mic") setSystemLevel(0);
      else setMicLevel(0);
    } catch (e) {
      setError(String(e));
      setTestingMic(false);
      setTestingSystem(false);
    }
  }

  useEffect(() => {
    if (!settings.interview_token.trim() || !isTauri()) return;
    void refreshSessions();
    void refreshMaterials({ quiet: true });
    void refreshAnswers();
    void refreshMe();
    void invoke<{ model: string; configured: boolean }>("get_llm_meta")
      .then((meta) => setLlmModel(meta.model))
      .catch(() => undefined);
  }, [
    settings.interview_token,
    refreshSessions,
    refreshMaterials,
    refreshAnswers,
    refreshMe,
  ]);

  useEffect(() => {
    editorRef.current = {
      resume: resumeText,
      jd: jdText,
      name: profileName,
      language: profileLanguage,
      skills: skillsText,
      profileId,
    };
  }, [resumeText, jdText, profileName, profileLanguage, skillsText, profileId]);

  useEffect(() => {
    if (!settings.interview_token.trim() || !isTauri()) return;
    if (page !== "me") {
      stashCurrentDraft();
      return;
    }
    return afterPaint(() => {
      void refreshMaterials({ quiet: true });
    });
  }, [page, settings.interview_token, refreshMaterials, stashCurrentDraft]);

  useEffect(() => {
    if (!settings.interview_email.trim()) return;
    try {
      const stored = localStorage.getItem(accessStorageKey(settings.interview_email));
      setAccessMode(stored === "full" ? "full" : "ask");
    } catch {
      /* ignore */
    }
  }, [settings.interview_email]);

  useEffect(() => {
    if (!showMeMenu) return;
    function onDoc(ev: Event) {
      const root = meMenuRef.current;
      if (root && ev.target instanceof Node && !root.contains(ev.target)) {
        setShowMeMenu(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMeMenu]);

  useEffect(() => {
    if (page !== "records") return;
    return afterPaint(() => {
      void refreshRounds();
    });
  }, [page, refreshRounds]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let unlistenErr: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<TranscriptLive>("interview-transcript", (ev) => {
        const { channel, kind, text } = ev.payload;
        const apply = (
          setFinals: (fn: (prev: string[]) => string[]) => void,
          setPartial: (v: string) => void,
        ) => {
          if (kind === "final") {
            if (text.trim()) {
              setFinals((prev) => {
                const t = text.trim().replace(/\s+/g, " ");
                const last = (prev[prev.length - 1] || "")
                  .trim()
                  .replace(/\s+/g, " ");
                if (last === t) return prev;
                return [...prev, text.trim()];
              });
            }
            setPartial("");
          } else {
            setPartial(text);
          }
        };
        if (channel === "self") {
          apply(setSelfFinals, setSelfPartial);
        } else {
          apply(setInterviewerFinals, setInterviewerPartial);
        }
      });
      unlistenErr = await listen<{ message?: string }>("interview-error", (ev) => {
        const msg =
          (ev.payload as { message?: string })?.message ||
          "听题暂时不可用";
        setError(String(msg));
      });
      unlistenStatus = await listen<Record<string, unknown>>(
        "interview-status",
        (ev) => {
          const p = ev.payload || {};
          // Do NOT tear down the interview shell here. WS/listen can drop during
          // long LLM HTTP while the user still needs the overlay. Explicit stop
          // paths call exit_interview_overlay themselves.
          if (p.listening === false) {
            if (typeof p.notice === "string" && p.notice) {
              setStatus(String(p.notice));
            } else {
              setStatus("听题连接已断开，面试壳仍保留。可点结束退出，或检查服务后重开。");
            }
            void refreshMe();
          }
          if (typeof p.notice === "string" && p.notice && p.listening !== false) {
            setStatus(p.notice);
          }
        },
      );
    })();
    return () => {
      unlisten?.();
      unlistenErr?.();
      unlistenStatus?.();
    };
  }, [refreshMe]);

  useEffect(() => {
    if (!isTauri()) return;
    let unEnter: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unEnter = await listen("overlay-ui-enter", () => {
        setInterviewShell(true);
      });
      unExit = await listen("overlay-ui-exit", () => {
        setInterviewShell(false);
        setInterviewing(false);
        clearStoredInterviewUseMode();
        void getCurrentWindow()
          .setIgnoreCursorEvents(false)
          .catch(() => undefined);
      });
    })();
    return () => {
      unEnter?.();
      unExit?.();
    };
  }, []);

  useEffect(() => {
    const box = chatScrollRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [chat, busy]);

  async function persistAuthSettings() {
    await invoke("save_app_settings", { settings });
  }

  function onAuthLoggedIn(acc: InterviewAccount) {
    const token = acc.token || (acc as { Token?: string }).Token || "";
    const email = acc.email || (acc as { Email?: string }).Email || "";
    setSettings((prev) => ({
      ...prev,
      interview_token: token,
      interview_email: email,
    }));
    setError("");
    setStatus(`已登录 ${email}`);
    setPage("chat");
  }

  async function onLogoutInterview() {
    setError("");
    setLogoutBusy(true);
    try {
      await invoke("logout_interview");
      setSettings((prev) => ({
        ...prev,
        interview_token: "",
        interview_email: "",
      }));
      setResumeText("");
      setJdText("");
      setProfileName("默认档案");
      setProfileLanguage("");
      setSkillsText("");
      setMaterialsReady(false);
      setStatus("已退出登录");
      setShowMeMenu(false);
      setPage("chat");
    } catch (e) {
      setError(String(e));
    } finally {
      setLogoutBusy(false);
    }
  }

  function openInterviewModeModal() {
    setError("");
    setShowMeMenu(false);
    if (!resumeText.trim() || !jdText.trim()) {
      setError("开面前请先在「档案」填写简历和职位描述");
      setPage("me");
      return;
    }
    setInterviewUseMode("meeting");
    setShowInterviewModeModal(true);
    if (isTauri()) {
      void refreshShortcutProbe();
    }
  }

  async function refreshShortcutProbe() {
    try {
      const items = await invoke<ShortcutStatusItem[]>("probe_shortcuts");
      setShortcutStatuses(items);
      return items;
    } catch (e) {
      setError(String(e));
      return [] as ShortcutStatusItem[];
    }
  }

  async function proceedStartInterview() {
    setError("");
    setShowInterviewModeModal(false);
    const approved = await requireApprove(
      "开始面试",
      "连接有效会扣时长。确定现在开面？",
    );
    if (!approved) {
      return;
    }
    setInterviewerFinals([]);
    setInterviewerPartial("");
    setSelfFinals([]);
    setSelfPartial("");
    setStatus("正在连接开面服务…");
    try {
      const mat = await invoke<MaterialsView>("save_interview_materials", {
        resume: resumeText,
        jd: jdText,
        profileName,
        language: profileLanguage,
        skills: skillsText,
      });
      applyMaterials(mat);
      if (!mat.ready) {
        setError("开面前请先在「档案」填写简历和职位描述");
        setPage("me");
        setStatus("");
        return;
      }
      await invoke("start_interview");
      const registered = await invoke<ShortcutStatusItem[]>(
        "register_interview_shortcuts",
      );
      setShortcutStatuses(registered);
      persistInterviewUseMode(interviewUseMode);
      await invoke("enter_interview_overlay", { useMode: interviewUseMode });
      setAnswers([]);
      setInterviewing(true);
      setInterviewShell(true);
      setShowInterviewPanel(false);
      setPage("chat");
      await refreshAnswers();
      setStatus(
        interviewUseMode === "stealth"
          ? "面试进行中（防切屏）。听题与出答在桌面悬浮壳，不进闲聊。连接有效则扣时。"
          : "面试进行中。听题与出答在桌面悬浮壳，不进闲聊。连接有效则扣时。",
      );
    } catch (e) {
      setInterviewing(false);
      setInterviewShell(false);
      clearStoredInterviewUseMode();
      try {
        await invoke("unregister_interview_shortcuts");
        await invoke("exit_interview_overlay");
      } catch {
        /* ignore */
      }
      setError(String(e));
      setStatus("");
    }
  }

  async function onStartInterview() {
    setError("");
    // Re-probe once so tip stays accurate, then start (occupied keys stay unusable this round)
    await refreshShortcutProbe();
    await proceedStartInterview();
  }

  async function onStopInterview() {
    setError("");
    try {
      await invoke("stop_interview");
    } catch {
      /* already stopped / WS already dead */
    }
    setStatus("正在结束面试…");
    setShowInterviewPanel(false);
    setInterviewing(false);
    setInterviewShell(false);
    clearStoredInterviewUseMode();
    try {
      await invoke("unregister_interview_shortcuts");
      await invoke("exit_interview_overlay");
    } catch (e) {
      setError(String(e));
    }
    try {
      await getCurrentWindow().setIgnoreCursorEvents(false);
    } catch {
      /* ignore */
    }
  }

  function showChatAlert(detail: unknown) {
    const raw = String(detail ?? "").trim() || "操作失败，请稍后重试";
    setChatAlert(raw);
  }

  useEffect(() => {
    if (!chatAlert) return;
    const timer = window.setTimeout(() => setChatAlert(null), 3200);
    return () => window.clearTimeout(timer);
  }, [chatAlert]);

  async function onSend() {
    setError("");
    if (!ask.trim()) return;
    setBusy(true);
    setStatus("闲聊生成中…");
    try {
      let sid = currentSessionId;
      if (!sid) {
        const session = await invoke<ChatSession>("create_chat_session");
        sid = session.id;
        setCurrentSessionId(sid);
      }
      const userText = ask.trim();
      setAsk("");
      setChat((prev) => [...prev, { role: "user", content: userText }]);
      const reply = await invoke<string>("send_chat_message", {
        sessionId: sid,
        text: userText,
      });
      setChat((prev) => [...prev, { role: "assistant", content: reply }]);
      await refreshSessions();
      setStatus("");
      inputRef.current?.focus();
    } catch (e) {
      showChatAlert(e);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function onNewSession() {
    try {
      const session = await invoke<ChatSession>("create_chat_session");
      setCurrentSessionId(session.id);
      setChat([]);
      await refreshSessions();
      setStatus("已开始新闲聊");
    } catch (e) {
      showChatAlert(e);
    }
  }

  async function onSaveMaterials() {
    setError("");
    const approved = await requireApprove(
      "保存档案",
      "会改本账户的档案名称、语言、技能、简历和职位描述。确定保存？",
    );
    if (!approved) {
      return;
    }
    materialsEpochRef.current += 1;
    try {
      const mat = await invoke<MaterialsView>("save_interview_materials", {
        resume: resumeText,
        jd: jdText,
        profileName,
        language: profileLanguage,
        skills: skillsText,
        profileId: profileId || undefined,
        createNew: false,
      });
      applyMaterials(mat);
      await refreshProfiles();
      setStatus(mat.ready ? "档案已保存" : "简历和职位描述都填齐后才能开面出答");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onAddProfileDraft() {
    if (addingProfileRef.current) return;
    addingProfileRef.current = true;
    setAddingProfile(true);
    setError("");
    setProfileCollapsed(false);
    materialsEpochRef.current += 1;
    const epoch = materialsEpochRef.current;
    const tempId = `draft-${Date.now()}`;
    setProfiles((prev) => [
      {
        id: tempId,
        name: "新档案",
        language: "",
        ready: false,
        is_active: true,
      },
      ...prev.map((p) => ({ ...p, is_active: false })),
    ]);
    applyMaterials({
      resume: "",
      jd: "",
      ready: false,
      profile_name: "新档案",
      language: "",
      skills: "",
      profile_id: tempId,
    });
    setStatus("已新建空白档案，填写后请点「保存档案」");
    try {
      const mat = await invoke<MaterialsView>("save_interview_materials", {
        resume: "",
        jd: "",
        profileName: "新档案",
        language: "",
        skills: "",
        createNew: true,
      });
      const realId = (mat.profile_id || "").trim();
      const stashed = profileDraftsRef.current.get(tempId);
      if (realId && tempId !== realId) {
        if (stashed) {
          profileDraftsRef.current.delete(tempId);
          profileDraftsRef.current.set(realId, { ...stashed, profileId: realId });
        } else if (editorRef.current.profileId === tempId && isEditorDirty()) {
          profileDraftsRef.current.set(realId, {
            ...editorRef.current,
            profileId: realId,
          });
        }
      }
      setProfiles((prev) => {
        const rest = prev.filter((p) => p.id !== tempId && p.id !== realId);
        if (!realId) return rest;
        const keepLocal =
          isEditorDirty() &&
          (editorRef.current.profileId === tempId ||
            editorRef.current.profileId === realId);
        return [
          {
            id: realId,
            name: keepLocal
              ? editorRef.current.name.trim() || "新档案"
              : mat.profile_name?.trim() || "新档案",
            language: keepLocal
              ? editorRef.current.language
              : mat.language || "",
            ready: keepLocal
              ? Boolean(
                  editorRef.current.resume.trim() && editorRef.current.jd.trim(),
                )
              : Boolean(mat.ready),
            is_active: epoch === materialsEpochRef.current,
          },
          ...rest.map((p) => ({ ...p, is_active: false })),
        ];
      });
      if (epoch !== materialsEpochRef.current) {
        void refreshProfiles();
        return;
      }
      if (isEditorDirty()) {
        if (realId) {
          setProfileId(realId);
          editorRef.current = { ...editorRef.current, profileId: realId };
        }
      } else {
        applyMaterials(mat);
      }
      void refreshProfiles();
    } catch (e) {
      if (epoch === materialsEpochRef.current) {
        setProfiles((prev) => prev.filter((p) => p.id !== tempId));
        setError(String(e));
        setStatus("");
      }
    } finally {
      addingProfileRef.current = false;
      setAddingProfile(false);
    }
  }

  async function onDeleteProfile(targetId?: string) {
    setError("");
    const id = (targetId || profileId).trim();
    if (!id) {
      setError("没有可删除的档案");
      return;
    }
    const label =
      profiles.find((p) => p.id === id)?.name ||
      (id === profileId ? profileName : "") ||
      "当前档案";
    const approved = await requireApprove(
      "删除档案",
      `将删除「${label}」，其他档案不受影响。确定删除？`,
    );
    if (!approved) return;
    materialsEpochRef.current += 1;
    profileDraftsRef.current.delete(id);
    try {
      const mat = await invoke<MaterialsView>("delete_interview_profile", {
        profileId: id,
      });
      applyMaterials(mat);
      await refreshProfiles();
      setStatus(mat.profile_id ? "档案已删除，已切换到另一份" : "档案已删除");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSelectProfile(id: string) {
    if (!id || id === profileId) return;
    if (id.startsWith("draft-")) return;
    setError("");
    stashCurrentDraft();
    materialsEpochRef.current += 1;
    setProfileId(id);
    setProfiles((prev) =>
      prev.map((p) => ({ ...p, is_active: p.id === id })),
    );
    await refreshMaterials({ profileId: id });
  }

  async function onSelectSession(id: string) {
    if (id === currentSessionId) return;
    setError("");
    try {
      const messages = await invoke<ChatMessage[]>("load_chat_session", {
        sessionId: id,
      });
      setCurrentSessionId(id);
      setChat(messages);
      setStatus("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDeleteRound(e: MouseEvent, id: string) {
    e.stopPropagation();
    setError("");
    try {
      await invoke("delete_interview_round", { roundId: id });
      if (selectedRoundId === id) {
        setSelectedRoundId(null);
        setRecordAnswers([]);
      }
      await refreshRounds();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDeleteSession(e: MouseEvent, id: string) {
    e.stopPropagation();
    setError("");
    try {
      await invoke("delete_chat_session", { sessionId: id });
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setChat([]);
      }
      await refreshSessions();
    } catch (err) {
      setError(String(err));
    }
  }

  const emptyChat = chat.length === 0;
  const loggedIn = Boolean(settings.interview_token.trim());

  if (!loggedIn) {
    return (
      <AppFrame>
        <TitleBar variant="auth" />
        <AuthScreen
          persistSettings={persistAuthSettings}
          onLoggedIn={onAuthLoggedIn}
        />
      </AppFrame>
    );
  }

  return (
    <div className="app-host">
    {interviewShell ? (
      <InterviewOverlay demo={showOnboard && !interviewing} />
    ) : (
    <AppFrame>
    <div className="app-shell">
      <aside className="sidebar">
        <div
          className="side-top"
          data-tauri-drag-region
          onMouseDown={beginWindowDrag}
          onDoubleClick={() => {
            if (!isTauri()) return;
            void getCurrentWindow().toggleMaximize();
          }}
        >
          <WindowControls />
          <div
            className="side-top-drag"
            data-tauri-drag-region
            onMouseDown={beginWindowDrag}
          />
        </div>
        <nav className="side-nav" aria-label="主要" data-tour="nav">
          <button
            type="button"
            className={page === "chat" ? "side-item active" : "side-item"}
            onClick={() => setPage("chat")}
            title="闲聊"
            aria-current={page === "chat" ? "page" : undefined}
          >
            <span className="side-ico">
              <IconChat />
            </span>
            <span>闲聊</span>
          </button>
          <button
            type="button"
            className={page === "records" ? "side-item active" : "side-item"}
            onClick={() => setPage("records")}
            title="面试记录"
            aria-current={page === "records" ? "page" : undefined}
          >
            <span className="side-ico">
              <IconRecords />
            </span>
            <span>面试记录</span>
          </button>
          <button
            type="button"
            className={page === "me" ? "side-item active" : "side-item"}
            data-tour="profile"
            onClick={() => setPage("me")}
            title="档案"
            aria-current={page === "me" ? "page" : undefined}
          >
            <span className="side-ico">
              <IconProfile />
            </span>
            <span>档案</span>
          </button>
        </nav>
        <div className="side-foot">
          {interviewing && (
            <div className="side-rec live" title="面试进行中">
              <span className="rec-dot" />
              <span>面试进行中</span>
            </div>
          )}
          <div className="me-wrap" ref={meMenuRef}>
            {showMeMenu ? (
              <div className="me-pop" role="dialog" aria-label="我的">
                <div className="me-pop-head">
                  <span className="side-me-avatar" aria-hidden>
                    <img src={sideLogo} alt="" width="22" height="22" />
                  </span>
                  <span className="me-pop-head-text">
                    <span className="me-pop-name">当前账户</span>
                    <span className="me-pop-email">
                      {settings.interview_email.trim() || "未登录"}
                    </span>
                  </span>
                </div>
                <div className="me-pop-group">
                  <button
                    type="button"
                    className="me-pop-item"
                    onClick={() => {
                      void openWebPage(WEB_PATHS.plans, accountWebQuery());
                    }}
                  >
                    <span className="side-ico">
                      <IconCard />
                    </span>
                    套餐购买
                    <span className="me-pop-chevron">
                      <IconChevron dir="right" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={showSettings ? "me-pop-item active" : "me-pop-item"}
                    onClick={() => {
                      setSettingsTab("general");
                      setShowSettings(true);
                      setShowMeMenu(false);
                    }}
                  >
                    <span className="side-ico">
                      <IconGear />
                    </span>
                    设置
                  </button>
                </div>
                <div className="me-pop-group">
                  <button
                    type="button"
                    className="me-pop-item"
                    onClick={() => {
                      void openWebPage(WEB_PATHS.contact, {
                        email: settings.interview_email.trim() || undefined,
                        topic: "桌面听题",
                      });
                    }}
                  >
                    <span className="side-ico">
                      <IconHeadset />
                    </span>
                    联系客服
                    <span className="me-pop-chevron">
                      <IconChevron dir="right" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="me-pop-item"
                    onClick={() => replayOnboard()}
                  >
                    <span className="side-ico">
                      <IconGuide />
                    </span>
                    使用引导
                  </button>
                  <button
                    type="button"
                    className="me-pop-item"
                    onClick={() => {
                      void openWebPage(WEB_PATHS.help);
                    }}
                  >
                    <span className="side-ico">
                      <IconHelp />
                    </span>
                    帮助
                    <span className="me-pop-chevron">
                      <IconChevron dir="right" />
                    </span>
                  </button>
                </div>
                <div className="me-pop-group">
                  <button
                    type="button"
                    className="me-pop-item danger"
                    disabled={logoutBusy}
                    onClick={() => void onLogoutInterview()}
                  >
                    <span className="side-ico">
                      <IconExit />
                    </span>
                    {logoutBusy ? "退出中…" : "退出登录"}
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className={showMeMenu ? "side-me open" : "side-me"}
              data-tour="me"
              onClick={() => {
                setShowMeMenu((v) => !v);
              }}
              title={settings.interview_email || "我的"}
              aria-label="我的"
              aria-expanded={showMeMenu}
              aria-haspopup="dialog"
            >
              <span className="side-me-avatar" aria-hidden>
                <img src={sideLogo} alt="" width="22" height="22" />
              </span>
              <span className="side-me-text">
                <span className="side-me-label">我的</span>
                <span className="side-me-meta">{balanceMinutes} 分钟</span>
              </span>
              <span className="side-me-caret">
                <IconChevron dir={showMeMenu ? "up" : "down"} />
              </span>
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        {page === "chat" ? (
          <div className="chat-page">
            <aside
              className={
                historyCollapsed ? "history-rail collapsed" : "history-rail"
              }
            >
              {historyCollapsed ? (
                <div className="history-collapsed-bar">
                  <button
                    type="button"
                    className="history-toggle"
                    title="展开聊天历史"
                    aria-label="展开聊天历史"
                    onClick={() => setHistoryCollapsed(false)}
                  >
                    <IconChevron dir="right" />
                  </button>
                  <button
                    type="button"
                    className="history-new"
                    onClick={onNewSession}
                    title="新对话"
                    aria-label="新对话"
                  >
                    <IconPlus />
                  </button>
                </div>
              ) : (
                <>
                  <div className="history-head rail-head">
                    <span className="history-label">闲聊历史</span>
                    <div className="history-head-actions">
                      <button
                        type="button"
                        className="history-toggle"
                        title="收起聊天历史"
                        aria-label="收起聊天历史"
                        onClick={() => setHistoryCollapsed(true)}
                      >
                        <IconChevron dir="left" />
                      </button>
                      <button
                        type="button"
                        className="history-new"
                        onClick={onNewSession}
                        title="新对话"
                        aria-label="新对话"
                      >
                        <IconPlus />
                      </button>
                    </div>
                  </div>
                  <div className="history-list">
                    {sessions.length === 0 ? (
                      <p className="history-empty">
                        暂无闲聊。发送后跟账户走，换电脑仍在。不保存本场出答。
                      </p>
                    ) : (
                      sessions.map((s) => (
                        <div
                          key={s.id}
                          className={
                            s.id === currentSessionId
                              ? "history-item active"
                              : "history-item"
                          }
                          onClick={() => onSelectSession(s.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") onSelectSession(s.id);
                          }}
                        >
                          <div className="history-title">
                            {s.title || "新对话"}
                          </div>
                          <div className="history-meta">{s.updated_at}</div>
                          <button
                            type="button"
                            className="history-del"
                            title="删除"
                            onClick={(ev) => onDeleteSession(ev, s.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </aside>

            <div className="chat-main">
            <div className="chat-scroll" ref={chatScrollRef}>
              <div className="chat-inner">
                {emptyChat ? (
                  <div className="welcome">
                    <div className="welcome-mark">
                      <img src={appLogo} alt="" width="36" height="52" />
                    </div>
                    <h1>今天有什么可以帮到你？</h1>
                    <p className="welcome-sub">
                      下方是闲聊，跟账户走。开面听题与出答在独立面试面板，不会写进闲聊。
                    </p>
                  </div>
                ) : (
                  <div className="messages">
                    {chat.map((m, i) =>
                      m.role === "user" ? (
                        <div key={i} className="msg msg-user">
                          <div className="msg-user-pill">{m.content}</div>
                        </div>
                      ) : (
                        <div key={i} className="msg msg-ai">
                          <div className="msg-ai-meta">已完成</div>
                          <ChatMarkdown content={m.content} />
                        </div>
                      ),
                    )}
                    {busy && (
                      <div className="msg msg-ai">
                        <div className="msg-ai-meta thinking">正在回复…</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <div className="composer-tools">
                  {!interviewing ? (
                    <button
                      type="button"
                      className="tool-btn accent"
                      data-tour="start"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setShowMeMenu(false);
                        setPage("me");
                      }}
                      title="前往档案，确认材料后开始面试"
                    >
                      开始面试
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="tool-btn accent"
                        onClick={() => {
                          setInterviewShell(true);
                          void invoke("enter_interview_overlay", {
                            useMode: interviewUseMode,
                          });
                        }}
                        title="打开桌面悬浮壳"
                      >
                        打开面试悬浮壳
                      </button>
                      <button
                        type="button"
                        className="tool-btn danger"
                        onClick={onStopInterview}
                      >
                        结束面试
                      </button>
                    </>
                  )}
                </div>

                <div className="composer-input">
                  <textarea
                    ref={inputRef}
                    value={ask}
                    rows={1}
                    placeholder="闲聊…"
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="send-btn"
                    disabled={busy || !ask.trim()}
                    onClick={() => onSend()}
                  >
                    发送
                  </button>
                </div>
                <div className="composer-hint">
                  <span>
                    {interviewing
                      ? status || "面试进行中 · 听题出答见右上面板"
                      : status || "Enter 发送 · Shift+Enter 换行"}
                  </span>
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : page === "records" ? (
          <div className="records-page">
            <aside
              className={
                recordsCollapsed ? "records-rail collapsed" : "records-rail"
              }
              aria-label="面试场次"
            >
              {recordsCollapsed ? (
                <div className="history-collapsed-bar">
                  <button
                    type="button"
                    className="history-toggle"
                    title="展开面试场次"
                    aria-label="展开面试场次"
                    onClick={() => setRecordsCollapsed(false)}
                  >
                    <IconChevron dir="right" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="records-rail-head rail-head">
                    <span className="history-label">面试场次</span>
                    <div className="history-head-actions">
                      <button
                        type="button"
                        className="history-toggle"
                        title="收起面试场次"
                        aria-label="收起面试场次"
                        onClick={() => setRecordsCollapsed(true)}
                      >
                        <IconChevron dir="left" />
                      </button>
                    </div>
                  </div>
                  <div className="records-list">
                    {rounds.length === 0 ? (
                      <p className="records-empty">
                        还没有面试场次。开面后会出现在这里，闲聊不会进来。
                      </p>
                    ) : (
                      rounds.map((r) => (
                        <div
                          key={r.id}
                          className={
                            selectedRoundId === r.id
                              ? "records-item active"
                              : "records-item"
                          }
                          role="button"
                          tabIndex={0}
                          onClick={() => void openRound(r.id)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") void openRound(r.id);
                          }}
                        >
                          <span className="records-item-time">
                            {formatRoundTime(r.created_at)}
                          </span>
                          <span className="records-item-id">{r.id}</span>
                          <button
                            type="button"
                            className="history-del"
                            title="删除"
                            aria-label="删除这场面试"
                            onClick={(ev) => void onDeleteRound(ev, r.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </aside>
            <div className="records-main">
              <h1 ref={pageHeadingRef} tabIndex={-1}>
                面试记录
              </h1>
              <p className="records-hint">
                当场听题，结束后以出答为准。听题全文不落盘。
              </p>
              {!selectedRoundId ? (
                <p className="me-empty">
                  {rounds.length === 0
                    ? "开过一场并生成出答后，从左侧打开。"
                    : "从左侧打开一场，查看该场出答。"}
                </p>
              ) : recordAnswers.length === 0 ? (
                <p className="me-empty">这场还没有出答。</p>
              ) : (
                <div className="records-qa">
                  {recordAnswers.map((a, i) => (
                    <div key={`${a.created_at}-${i}`} className="records-qa-item">
                      <div className="answer-q">{a.question}</div>
                      <div className="answer-a">{a.answer}</div>
                    </div>
                  ))}
                </div>
              )}
              {error && page === "records" ? (
                <p className="err me-account-err">{error}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="me-page">
            <aside
              className={
                profileCollapsed ? "profile-rail collapsed" : "profile-rail"
              }
            >
              {profileCollapsed ? (
                <div className="history-collapsed-bar">
                  <button
                    type="button"
                    className="history-toggle"
                    title="展开档案列表"
                    aria-label="展开档案列表"
                    onClick={() => setProfileCollapsed(false)}
                  >
                    <IconChevron dir="right" />
                  </button>
                  <button
                    type="button"
                    className="profile-icon-btn"
                    title="新建档案"
                    aria-label="新建档案"
                    disabled={addingProfile}
                    onClick={() => void onAddProfileDraft()}
                  >
                    <IconPlus />
                  </button>
                </div>
              ) : (
                <>
              <div className="profile-rail-head rail-head">
                <h1 ref={pageHeadingRef} tabIndex={-1}>
                  档案
                </h1>
                <div className="profile-rail-actions">
                  <button
                    type="button"
                    className="history-toggle"
                    title="收起档案列表"
                    aria-label="收起档案列表"
                    onClick={() => setProfileCollapsed(true)}
                  >
                    <IconChevron dir="left" />
                  </button>
                  <button
                    type="button"
                    className="profile-icon-btn"
                    title="新建档案"
                    aria-label="新建档案"
                    disabled={addingProfile}
                    onClick={() => void onAddProfileDraft()}
                  >
                    <IconPlus />
                  </button>
                </div>
              </div>
              <div className="profile-card-list">
                {(profiles.length
                  ? profiles
                  : profileId
                    ? [
                        {
                          id: profileId,
                          name: profileName || "默认档案",
                          language: profileLanguage,
                          ready: materialsReady,
                          is_active: true,
                        },
                      ]
                    : []
                ).map((p) => (
                  <div
                    key={p.id}
                    className={
                      p.id === profileId ? "profile-card active" : "profile-card"
                    }
                  >
                    <button
                      type="button"
                      className="profile-card-select"
                      onClick={() => void onSelectProfile(p.id)}
                    >
                      <div className="profile-card-top">
                        <span className="profile-card-name">{p.name || "默认档案"}</span>
                        {p.id === profileId ? (
                          <span className="profile-tag">当前</span>
                        ) : null}
                      </div>
                      <div className="profile-card-meta">
                        {p.ready ? "已齐" : "未齐"}
                        {p.language ? ` · ${p.language}` : ""}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="profile-icon-btn danger profile-card-del"
                      title="删除档案"
                      aria-label={`删除 ${p.name || "档案"}`}
                      onClick={() => void onDeleteProfile(p.id)}
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
                {profiles.length === 0 && !profileId ? (
                  <p className="profile-rail-empty muted">暂无档案，点 ＋ 新建</p>
                ) : null}
              </div>
                </>
              )}
            </aside>
            <div className="profile-editor">
              <>
                  <header className="profile-editor-head">
                    <div>
                      <div className="profile-editor-title">
                        <span>{profileName || "默认档案"}</span>
                        <span className="profile-tag">当前</span>
                      </div>
                      <div className="profile-editor-meta">
                        {materialsReady
                          ? "已齐，可以开面"
                          : resumeText.trim() || jdText.trim()
                            ? "简历和职位描述都要有"
                            : "未设置"}
                        {profileLanguage ? ` · ${profileLanguage}` : " · 未设置语言"}
                      </div>
                    </div>
                    <div className="profile-editor-actions">
                      <button
                        type="button"
                        className="profile-icon-btn"
                        title="新建档案"
                        aria-label="新建档案"
                        disabled={addingProfile}
                        onClick={() => void onAddProfileDraft()}
                      >
                        <IconPlus />
                      </button>
                    </div>
                  </header>
                  {error && <p className="err me-account-err">{error}</p>}
                  <section className="profile-content-box" aria-label="档案内容">
                    <div className="profile-content-label">档案内容</div>
                    <div className="profile-checks">
                      <div className="profile-check-col">
                        <div className="profile-check-head">面试信息</div>
                        <label className="profile-check">
                          <span
                            className={
                              profileLanguage ? "profile-dot on" : "profile-dot"
                            }
                            aria-hidden="true"
                          />
                          初始语言
                        </label>
                        <label className="profile-check">
                          <span
                            className={jdText.trim() ? "profile-dot on" : "profile-dot"}
                            aria-hidden="true"
                          />
                          职位描述
                        </label>
                        <label className="profile-check">
                          <span
                            className={
                              resumeText.trim() ? "profile-dot on" : "profile-dot"
                            }
                            aria-hidden="true"
                          />
                          简历
                        </label>
                        <label className="profile-check">
                          <span
                            className={
                              skillsText.trim() ? "profile-dot on" : "profile-dot"
                            }
                            aria-hidden="true"
                          />
                          技能
                        </label>
                      </div>
                    </div>
                  </section>
                  <section className="profile-block">
                    <h2>名称与语言</h2>
                    <div className="profile-name-row">
                      <input
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="默认档案"
                        maxLength={64}
                      />
                      <select
                        value={profileLanguage}
                        onChange={(e) => setProfileLanguage(e.target.value)}
                      >
                        <option value="">未设置</option>
                        {PROFILE_LANGUAGES.map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>
                  <section className="profile-block">
                    <h2>简历</h2>
                    <p className="set-desc">粘贴完整正文。开面后出答按本场快照，不读之后的改动。</p>
                    <textarea
                      className="profile-resume"
                      rows={12}
                      value={resumeText}
                      onChange={(e) => setResumeText(e.target.value)}
                      placeholder="在此粘贴完整正文"
                    />
                  </section>
                  <section className="profile-block">
                    <h2>职位描述</h2>
                    <textarea
                      className="profile-resume profile-resume-jd"
                      rows={8}
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      placeholder="粘贴本场岗位 JD"
                    />
                  </section>
                  <section className="profile-block">
                    <h2>技能</h2>
                    <p className="set-desc">写你会的技术或能力，出答可以对照，不能编造这里没有的项。</p>
                    <textarea
                      className="profile-resume profile-resume-jd"
                      rows={5}
                      value={skillsText}
                      onChange={(e) => setSkillsText(e.target.value)}
                      placeholder="例如：Python、系统设计、英文面试"
                    />
                  </section>
                  <div className="profile-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={onSaveMaterials}
                    >
                      保存档案
                    </button>
                    <button
                      type="button"
                      className="btn primary profile-start"
                      data-tour="start"
                      disabled={busy || interviewing}
                      onClick={openInterviewModeModal}
                    >
                      {interviewing ? "面试进行中" : "开始面试"}
                    </button>
                    {materialsReady ? (
                      <span className="ok">已齐</span>
                    ) : (
                      <span className="muted">缺一份则不能开面出答</span>
                    )}
                  </div>
              </>
            </div>
          </div>
        )}
      </div>
      {showSettings ? (
        <div
          className="settings-mask"
          role="presentation"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <aside className="settings-nav" aria-label="设置分类">
              <button
                type="button"
                className="settings-close"
                aria-label="关闭设置"
                onClick={() => setShowSettings(false)}
              >
                <IconClose />
              </button>
              <nav className="settings-nav-list">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={
                      settingsTab === tab.id
                        ? "settings-nav-item active"
                        : "settings-nav-item"
                    }
                    onClick={() => setSettingsTab(tab.id)}
                  >
                    <span className="settings-nav-ico" aria-hidden="true">
                      {settingsTabIcon(tab.id)}
                    </span>
                    {tab.label}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="settings-panel">
              <h2 id="settings-title" className="settings-panel-title">
                {SETTINGS_TABS.find((t) => t.id === settingsTab)?.label}
              </h2>
              {settingsTab === "general" ? (
                <div className="settings-rows">
                  <div className="settings-row">
                    <span>主题</span>
                    <select
                      className="settings-select"
                      value={uiTheme}
                      onChange={(e) => setUiTheme(e.target.value as UiTheme)}
                      aria-label="主题"
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>重点色</span>
                    <select
                      className="settings-select"
                      value={uiAccent}
                      onChange={(e) => setUiAccent(e.target.value as UiAccent)}
                      aria-label="重点色"
                    >
                      <option value="default">默认</option>
                      <option value="blue">蓝色</option>
                      <option value="green">绿色</option>
                      <option value="orange">橙色</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>语言</span>
                    <select
                      className="settings-select"
                      value={uiLanguage}
                      onChange={(e) =>
                        setUiLanguage(e.target.value as UiLanguage)
                      }
                      aria-label="语言"
                    >
                      <option value="auto">自动检测</option>
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>开面权限</span>
                    <select
                      className="settings-select"
                      value={accessMode}
                      onChange={(e) =>
                        persistAccessMode(e.target.value as AccessMode)
                      }
                      aria-label="开面权限"
                    >
                      <option value="ask">请求批准</option>
                      <option value="full">完全访问</option>
                    </select>
                  </div>
                </div>
              ) : null}
              {settingsTab === "shortcuts" ? (
                <div className="shortcut-settings">
                  <p className="set-desc">
                    上场全局快捷键。占用状态与开面检测同步；点「改绑」后按下新组合键。
                  </p>
                  <div className="shortcut-list">
                    {SHORTCUT_CATALOG.map((item) => {
                      const accel =
                        settings.shortcuts?.[item.id] || item.defaultAccel;
                      const status = shortcutStatuses.find(
                        (s) => s.id === item.id,
                      );
                      const occupied = status?.occupied;
                      return (
                        <div key={item.id} className="shortcut-row">
                          <div className="shortcut-row-left">
                            <span className="shortcut-name">{item.label}</span>
                            {occupied ? (
                              <span className="shortcut-conflict">
                                (!) 被其他应用占用
                              </span>
                            ) : null}
                          </div>
                          <div className="shortcut-keys">
                            {rebindingId === item.id ? (
                              <span className="shortcut-rebinding">按下新快捷键…</span>
                            ) : (
                              splitAccel(accel).map((k) => (
                                <kbd key={k} className="settings-kbd">
                                  {k}
                                </kbd>
                              ))
                            )}
                          </div>
                          <button
                            type="button"
                            className="shortcut-rebind"
                            onClick={() => setRebindingId(item.id)}
                          >
                            改绑
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="shortcut-composer-note">
                    <div className="settings-row">
                      <span>发送消息（闲聊）</span>
                      <kbd className="settings-kbd">Enter</kbd>
                    </div>
                    <div className="settings-row">
                      <span>换行</span>
                      <kbd className="settings-kbd">Shift + Enter</kbd>
                    </div>
                  </div>
                </div>
              ) : null}
              {settingsTab === "audio" ? (
                <div className="audio-settings">
                  <div className="audio-device-grid">
                    <div className="audio-device-col">
                      <div className="audio-device-title">麦克风</div>
                      <p className="audio-device-desc">
                        选择用于采集面试者语音回答的输入设备。
                      </p>
                      <select
                        className="settings-select audio-device-select"
                        value={settings.mic_device_id}
                        disabled={audioDevicesLoading}
                        onChange={(e) => {
                          const id = e.target.value;
                          void (async () => {
                            await persistSettingsPatch({ mic_device_id: id });
                            if (!testingMic) return;
                            try {
                              await invoke("start_audio_device_test", {
                                kind: "mic",
                                deviceId: id,
                              });
                            } catch (err) {
                              setError(String(err));
                            }
                          })();
                        }}
                        aria-label="麦克风"
                      >
                        <option value="">系统默认麦克风</option>
                        {audioDevices.microphones.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="audio-device-col">
                      <div className="audio-device-title">系统音频</div>
                      <p className="audio-device-desc">
                        选择会议软件输出到的设备，用于采集面试官语音。
                      </p>
                      <select
                        className="settings-select audio-device-select"
                        value={settings.system_audio_device_id}
                        disabled={audioDevicesLoading}
                        onChange={(e) => {
                          const id = e.target.value;
                          void (async () => {
                            await persistSettingsPatch({
                              system_audio_device_id: id,
                            });
                            if (!testingSystem) return;
                            try {
                              await invoke("start_audio_device_test", {
                                kind: "system",
                                deviceId: id,
                              });
                            } catch (err) {
                              setError(String(err));
                            }
                          })();
                        }}
                        aria-label="系统音频"
                      >
                        <option value="">系统默认输出</option>
                        {audioDevices.system_outputs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {audioDevicesLoading ? (
                    <p className="audio-devices-status">正在读取本机音频设备…</p>
                  ) : null}
                  {audioDevicesError && !audioDevicesLoading ? (
                    <p className="audio-devices-status err">{audioDevicesError}</p>
                  ) : null}

                  <section className="audio-section">
                    <h3>设备测试</h3>
                    <p className="audio-section-desc">
                      分别开始测试，并通过实时波形确认实际采集正常。
                    </p>
                    <div className="audio-test-block">
                      <div className="audio-test-head">
                        <p>
                          <strong>麦克风</strong>
                          对着选中的麦克风说话，确认波形有响应。
                        </p>
                        <button
                          type="button"
                          className="audio-test-btn"
                          onClick={() => void toggleAudioTest("mic")}
                        >
                          {testingMic ? "停止测试" : "开始测试"}
                        </button>
                      </div>
                      <AudioWaveform level={testingMic ? micLevel : 0} />
                    </div>
                    <div className="audio-test-block">
                      <div className="audio-test-head">
                        <p>
                          <strong>系统音频</strong>
                          通过选中的系统输出播放声音，确认波形有响应。
                        </p>
                        <button
                          type="button"
                          className="audio-test-btn"
                          onClick={() => void toggleAudioTest("system")}
                        >
                          {testingSystem ? "停止测试" : "开始测试"}
                        </button>
                      </div>
                      <AudioWaveform level={testingSystem ? systemLevel : 0} />
                    </div>
                  </section>

                  <section className="audio-section">
                    <h3>权限</h3>
                    <p className="audio-section-desc">
                      开始面试前，请授予麦克风、录屏与系统录音权限。
                    </p>
                    <div className="perm-list">
                      <div className="perm-card">
                        <div className="perm-card-text">
                          <div className="perm-card-title">录屏与系统录音</div>
                          <p className="perm-card-desc">
                            用于截图分析与采集面试官语音。
                          </p>
                        </div>
                        {audioPerms.screen_and_system ? (
                          <span className="perm-badge granted">
                            <IconPermCheck />
                            已授权
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="perm-badge action"
                            onClick={() => {
                              void openPrivacySettings("screen");
                              window.setTimeout(() => {
                                void refreshAudioPermissions();
                              }, 1200);
                            }}
                          >
                            去授权
                          </button>
                        )}
                      </div>
                      <div className="perm-card">
                        <div className="perm-card-text">
                          <div className="perm-card-title">麦克风</div>
                          <p className="perm-card-desc">
                            用于采集面试者的语音回答。
                          </p>
                        </div>
                        {audioPerms.microphone ? (
                          <span className="perm-badge granted">
                            <IconPermCheck />
                            已授权
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="perm-badge action"
                            onClick={() => {
                              void openPrivacySettings("microphone");
                              window.setTimeout(() => {
                                void refreshAudioPermissions();
                              }, 1200);
                            }}
                          >
                            去授权
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}
              {settingsTab === "account" ? (
                <div className="settings-rows">
                  <div className="settings-row">
                    <span>邮箱</span>
                    <span className="settings-value">
                      {settings.interview_email || "—"}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>剩余分钟</span>
                    <span className="settings-value">{balanceMinutes}</span>
                  </div>
                  <div className="settings-row">
                    <span>套餐</span>
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() => {
                        setShowSettings(false);
                        void openWebPage(WEB_PATHS.plans, accountWebQuery());
                      }}
                    >
                      前往购买
                    </button>
                  </div>
                </div>
              ) : null}
              {settingsTab === "about" ? (
                <div className="settings-rows">
                  <div className="settings-row">
                    <span>应用</span>
                    <span className="settings-value">AurisAI</span>
                  </div>
                  <div className="settings-row">
                    <span>模型</span>
                    <span className="settings-value">
                      {llmModel || "登录后显示"}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>官网</span>
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() => {
                        setShowSettings(false);
                        void openWebPage(WEB_PATHS.home);
                      }}
                    >
                      {resolveWebBase()}
                    </button>
                  </div>
                  <div className="settings-row">
                    <span>套餐</span>
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() => {
                        setShowSettings(false);
                        void openWebPage(WEB_PATHS.plans, accountWebQuery());
                      }}
                    >
                      前往购买
                    </button>
                  </div>
                  <div className="settings-row">
                    <span>帮助</span>
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() => {
                        setShowSettings(false);
                        void openWebPage(WEB_PATHS.help);
                      }}
                    >
                      打开帮助
                    </button>
                  </div>
                  <div className="settings-row">
                    <span>客服</span>
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() => {
                        setShowSettings(false);
                        void openWebPage(WEB_PATHS.contact, {
                          email: settings.interview_email.trim() || undefined,
                          topic: "桌面听题",
                        });
                      }}
                    >
                      联系客服
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {showInterviewModeModal ? (
        <div
          className="mode-mask"
          role="presentation"
        >
          <div
            className="mode-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mode-title"
            data-tour="mode"
          >
            <div className="mode-head">
              <h2 id="mode-title">选择面试使用方式</h2>
              <button
                type="button"
                className="mode-close"
                aria-label="关闭"
                onClick={() => setShowInterviewModeModal(false)}
              >
                <IconClose />
              </button>
            </div>
            <p className="mode-lead">
              如果你是在会议软件中视频面试，选择会议软件面试。如果你是在网页中答题、笔试，或平台会检测切屏，选择防切屏检测。
            </p>
            <div className="mode-cards" role="radiogroup" aria-label="面试使用方式">
              <button
                type="button"
                role="radio"
                aria-checked={interviewUseMode === "meeting"}
                className={
                  interviewUseMode === "meeting"
                    ? "mode-card active"
                    : "mode-card"
                }
                onClick={() => setInterviewUseMode("meeting")}
              >
                <span className="mode-radio" aria-hidden="true" />
                <span className="mode-card-title">会议软件面试</span>
                <span className="mode-card-desc">
                  适合在常见会议软件中进行视频面试。悬浮窗默认不会出现在录屏、截屏或屏幕共享画面中，你本人仍可看到。这个模式支持鼠标点击悬浮窗、输入框和按钮，操作更直接。
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={interviewUseMode === "stealth"}
                className={
                  interviewUseMode === "stealth"
                    ? "mode-card active"
                    : "mode-card"
                }
                onClick={() => setInterviewUseMode("stealth")}
              >
                <span className="mode-radio" aria-hidden="true" />
                <span className="mode-card-title">防切屏检测</span>
                <span className="mode-card-desc">
                  适合在浏览器网页中面试、笔试，或平台会检测切屏、窗口焦点变化的场景。悬浮窗默认不会出现在录屏、截屏或屏幕共享画面中，你本人仍可看到。这个模式不会抢走网页焦点，但不能用鼠标点击悬浮窗，需要使用快捷键操作。
                </span>
              </button>
            </div>
            {shortcutStatuses.some((s) => s.occupied) ? (
              <div
                className="mode-shortcut-alert"
                role="alert"
                aria-labelledby="mode-shortcut-alert-title"
              >
                <p
                  id="mode-shortcut-alert-title"
                  className="mode-shortcut-alert-title"
                >
                  部分快捷键被其他应用占用
                </p>
                <p className="mode-shortcut-alert-desc">
                  可先改绑，或直接开始（占用项本场不可用）。
                </p>
                <ul className="mode-shortcut-alert-list">
                  {shortcutStatuses
                    .filter((s) => s.occupied)
                    .map((s) => (
                      <li key={s.id}>
                        <span className="mode-shortcut-alert-name">
                          {s.label}
                        </span>
                        <span className="shortcut-keys">
                          {splitAccel(s.accelerator).map((k) => (
                            <kbd key={k} className="settings-kbd">
                              {k}
                            </kbd>
                          ))}
                        </span>
                        <span className="shortcut-conflict">被占用</span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            <p className="mode-tip">
              大多数视频面试选会议软件面试。网页面试、在线笔试或切屏检测场景选防切屏检测。
            </p>
            <div className="mode-actions">
              <div className="mode-actions-left">
                <button
                  type="button"
                  className="mode-btn"
                  onClick={() => setShowInterviewModeModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="mode-btn"
                  onClick={() => {
                    setShowInterviewModeModal(false);
                    setSettingsTab("audio");
                    setShowSettings(true);
                  }}
                >
                  打开音频与权限设置
                </button>
                <button
                  type="button"
                  className="mode-btn"
                  onClick={() => {
                    setShowInterviewModeModal(false);
                    setSettingsTab("shortcuts");
                    setShowSettings(true);
                  }}
                >
                  快捷键设置
                </button>
              </div>
              <button
                type="button"
                className="mode-btn primary"
                disabled={busy || showOnboard}
                onClick={() => {
                  if (showOnboard) return;
                  void onStartInterview();
                }}
              >
                {shortcutStatuses.some((s) => s.occupied)
                  ? "仍要开始面试"
                  : "开始面试"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {chatAlert ? (
        <div className="toast-wrap" role="status" aria-live="polite">
          <div className="toast-msg">{chatAlert}</div>
        </div>
      ) : null}
      {approveAsk ? (
        <div
          className="approve-mask"
          role="dialog"
          aria-labelledby="approve-title"
        >
          <div className="approve-card">
            <h2 id="approve-title">{approveAsk.title}</h2>
            <p>{approveAsk.detail}</p>
            <div className="approve-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  approveAsk.resolve(false);
                  setApproveAsk(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  approveAsk.resolve(true);
                  setApproveAsk(null);
                }}
              >
                批准
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </AppFrame>
    )}
    {showOnboard ? (
      <OnboardGuide
        key={onboardSeq}
        page={page}
        onPrepare={prepareOnboard}
        onDone={dismissOnboard}
      />
    ) : null}
    </div>
  );
}

export default App;
