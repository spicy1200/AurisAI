import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "./tauri";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, cursorPosition } from "@tauri-apps/api/window";
import {
  mergeShortcutMap,
  SHORTCUT_CATALOG,
  splitAccel,
  type ShortcutMap,
} from "./shortcuts";
import { looksLikeInterviewQuestion } from "./interviewQuestion";
import "./App.css";

interface InterviewAnswer {
  question: string;
  answer: string;
  created_at?: string;
}

interface CaptionPayload {
  channel?: string;
  kind?: string;
  text?: string;
}

function isTauri() {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

function clip(text: string, n = 48) {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export default function InterviewOverlay() {
  const [interviewerFinals, setInterviewerFinals] = useState<string[]>([]);
  const [interviewerPartial, setInterviewerPartial] = useState("");
  const [selfFinals, setSelfFinals] = useState<string[]>([]);
  const [selfPartial, setSelfPartial] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "自动回答已就绪。你也可以输入问题、不输入文字发送最新问题，或附截图发送。",
  );
  const [error, setError] = useState("");
  const [showTranscript, setShowTranscript] = useState(true);
  const [showAnswer, setShowAnswer] = useState(true);
  const [showHints, setShowHints] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [attachScreenshot, setAttachScreenshot] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(mergeShortcutMap());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [listening, setListening] = useState(true);
  const [monitorNotice, setMonitorNotice] = useState("连接有效则扣时");
  const autoAnswerRef = useRef(autoAnswer);
  const busyRef = useRef(false);
  const attachRef = useRef(attachScreenshot);
  const finalsRef = useRef(interviewerFinals);
  const askRef = useRef(ask);
  const menuRef = useRef<HTMLDivElement>(null);
  const bodyExpandedRef = useRef(bodyExpanded);
  useEffect(() => {
    bodyExpandedRef.current = bodyExpanded;
  }, [bodyExpanded]);

  const setExpanded = useCallback((next: boolean) => {
    setBodyExpanded(next);
    void invoke("set_interview_shell_expanded", { expanded: next });
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded(!bodyExpandedRef.current);
  }, [setExpanded]);

  const applyAutoAnswer = useCallback((next: boolean) => {
    setAutoAnswer(next);
    if (next) {
      setSelfFinals([]);
      setSelfPartial("");
      setStatus("自动回答已开：只听面试官；判定为问题后会写入回答区并出答。");
      setMonitorNotice("自动回答 · 仅面试官");
    } else {
      setStatus("自动回答已关。可手输问题或发送最新面试官转录。");
      setMonitorNotice("连接有效则扣时");
    }
    if (isTauri()) {
      void invoke("set_interview_mic_capture", { enabled: !next }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    autoAnswerRef.current = autoAnswer;
  }, [autoAnswer]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    attachRef.current = attachScreenshot;
  }, [attachScreenshot]);
  useEffect(() => {
    finalsRef.current = interviewerFinals;
  }, [interviewerFinals]);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  useEffect(() => {
    return () => {
      if (isTauri()) {
        void invoke("set_interview_mic_capture", { enabled: true }).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    const onDoc = (ev: Event) => {
      const root = menuRef.current;
      if (root && ev.target instanceof Node && !root.contains(ev.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMenu]);

  const refreshAnswers = useCallback(async () => {
    try {
      const list = await invoke<InterviewAnswer[]>("list_interview_answers");
      setAnswers(list);
    } catch {
      /* ignore */
    }
  }, []);

  const generate = useCallback(
    async (question?: string, withShot?: boolean) => {
      setError("");
      setBusy(true);
      try {
        let q =
          (question ?? askRef.current).trim() ||
          finalsRef.current[finalsRef.current.length - 1] ||
          "";
        if (!q) {
          setError("没有可回答的问题");
          setBusy(false);
          return;
        }
        const wantShot = withShot ?? attachRef.current;
        if (wantShot) {
          try {
            const b64 = await invoke<string>("capture_screenshot_base64");
            q = `${q}\n\n[已附截图 base64-png length=${b64.length}；请结合屏幕可见题目作答；简历未写清处可按岗位常识合理归纳，勿说材料里没有]`;
          } catch (e) {
            setError(`截图失败：${e}`);
            setBusy(false);
            return;
          }
        }
        setStatus("正在生成本场出答…");
        setAsk(q.split("\n\n[已附截图")[0] || q);
        await invoke("generate_interview_answer", { question: q });
        setAsk("");
        await refreshAnswers();
        setStatus("出答已更新。");
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshAnswers],
  );

  const generateRef = useRef(generate);
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);

  const setExpandedRef = useRef(setExpanded);
  const toggleExpandedRef = useRef(toggleExpanded);
  useEffect(() => {
    setExpandedRef.current = setExpanded;
    toggleExpandedRef.current = toggleExpanded;
  }, [setExpanded, toggleExpanded]);

  function appendFinal(
    prev: string[],
    text: string,
  ): string[] {
    const t = text.trim().replace(/\s+/g, " ");
    if (!t) return prev;
    const last = (prev[prev.length - 1] || "").trim().replace(/\s+/g, " ");
    if (last === t) return prev;
    return [...prev, text.trim()];
  }

  const endInterview = useCallback(async () => {
    setConfirmEnd(false);
    try {
      await invoke("stop_interview");
      setStatus("正在结束面试…");
      await invoke("unregister_interview_shortcuts");
      await invoke("exit_interview_overlay");
    } catch (e) {
      setError(String(e));
      try {
        await invoke("unregister_interview_shortcuts");
        await invoke("exit_interview_overlay");
      } catch {
        /* ignore */
      }
    }
    try {
      await getCurrentWindow().setIgnoreCursorEvents(false);
    } catch {
      /* ignore */
    }
  }, []);

  const menubarRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const confirmCardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const startWindowDrag = useCallback(async (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isTauri() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    try {
      const win = getCurrentWindow();
      await win.setIgnoreCursorEvents(false);
      await win.startDragging();
    } catch {
      /* ignore */
    } finally {
      draggingRef.current = false;
    }
  }, []);

  // Only menubar + content (and end-confirm card) receive clicks; everything else
  // click-throughs to the meeting app — including the shortcut strip.
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let lastIgnore: boolean | null = null;
    let timer = 0;
    const win = getCurrentWindow();
    const PAD = 2;

    const inRect = (x: number, y: number, el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return (
        x >= r.left - PAD &&
        x <= r.right + PAD &&
        y >= r.top - PAD &&
        y <= r.bottom + PAD
      );
    };

    const overInteractive = (clientX: number, clientY: number) => {
      if (inRect(clientX, clientY, menubarRef.current)) return true;
      const dropdown = menubarRef.current?.querySelector<HTMLElement>(".ov-dropdown");
      if (inRect(clientX, clientY, dropdown ?? null)) return true;
      if (inRect(clientX, clientY, contentRef.current)) return true;
      if (inRect(clientX, clientY, confirmCardRef.current)) return true;
      return false;
    };

    const applyIgnore = async (ignore: boolean) => {
      // Never apply after unmount — in-flight ticks used to re-enable ignore
      // after exit_interview_overlay, leaving the main UI unclickable.
      if (!alive) return;
      if (lastIgnore === ignore) return;
      await win.setIgnoreCursorEvents(ignore);
      if (!alive) {
        // Race: cleanup already asked for clickable; force restore.
        await win.setIgnoreCursorEvents(false);
        return;
      }
      lastIgnore = ignore;
    };

    const tick = async () => {
      if (!alive) return;
      try {
        if (draggingRef.current) {
          await applyIgnore(false);
        } else {
          const [cursor, outer, scale] = await Promise.all([
            cursorPosition(),
            win.outerPosition(),
            win.scaleFactor(),
          ]);
          if (!alive) return;
          const clientX = (cursor.x - outer.x) / scale;
          const clientY = (cursor.y - outer.y) / scale;
          await applyIgnore(!overInteractive(clientX, clientY));
        }
      } catch {
        /* ignore */
      }
      if (alive) {
        timer = window.setTimeout(() => void tick(), 24);
      }
    };

    void applyIgnore(true).then(() => {
      if (alive) void tick();
    });

    return () => {
      alive = false;
      window.clearTimeout(timer);
      lastIgnore = null;
      void win.setIgnoreCursorEvents(false);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const s = await invoke<{ shortcuts?: ShortcutMap }>("get_settings");
        setShortcuts(mergeShortcutMap(s.shortcuts));
      } catch {
        /* ignore */
      }
      void refreshAnswers();
      try {
        await getCurrentWindow().setContentProtected(true);
      } catch {
        /* ignore */
      }
    })();
  }, [refreshAnswers]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void (async () => {
      const push = (unsub: () => void) => {
        if (cancelled) unsub();
        else unsubs.push(unsub);
      };

      push(
        await listen<CaptionPayload>("interview-transcript", (ev) => {
          const p = ev.payload || {};
          const channel = p.channel || "interviewer";
          const kind = p.kind || "partial";
          const text = p.text || "";
          if (channel === "self") {
            if (autoAnswerRef.current) return;
            if (kind === "final") {
              setSelfFinals((prev) => appendFinal(prev, text));
              setSelfPartial("");
            } else {
              setSelfPartial(text);
            }
            return;
          }
          if (kind === "final") {
            setInterviewerFinals((prev) => {
              const next = appendFinal(prev, text);
              if (
                next !== prev &&
                autoAnswerRef.current &&
                !busyRef.current &&
                looksLikeInterviewQuestion(text)
              ) {
                const q = text.trim();
                setAsk(q);
                setStatus("判定为问题，正在自动出答…");
                void generateRef.current(q, false);
              } else if (
                next !== prev &&
                autoAnswerRef.current &&
                !looksLikeInterviewQuestion(text)
              ) {
                setStatus("非问题，仅留在面试官转录。");
              }
              return next;
            });
            setInterviewerPartial("");
          } else {
            setInterviewerPartial(text);
          }
        }),
      );
      push(
        await listen<{ message?: string }>("interview-error", (ev) => {
          setError(ev.payload?.message || "听题暂时不可用");
          setListening(false);
        }),
      );
      push(
        await listen<Record<string, unknown>>("interview-status", (ev) => {
          const p = ev.payload || {};
          if (p.listening === false) {
            setListening(false);
            if (typeof p.notice === "string" && p.notice) {
              setMonitorNotice(String(p.notice));
              setStatus(String(p.notice));
            } else {
              setMonitorNotice("听题已断开");
              setStatus("听题连接已断开，面试壳仍保留。可点结束退出。");
            }
          } else if (p.listening === true) {
            setListening(true);
          }
          if (typeof p.notice === "string" && p.notice && p.listening !== false) {
            setMonitorNotice(p.notice);
            setStatus(p.notice);
          }
        }),
      );
      push(
        await listen<{ action?: string }>("overlay-shortcut", (ev) => {
          const action = ev.payload?.action;
          if (!action) return;
          switch (action) {
            case "answer":
              void generateRef.current(undefined, false);
              break;
            case "screenshot_answer":
              void generateRef.current(undefined, true);
              break;
            case "toggle_overlay":
              toggleExpandedRef.current();
              break;
            case "toggle_shortcut_hints":
              setShowHints((v) => !v);
              break;
            case "toggle_transcript":
              setShowTranscript((v) => !v);
              if (!bodyExpandedRef.current) setExpandedRef.current(true);
              break;
            case "end_interview":
              setConfirmEnd(true);
              break;
            case "toggle_auto_answer":
              applyAutoAnswer(!autoAnswerRef.current);
              break;
            case "send_transcript_1":
            case "send_transcript_2":
            case "send_transcript_3":
            case "send_transcript_4":
            case "send_transcript_5": {
              const idx = Number(action.slice(-1)) - 1;
              const finals = finalsRef.current;
              const fromEnd = finals[finals.length - 1 - idx];
              if (fromEnd) void generateRef.current(fromEnd, false);
              else setError(`没有第 ${idx + 1} 条面试官转录`);
              break;
            }
            default:
              break;
          }
        }),
      );
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  const interviewerLive = useMemo(
    () =>
      clip(interviewerPartial) ||
      clip(interviewerFinals[interviewerFinals.length - 1] || "") ||
      "等待对方说话",
    [interviewerFinals, interviewerPartial],
  );
  const selfLive = useMemo(
    () =>
      clip(selfPartial) ||
      clip(selfFinals[selfFinals.length - 1] || "") ||
      "等待自己说话",
    [selfFinals, selfPartial],
  );

  const listenLabel = listening
    ? autoAnswer
      ? interviewerPartial
        ? "听题中（仅面试官）"
        : "自动回答 · 听面试官"
      : interviewerPartial || selfPartial
        ? "听题中"
        : "听题已就绪"
    : "听题已断开";

  return (
    <div className={bodyExpanded ? "ov-root" : "ov-root ov-root-compact"}>
      <header className="ov-module ov-menubar" ref={menubarRef}>
        <button
          type="button"
          className="ov-ico-btn"
          aria-label={bodyExpanded ? "收起面板" : "展开面板"}
          title={bodyExpanded ? "收起下方内容" : "展开下方内容"}
          onClick={toggleExpanded}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d={bodyExpanded ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="ov-brand-name" data-tauri-drag-region>
          AurisAI
        </span>
        <span className="ov-menubar-grow" data-tauri-drag-region aria-hidden="true" />
        <button
          type="button"
          className={showHints ? "ov-ico-btn on" : "ov-ico-btn"}
          aria-label={showHints ? "隐藏快捷键" : "显示快捷键"}
          title={showHints ? "隐藏快捷键" : "显示快捷键"}
          onClick={() => setShowHints((v) => !v)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
            <path
              d="M7 11h.01M11 11h.01M15 11h.01M7 15h10"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="ov-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={showTranscript ? "ov-ico-btn on" : "ov-ico-btn"}
            aria-label="转录面板"
            title="转录面板"
            onClick={() => {
              setShowTranscript((v) => !v);
              if (!bodyExpandedRef.current) setExpanded(true);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="5" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
              <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={autoAnswer ? "ov-ico-btn on" : "ov-ico-btn"}
            aria-label="自动回答"
            title="自动回答"
            onClick={() => applyAutoAnswer(!autoAnswer)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.75" />
              <path
                d="M9 12.5l2 2 4-4.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="ov-ico-btn"
            aria-label="更多"
            aria-expanded={showMenu}
            aria-haspopup="menu"
            title="更多"
            onClick={() => setShowMenu((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
            </svg>
          </button>
          {showMenu ? (
            <div className="ov-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowAnswer((v) => !v);
                  if (!bodyExpandedRef.current) setExpanded(true);
                  setShowMenu(false);
                }}
              >
                {showAnswer ? "隐藏回答面板" : "显示回答面板"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAttachScreenshot((v) => !v);
                  setShowMenu(false);
                }}
              >
                {attachScreenshot ? "取消附截图" : "出答附截图"}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setShowMenu(false);
                  if (!bodyExpandedRef.current) setExpanded(true);
                  void generate(undefined, false);
                }}
              >
                立即出答
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setShowMenu(false);
                  setConfirmEnd(true);
                }}
              >
                结束面试
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="ov-stop-btn"
          aria-label="结束面试"
          title="结束面试"
          onClick={() => setConfirmEnd(true)}
        >
          <span className="ov-stop-inner" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ov-drag-handle"
          aria-label="拖动窗口"
          title="拖动"
          onPointerDown={(e) => void startWindowDrag(e)}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="3" r="1.2" />
            <circle cx="8.5" cy="3" r="1.2" />
            <circle cx="3.5" cy="7" r="1.2" />
            <circle cx="8.5" cy="7" r="1.2" />
            <circle cx="3.5" cy="11" r="1.2" />
            <circle cx="8.5" cy="11" r="1.2" />
          </svg>
        </button>
      </header>

      {bodyExpanded ? (
        <div className="ov-module ov-content" ref={contentRef}>
          <div className="ov-monitor" data-tauri-drag-region>
            <div className="ov-monitor-row">
              <span
                className={
                  listening ? "ov-badge ov-badge-live" : "ov-badge ov-badge-off"
                }
              >
                {listening ? "面试进行中" : "已结束"}
              </span>
              <span className="ov-badge">{listenLabel}</span>
              <span className="ov-monitor-item">
                <span className="ov-monitor-k">面试官</span>
                <span className="ov-monitor-v">{interviewerLive}</span>
              </span>
              {autoAnswer ? (
                <span className="ov-monitor-item">
                  <span className="ov-monitor-k">自己</span>
                  <span className="ov-monitor-v muted">自动回答中已关闭麦克风听题</span>
                </span>
              ) : (
                <span className="ov-monitor-item">
                  <span className="ov-monitor-k">自己</span>
                  <span className="ov-monitor-v">{selfLive}</span>
                </span>
              )}
              <span className="ov-monitor-meta">
                {busy ? "出答生成中" : monitorNotice}
                {answers.length > 0 ? ` · 已出答 ${answers.length}` : ""}
              </span>
            </div>
            {error ? <div className="ov-monitor-error">{error}</div> : null}
          </div>

          <div className="ov-panels">
            {showTranscript ? (
              <section className="ov-panel ov-transcript">
                <header className="ov-panel-head">
                  <span>转录</span>
                  <button
                    type="button"
                    className="ov-chip"
                    onClick={() => setShowTranscript(false)}
                  >
                    收起
                  </button>
                </header>
                <div className={autoAnswer ? "ov-panel-body ov-panel-body-solo" : "ov-panel-body"}>
                  <div className="ov-col">
                    <div className="ov-col-label">面试官</div>
                    {interviewerFinals.map((t, i) => (
                      <p key={`i-${i}`}>{t}</p>
                    ))}
                    {interviewerPartial ? (
                      <p className="muted">{interviewerPartial}</p>
                    ) : null}
                    {!interviewerFinals.length && !interviewerPartial ? (
                      <p className="muted">转录会显示在这里</p>
                    ) : null}
                  </div>
                  {autoAnswer ? null : (
                    <div className="ov-col">
                      <div className="ov-col-label">麦克风</div>
                      {selfFinals.map((t, i) => (
                        <p key={`s-${i}`}>{t}</p>
                      ))}
                      {selfPartial ? <p className="muted">{selfPartial}</p> : null}
                      {!selfFinals.length && !selfPartial ? (
                        <p className="muted">等待自己说话…</p>
                      ) : null}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {showAnswer ? (
              <section className="ov-panel ov-answer">
                <header className="ov-panel-head">
                  <span>回答</span>
                  <button
                    type="button"
                    className="ov-chip"
                    onClick={() => setShowTranscript((v) => !v)}
                  >
                    {showTranscript ? "隐藏转录" : "显示转录"}
                  </button>
                </header>
                <div className="ov-answer-status">{status}</div>
                <div className="ov-answers">
                  {answers.length === 0 ? (
                    <p className="muted">出答会显示在这里</p>
                  ) : (
                    answers.map((a, i) => (
                      <div key={i} className="ov-qa">
                        <div className="answer-q">{a.question}</div>
                        <div className="answer-a">{a.answer}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="ov-compose">
                  <div className="ov-compose-toggles">
                    <button
                      type="button"
                      className={attachScreenshot ? "ov-chip on" : "ov-chip"}
                      onClick={() => setAttachScreenshot((v) => !v)}
                    >
                      附截图
                    </button>
                    <button
                      type="button"
                      className={autoAnswer ? "ov-chip on" : "ov-chip"}
                      onClick={() => applyAutoAnswer(!autoAnswer)}
                    >
                      自动回答
                    </button>
                  </div>
                  <div className="ov-compose-row">
                    <input
                      value={ask}
                      onChange={(e) => setAsk(e.target.value)}
                      placeholder="输入问题，或留空发送最新面试官问题…"
                      disabled={busy}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void generate();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ov-send"
                      disabled={busy}
                      onClick={() => void generate()}
                      aria-label="发送出答"
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {showHints ? (
        <aside className="ov-module ov-shortcut-strip" aria-label="快捷键">
          {SHORTCUT_CATALOG.map((s) => (
            <div key={s.id} className="ov-shortcut-row">
              <span className="ov-shortcut-label">{s.label}</span>
              <span className="ov-shortcut-keys">
                {splitAccel(shortcuts[s.id] || s.defaultAccel).map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </aside>
      ) : null}

      {confirmEnd ? (
        <div className="ov-confirm">
          <div className="ov-confirm-card" ref={confirmCardRef}>
            <p>确定结束本场面试？连接将断开并恢复主窗口。</p>
            <div className="ov-confirm-actions">
              <button type="button" onClick={() => setConfirmEnd(false)}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void endInterview()}
              >
                结束面试
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
