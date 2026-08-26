import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { invoke } from "./tauri";
import "./App.css";

type Page = "chat" | "settings";

interface Settings {
  api_key: string;
  base_url: string;
  model: string;
  system_prompt: string;
  include_mic: boolean;
  whisper_cli_path: string;
  whisper_model_path: string;
  whisper_language: string;
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

interface StopResult {
  path: string;
  text: string;
  stt_error?: string | null;
  quality_hint?: string | null;
}

const defaultSettings: Settings = {
  api_key: "",
  base_url: "https://api.deepseek.com",
  model: "deepseek-chat",
  system_prompt:
    "你是会议助手。用户会提供会议录音转写文本，请用简洁中文帮助总结要点、待办，或回答用户追问。",
  include_mic: false,
  whisper_cli_path: "",
  whisper_model_path: "",
  whisper_language: "zh",
};

function App() {
  const [page, setPage] = useState<Page>("chat");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [ask, setAsk] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [detectedOnce, setDetectedOnce] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [lastWav, setLastWav] = useState("");
  const [recordingsDir, setRecordingsDir] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [sttTestPath, setSttTestPath] = useState("");
  const [sttTestText, setSttTestText] = useState("");
  const [sttTestAudioUrl, setSttTestAudioUrl] = useState("");
  const [sttTesting, setSttTesting] = useState(false);
  const [sttTestHint, setSttTestHint] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshChat = useCallback(async () => {
    try {
      const history = await invoke<ChatMessage[]>("get_chat_history");
      setChat(history);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await invoke<ChatSession[]>("list_chat_sessions");
      setSessions(list);
      const cur = await invoke<string | null>("get_current_session_id");
      setCurrentSessionId(cur);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setError(
        "请在桌面窗口中使用（npm run tauri dev），不要用浏览器打开 localhost:1420",
      );
      return;
    }
    (async () => {
      try {
        const s = await invoke<Settings>("get_settings");
        setSettings(s);
        const dir = await invoke<string>("get_recordings_dir");
        setRecordingsDir(dir);
        const last = await invoke<string | null>("get_last_recording");
        if (last) {
          setLastWav(last);
          setAudioUrl(convertFileSrc(last));
        }
      } catch (e) {
        setError(String(e));
      }
      await refreshSessions();
      await refreshChat();
    })();
  }, [refreshChat, refreshSessions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, busy]);

  async function onDetectDevices() {
    setError("");
    setDetecting(true);
    setStatus("正在检测会议应用…");
    try {
      const list = await invoke<string[]>("list_meeting_apps");
      setApps(list);
      setDetectedOnce(true);
      setStatus(
        list.length
          ? `已检测到：${list.join("、")}`
          : "未检测到微信 / 腾讯会议 / 钉钉（仍可录音）",
      );
    } catch (e) {
      setError(String(e));
      setStatus("");
    } finally {
      setDetecting(false);
    }
  }

  async function onStart() {
    setError("");
    setStatus("正在开始录音…");
    try {
      await invoke("start_recording");
      setRecording(true);
      setStatus(
        "录音中" + (settings.include_mic ? "（环回 + 麦克风）" : "（仅环回）"),
      );
    } catch (e) {
      setError(String(e));
      setStatus("");
    }
  }

  async function onStop() {
    setError("");
    setBusy(true);
    setStatus("停止录音并转写中…");
    try {
      const result = await invoke<StopResult>("stop_recording");
      setRecording(false);
      setLastWav(result.path);
      setAudioUrl(convertFileSrc(result.path));
      setTranscript(result.text || "");
      setShowTranscript(true);
      if (result.stt_error) {
        setError(result.stt_error);
        setStatus("");
      } else {
        setStatus("");
        if (result.quality_hint) {
          setError(result.quality_hint);
        }
      }
    } catch (e) {
      setRecording(false);
      setError(String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function openRecording() {
    if (!lastWav) return;
    try {
      await invoke("open_path", { path: lastWav });
    } catch (e) {
      setError(String(e));
    }
  }

  async function openRecordingsFolder() {
    try {
      await invoke("open_recordings_folder");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onPolish() {
    if (!transcript.trim()) return;
    setError("");
    setBusy(true);
    setStatus("DeepSeek 正在校对转写…");
    try {
      const polished = await invoke<string>("polish_transcript", {
        text: transcript,
      });
      setTranscript(polished);
      setShowTranscript(true);
      setStatus("校对完成，可再核对后发送");
    } catch (e) {
      setError(String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function onSend(includeTranscript: boolean) {
    setError("");
    if (!settings.api_key.trim()) {
      setError("请先在设置中配置 DeepSeek API Key");
      setPage("settings");
      return;
    }
    if (!includeTranscript && !ask.trim()) return;

    setBusy(true);
    setStatus("DeepSeek 思考中…");
    try {
      if (includeTranscript) {
        await invoke("set_transcript", { text: transcript });
      }
      await invoke("deepseek_send", {
        text: ask,
        includeTranscript,
      });
      setAsk("");
      await refreshChat();
      await refreshSessions();
      setStatus("");
      inputRef.current?.focus();
    } catch (e) {
      setError(String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function onNewSession() {
    try {
      const session = await invoke<ChatSession>("deepseek_new_session");
      setCurrentSessionId(session.id);
      setChat([]);
      setTranscript("");
      setShowTranscript(false);
      await refreshSessions();
      setStatus("已开始新对话");
    } catch (e) {
      setError(String(e));
    }
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
      await refreshSessions();
    } catch (e) {
      setError(String(e));
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

  async function onSaveSettings() {
    setError("");
    setSaveOk(false);
    try {
      await invoke("save_app_settings", { settings });
      setSaveOk(true);
      setStatus("设置已保存");
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickModel() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Whisper GGML", extensions: ["bin"] }],
      });
      if (typeof selected === "string") {
        setSettings((s) => ({ ...s, whisper_model_path: selected }));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickCli() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (typeof selected === "string") {
        setSettings((s) => ({ ...s, whisper_cli_path: selected }));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickSttTestWav() {
    setError("");
    try {
      const selected = await open({
        multiple: false,
        defaultPath: recordingsDir || undefined,
        filters: [
          { name: "Audio", extensions: ["wav", "mp3", "m4a", "flac"] },
        ],
      });
      if (typeof selected === "string") {
        setSttTestPath(selected);
        setSttTestAudioUrl(convertFileSrc(selected));
        setSttTestText("");
        setSttTestHint("");
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function useLastRecordingForTest() {
    if (!lastWav) {
      setError("还没有录音文件，请先在 AI 聊天里录一段，或手动选择 wav");
      return;
    }
    setSttTestPath(lastWav);
    setSttTestAudioUrl(convertFileSrc(lastWav));
    setSttTestText("");
    setSttTestHint("");
    setError("");
  }

  async function onTestTranscribe() {
    setError("");
    setSttTestHint("");
    if (!settings.whisper_cli_path.trim() || !settings.whisper_model_path.trim()) {
      setError("请先配置并保存 Whisper CLI 与模型路径");
      return;
    }
    if (!sttTestPath.trim()) {
      setError("请先选择要测试的音频文件");
      return;
    }
    setSttTesting(true);
    setStatus("正在转写测试音频…");
    try {
      // Use latest form values even if user hasn't clicked save yet
      await invoke("save_app_settings", { settings });
      const result = await invoke<StopResult>("test_transcribe", {
        path: sttTestPath,
      });
      setSttTestText(result.text || "");
      if (result.stt_error) {
        setError(result.stt_error);
        setStatus("");
      } else {
        setStatus("转写测试完成");
        if (result.quality_hint) {
          setSttTestHint(result.quality_hint);
        }
      }
    } catch (e) {
      setError(String(e));
      setStatus("");
    } finally {
      setSttTesting(false);
    }
  }

  const readyForChat =
    Boolean(settings.api_key.trim()) &&
    Boolean(settings.whisper_cli_path.trim()) &&
    Boolean(settings.whisper_model_path.trim());

  const emptyChat = chat.length === 0;

  return (
    <div className="app-shell">
      <aside className={navCollapsed ? "sidebar collapsed" : "sidebar"}>
        <div className="side-top">
          {!navCollapsed && <div className="side-brand">AurisAI</div>}
          <button
            type="button"
            className="side-toggle"
            title={navCollapsed ? "展开导航" : "收起导航"}
            onClick={() => setNavCollapsed((v) => !v)}
          >
            {navCollapsed ? "›" : "‹"}
          </button>
        </div>
        <nav className="side-nav">
          <button
            className={page === "chat" ? "side-item active" : "side-item"}
            onClick={() => setPage("chat")}
            title="AI 聊天"
          >
            <span className="side-ico">◇</span>
            {!navCollapsed && <span>AI 聊天</span>}
          </button>
          <button
            className={page === "settings" ? "side-item active" : "side-item"}
            onClick={() => setPage("settings")}
            title="设置"
          >
            <span className="side-ico">⚙</span>
            {!navCollapsed && <span>设置</span>}
          </button>
        </nav>
        <div className="side-foot">
          {recording && (
            <div className="side-rec" title="录音中">
              <span className="rec-dot" />
              {!navCollapsed && <span>录音中</span>}
            </div>
          )}
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
                    onClick={() => setHistoryCollapsed(false)}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="history-new"
                    onClick={onNewSession}
                    title="新对话"
                  >
                    +
                  </button>
                </div>
              ) : (
                <>
                  <div className="history-head">
                    <button
                      type="button"
                      className="history-toggle"
                      title="收起聊天历史"
                      onClick={() => setHistoryCollapsed(true)}
                    >
                      ‹
                    </button>
                    <span className="history-label">聊天历史</span>
                    <button
                      type="button"
                      className="history-new"
                      onClick={onNewSession}
                      title="新对话"
                    >
                      +
                    </button>
                  </div>
                  <div className="history-list">
                    {sessions.length === 0 ? (
                      <p className="history-empty">
                        暂无历史，发送消息后会自动保存
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
            <div className="chat-scroll">
              <div className="chat-inner">
                {emptyChat ? (
                  <div className="welcome">
                    <div className="welcome-mark">AurisAI</div>
                    <h1>今天有什么可以帮到你？</h1>
                    <p className="welcome-sub">
                      先在设置中检测会议应用并完成配置，再回到这里录音转写或直接提问。
                    </p>
                    {!readyForChat && (
                      <button
                        className="linkish"
                        type="button"
                        onClick={() => setPage("settings")}
                      >
                        前往设置完成配置 →
                      </button>
                    )}
                    {detectedOnce && (
                      <p className="welcome-apps">
                        {apps.length
                          ? `已检测：${apps.join("、")}`
                          : "已检测：当前无会议应用在运行"}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="messages">
                    {chat.map((m, i) => (
                      <div key={i} className={`msg ${m.role}`}>
                        <div className="msg-avatar">
                          {m.role === "user" ? "你" : "AI"}
                        </div>
                        <div className="msg-body">
                          <div className="msg-role">
                            {m.role === "user" ? "你" : "DeepSeek"}
                          </div>
                          <div className="msg-text">{m.content}</div>
                        </div>
                      </div>
                    ))}
                    {busy && (
                      <div className="msg assistant">
                        <div className="msg-avatar">AI</div>
                        <div className="msg-body">
                          <div className="msg-role">DeepSeek</div>
                          <div className="msg-text thinking">正在回复…</div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <div className="composer-tools">
                  {!recording ? (
                    <button
                      type="button"
                      className="tool-btn"
                      disabled={busy}
                      onClick={onStart}
                      title="开始录音"
                    >
                      录音
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tool-btn danger"
                      disabled={busy}
                      onClick={onStop}
                    >
                      停止转写
                    </button>
                  )}
                  {(transcript.trim() || lastWav) && (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => setShowTranscript((v) => !v)}
                    >
                      {showTranscript ? "收起转写/录音" : "查看转写/录音"}
                    </button>
                  )}
                  {transcript.trim() && (
                    <>
                      <button
                        type="button"
                        className="tool-btn accent"
                        disabled={busy}
                        onClick={() => onSend(true)}
                      >
                        发送转写
                      </button>
                      <button
                        type="button"
                        className="tool-btn"
                        disabled={busy}
                        onClick={onPolish}
                        title="用 DeepSeek 修正同音错字与断句"
                      >
                        AI 校对
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={openRecordingsFolder}
                    title={recordingsDir || "打开录音文件夹"}
                  >
                    录音文件夹
                  </button>
                </div>

                {showTranscript && (
                  <div className="rec-panel">
                    {lastWav && (
                      <div className="rec-meta">
                        <div className="rec-path" title={lastWav}>
                          录音文件：{lastWav}
                        </div>
                        <div className="rec-actions">
                          <button
                            type="button"
                            className="tool-btn"
                            onClick={openRecording}
                          >
                            用播放器打开
                          </button>
                          <button
                            type="button"
                            className="tool-btn"
                            onClick={openRecordingsFolder}
                          >
                            打开所在文件夹
                          </button>
                        </div>
                        {audioUrl && (
                          <audio
                            className="rec-audio"
                            controls
                            src={audioUrl}
                            preload="metadata"
                          />
                        )}
                        <p className="rec-tip">
                          请对比：耳机听到的会议声 vs 这段 wav。若 wav
                          本身含糊/噪声大，转写就会差。
                        </p>
                      </div>
                    )}
                    <textarea
                      className="transcript-box"
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      rows={3}
                      placeholder="转写文本可编辑后再发送"
                    />
                  </div>
                )}

                <div className="composer-input">
                  <textarea
                    ref={inputRef}
                    value={ask}
                    rows={1}
                    placeholder="给 DeepSeek 发送消息…"
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="send-btn"
                    disabled={busy || !ask.trim()}
                    onClick={() => onSend(false)}
                  >
                    发送
                  </button>
                </div>
                <div className="composer-hint">
                  {error ? (
                    <span className="err">{error}</span>
                  ) : (
                    <span>{status || "Enter 发送 · Shift+Enter 换行"}</span>
                  )}
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : (
          <div className="settings-page">
            <div className="settings-inner">
              <header className="settings-head">
                <h1>设置</h1>
                <p>配置完成后回到 AI 聊天开始使用</p>
              </header>

              <section className="set-block">
                <h2>录音文件</h2>
                <p className="set-desc">
                  每次录音会保存为 wav，目录：
                  <br />
                  <code>{recordingsDir || "resuorce\\AurisAI-recordings"}</code>
                </p>
                <div className="set-row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={openRecordingsFolder}
                  >
                    打开录音文件夹
                  </button>
                </div>
              </section>

              <section className="set-block">
                <h2>设备检测</h2>
                <p className="set-desc">
                  检测本机是否在运行微信、腾讯会议、钉钉（仅提示，不会自动录音）。
                </p>
                <div className="set-row">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={detecting}
                    onClick={onDetectDevices}
                  >
                    {detecting ? "检测中…" : "检测会议应用"}
                  </button>
                  {detectedOnce && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setPage("chat")}
                    >
                      进入 AI 聊天
                    </button>
                  )}
                </div>
                {detectedOnce && (
                  <div className="detect-result">
                    {apps.length ? (
                      <ul>
                        {apps.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">当前未检测到目标应用</span>
                    )}
                  </div>
                )}
              </section>

              <section className="set-block">
                <h2>DeepSeek</h2>
                <label>
                  API Key
                  <div className="field-row">
                    <input
                      type={showKey ? "text" : "password"}
                      value={settings.api_key}
                      onChange={(e) =>
                        setSettings({ ...settings, api_key: e.target.value })
                      }
                      placeholder="sk-..."
                    />
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? "隐藏" : "显示"}
                    </button>
                  </div>
                </label>
                <label>
                  Base URL
                  <input
                    value={settings.base_url}
                    onChange={(e) =>
                      setSettings({ ...settings, base_url: e.target.value })
                    }
                  />
                </label>
                <label>
                  模型
                  <input
                    value={settings.model}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                  />
                </label>
                <label>
                  系统提示词
                  <textarea
                    rows={2}
                    value={settings.system_prompt}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        system_prompt: e.target.value,
                      })
                    }
                  />
                </label>
              </section>

              <section className="set-block">
                <h2>录音</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.include_mic}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        include_mic: e.target.checked,
                      })
                    }
                  />
                  同时录制麦克风（会议场景建议关闭，避免回声导致乱码）
                </label>
              </section>

              <section className="set-block">
                <h2>Whisper</h2>
                <label>
                  CLI（whisper-cli.exe）
                  <div className="field-row">
                    <input
                      value={settings.whisper_cli_path}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          whisper_cli_path: e.target.value,
                        })
                      }
                    />
                    <button className="btn ghost" type="button" onClick={pickCli}>
                      浏览
                    </button>
                  </div>
                </label>
                <label>
                  模型（ggml-*.bin）
                  <div className="field-row">
                    <input
                      value={settings.whisper_model_path}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          whisper_model_path: e.target.value,
                        })
                      }
                    />
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={pickModel}
                    >
                      浏览
                    </button>
                  </div>
                  <span className="set-desc" style={{ marginTop: 4 }}>
                    中文会议建议至少用 ggml-small.bin（约 466MB）；仍不准可换
                    ggml-medium.bin（约 1.5GB，更准但更慢）。下载：
                    https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
                  </span>
                </label>
                <label>
                  语言
                  <input
                    value={settings.whisper_language}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whisper_language: e.target.value,
                      })
                    }
                  />
                </label>
              </section>

              <section className="set-block">
                <h2>语音转文字测试</h2>
                <p className="set-desc">
                  选择录音文件夹中的 wav（或任意本地音频），用当前 Whisper
                  配置试跑转写，方便对比听感与识别效果。不写入聊天记录。
                </p>
                <div className="set-row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={openRecordingsFolder}
                  >
                    打开录音文件夹
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={pickSttTestWav}
                  >
                    选择音频文件
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={useLastRecordingForTest}
                    disabled={!lastWav}
                  >
                    使用最近一次录音
                  </button>
                </div>
                {sttTestPath && (
                  <div className="stt-test-panel">
                    <div className="rec-path" title={sttTestPath}>
                      测试文件：{sttTestPath}
                    </div>
                    {sttTestAudioUrl && (
                      <audio
                        className="rec-audio"
                        controls
                        src={sttTestAudioUrl}
                        preload="metadata"
                      />
                    )}
                    <div className="set-row">
                      <button
                        type="button"
                        className="btn primary"
                        disabled={sttTesting}
                        onClick={onTestTranscribe}
                      >
                        {sttTesting ? "转写中…" : "开始转写测试"}
                      </button>
                    </div>
                    {(sttTestText || sttTesting) && (
                      <label>
                        转写结果
                        <textarea
                          className="stt-test-result"
                          rows={6}
                          value={sttTestText}
                          onChange={(e) => setSttTestText(e.target.value)}
                          placeholder={sttTesting ? "正在识别…" : ""}
                          readOnly={sttTesting}
                        />
                      </label>
                    )}
                    {sttTestHint && (
                      <p className="set-desc stt-test-hint">{sttTestHint}</p>
                    )}
                  </div>
                )}
              </section>

              <div className="set-actions">
                <button type="button" className="btn primary" onClick={onSaveSettings}>
                  保存设置
                </button>
                {saveOk && <span className="ok">已保存</span>}
                {error && <span className="err">{error}</span>}
                {!error && status && <span className="muted">{status}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
