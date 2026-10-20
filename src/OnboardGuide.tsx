import { useEffect, useRef, useState } from "react";
import { WindowControls, beginWindowDrag } from "./TitleBar";
import InterviewOverlay from "./InterviewOverlay";

export const ONBOARD_STORAGE_KEY = "aurisai-onboard-v1";

export type OnboardPage = "chat" | "records" | "me";

export type OnboardPrepare = {
  page: OnboardPage;
  modeModal: boolean;
  demoPanel: boolean;
};

type ArrowSide = "left" | "right" | "top" | "bottom";

type Hole = { top: number; left: number; width: number; height: number };
type CardPos = { top: number; left: number; arrow: ArrowSide; arrowAt: number };

const CARD_W = 280;
const GAP = 12;
const MARGIN = 12;
const CARD_H_FALLBACK = 168;

const STEPS = [
  {
    id: "nav",
    target: "nav",
    page: "chat" as OnboardPage,
    pad: 6,
    prefer: "right" as ArrowSide,
    title: "先认左边三个入口",
    body: "闲聊是日常问答。面试记录回看已经生成的出答。档案管名称、技能、简历和职位描述。",
  },
  {
    id: "profile",
    target: "profile",
    page: "me" as OnboardPage,
    pad: 6,
    prefer: "right" as ArrowSide,
    title: "开面前先把档案填齐",
    body: "简历和职位描述都要有，缺一份就不能出答。开面后按本场快照，之后再改档案不影响这场。",
  },
  {
    id: "start",
    target: "start",
    page: "me" as OnboardPage,
    pad: 8,
    prefer: "top" as ArrowSide,
    title: "进会后再点「开始面试」",
    body: "下一步会打开使用方式弹窗。这是演示，不会真的开面，也不会扣时长。",
  },
  {
    id: "mode",
    target: "mode",
    page: "me" as OnboardPage,
    pad: 8,
    prefer: "bottom" as ArrowSide,
    modeModal: true,
    title: "先选面试使用方式",
    body: "视频会议选「会议软件面试」。网页答题或会检测切屏时选「防切屏检测」。点开始后才会出面试面板，引导里不会真的开始。",
  },
  {
    id: "demo-auto",
    target: "demo-auto",
    page: "chat" as OnboardPage,
    pad: 8,
    prefer: "bottom" as ArrowSide,
    demoPanel: true,
    title: "自动回答",
    body: "顶栏这个按钮打开后只听面试官。判定为问题后会写入回答区并出答。演示不会连麦。",
  },
  {
    id: "demo-interviewer",
    target: "demo-interviewer",
    page: "chat" as OnboardPage,
    pad: 8,
    prefer: "right" as ArrowSide,
    demoPanel: true,
    title: "面试官的问题",
    body: "听题会把面试官说的话记在这一列。自动回答也只看这里来判断要不要出答。",
  },
  {
    id: "demo-mic",
    target: "demo-mic",
    page: "chat" as OnboardPage,
    pad: 8,
    prefer: "left" as ArrowSide,
    demoPanel: true,
    title: "你的麦克风",
    body: "自己说的话会出现在这一列。自动回答打开后会关掉麦克风听题，避免把自己的声音当成题目。",
  },
  {
    id: "demo-answer",
    target: "demo-answer",
    page: "chat" as OnboardPage,
    pad: 8,
    prefer: "top" as ArrowSide,
    demoPanel: true,
    title: "出答在这里",
    body: "按档案生成可说的回答。听题和出答都在面试面板，不会写进左边闲聊。",
  },
  {
    id: "me",
    target: "me",
    page: "me" as OnboardPage,
    pad: 6,
    prefer: "right" as ArrowSide,
    title: "账户在左下角「我的」",
    body: "点开有设置、套餐、帮助。以后还可以从这里再打开「使用引导」。",
  },
] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function placeCard(
  hole: Hole,
  cardH: number,
  frameW: number,
  frameH: number,
  prefer: ArrowSide,
): CardPos {
  const order: ArrowSide[] =
    prefer === "right"
      ? ["right", "left", "bottom", "top"]
      : prefer === "left"
        ? ["left", "right", "bottom", "top"]
        : prefer === "bottom"
          ? ["bottom", "top", "right", "left"]
          : ["top", "bottom", "right", "left"];

  const fits: CardPos[] = [];
  for (const side of order) {
    if (side === "right") {
      const left = hole.left + hole.width + GAP;
      const top = clamp(
        hole.top + hole.height / 2 - cardH / 2,
        MARGIN,
        Math.max(MARGIN, frameH - cardH - MARGIN),
      );
      if (left + CARD_W <= frameW - MARGIN) {
        fits.push({
          top,
          left,
          arrow: "left",
          arrowAt: clamp(hole.top + hole.height / 2 - top, 18, cardH - 18),
        });
      }
    } else if (side === "left") {
      const left = hole.left - GAP - CARD_W;
      const top = clamp(
        hole.top + hole.height / 2 - cardH / 2,
        MARGIN,
        Math.max(MARGIN, frameH - cardH - MARGIN),
      );
      if (left >= MARGIN) {
        fits.push({
          top,
          left,
          arrow: "right",
          arrowAt: clamp(hole.top + hole.height / 2 - top, 18, cardH - 18),
        });
      }
    } else if (side === "bottom") {
      const top = hole.top + hole.height + GAP;
      const left = clamp(
        hole.left + hole.width / 2 - CARD_W / 2,
        MARGIN,
        Math.max(MARGIN, frameW - CARD_W - MARGIN),
      );
      if (top + cardH <= frameH - MARGIN) {
        fits.push({
          top,
          left,
          arrow: "top",
          arrowAt: clamp(hole.left + hole.width / 2 - left, 18, CARD_W - 18),
        });
      }
    } else {
      const top = hole.top - GAP - cardH;
      const left = clamp(
        hole.left + hole.width / 2 - CARD_W / 2,
        MARGIN,
        Math.max(MARGIN, frameW - CARD_W - MARGIN),
      );
      if (top >= MARGIN) {
        fits.push({
          top,
          left,
          arrow: "bottom",
          arrowAt: clamp(hole.left + hole.width / 2 - left, 18, CARD_W - 18),
        });
      }
    }
  }
  if (fits[0]) return fits[0];
  return {
    top: clamp(hole.top + hole.height + GAP, MARGIN, Math.max(MARGIN, frameH - cardH - MARGIN)),
    left: clamp(MARGIN, MARGIN, Math.max(MARGIN, frameW - CARD_W - MARGIN)),
    arrow: "top",
    arrowAt: CARD_W / 2,
  };
}

type Props = {
  page: OnboardPage;
  onPrepare: (prep: OnboardPrepare) => void;
  onDone: () => void;
};

export function OnboardInterviewDemo() {
  return <InterviewOverlay demo />;
}

export function OnboardGuide({ page, onPrepare, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);
  const [card, setCard] = useState<CardPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  const prepareRef = useRef(onPrepare);
  doneRef.current = onDone;
  prepareRef.current = onPrepare;
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  useEffect(() => {
    const s = STEPS[step];
    prepareRef.current({
      page: s.page,
      modeModal: Boolean("modeModal" in s && s.modeModal),
      demoPanel: Boolean("demoPanel" in s && s.demoPanel),
    });
  }, [step]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let tries = 0;

    function locate() {
      if (cancelled) return;
      const origin = root.getBoundingClientRect();
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${STEPS[step].target}"]`,
      );
      if (!el) {
        if (tries++ < 40) requestAnimationFrame(locate);
        else setHole(null);
        return;
      }
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const pad = STEPS[step].pad;
      const next: Hole = {
        top: r.top - origin.top - pad,
        left: r.left - origin.left - pad,
        width: Math.max(24, r.width + pad * 2),
        height: Math.max(24, r.height + pad * 2),
      };
      const cardH = cardRef.current?.offsetHeight || CARD_H_FALLBACK;
      setHole(next);
      setCard(placeCard(next, cardH, origin.width, origin.height, STEPS[step].prefer));
    }

    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(locate);
    });
    const ro = new ResizeObserver(() => locate());
    ro.observe(root);
    window.addEventListener("resize", locate);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
      ro.disconnect();
      window.removeEventListener("resize", locate);
    };
  }, [step, page]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const primary = root.querySelector<HTMLButtonElement>("[data-onboard-primary]");
    primary?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        doneRef.current();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (e.key === "Enter" && e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        setStep((i) => {
          if (i >= STEPS.length - 1) {
            doneRef.current();
            return i;
          }
          return i + 1;
        });
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>("button"));
      if (focusable.length === 0) return;
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!e.shiftKey && i === focusable.length - 1) {
        e.preventDefault();
        focusable[0].focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step]);

  return (
    <div
      ref={rootRef}
      className="onboard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboard-title"
      aria-describedby="onboard-body"
    >
      <div
        className="onboard-chrome"
        data-tauri-drag-region
        onMouseDown={beginWindowDrag}
      >
        <WindowControls />
        <div
          className="onboard-drag"
          data-tauri-drag-region
          onMouseDown={beginWindowDrag}
        />
      </div>
      {hole ? (
        <div
          className="onboard-spot"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        className="onboard-card"
        data-arrow={card?.arrow}
        style={
          card
            ? {
                top: card.top,
                left: card.left,
                ["--arrow-at" as string]: `${card.arrowAt}px`,
              }
            : { visibility: "hidden", top: 0, left: 0 }
        }
      >
        <span className="onboard-arrow" aria-hidden />
        <p className="onboard-kicker">
          {step + 1} / {STEPS.length}
        </p>
        <h2 id="onboard-title">{current.title}</h2>
        <p id="onboard-body">{current.body}</p>
        <div className="onboard-actions">
          <button type="button" className="btn ghost" onClick={() => doneRef.current()}>
            跳过
          </button>
          <div className="onboard-actions-end">
            {step > 0 ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setStep((i) => Math.max(0, i - 1))}
              >
                上一步
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              data-onboard-primary
              onClick={() => {
                if (last) doneRef.current();
                else setStep((i) => i + 1);
              }}
            >
              {last ? "开始使用" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function readOnboardDone(): boolean {
  try {
    return localStorage.getItem(ONBOARD_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function writeOnboardDone() {
  try {
    localStorage.setItem(ONBOARD_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}
