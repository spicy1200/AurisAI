import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appLogo } from "./brand";

async function withWindow(
  fn: (win: ReturnType<typeof getCurrentWindow>) => Promise<void>,
) {
  if (!isTauri()) return;
  await fn(getCurrentWindow());
}

export function beginWindowDrag(e: { button: number; target: EventTarget | null }) {
  if (e.button !== 0) return;
  const node = e.target;
  if (
    node instanceof Element &&
    node.closest("button, a, input, select, textarea, [data-no-drag]")
  ) {
    return;
  }
  void withWindow((w) => w.startDragging());
}

function useWindowMaximized() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => undefined);
    void win
      .onResized(async () => {
        setMaximized(await win.isMaximized());
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, []);

  return maximized;
}

export function AppFrame({ children }: { children: ReactNode }) {
  const maximized = useWindowMaximized();
  return (
    <div className={maximized ? "app-frame is-maximized" : "app-frame"}>
      {children}
    </div>
  );
}

export function WindowControls() {
  const maximized = useWindowMaximized();

  return (
    <div
      className="titlebar-controls"
      data-no-drag
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="titlebar-btn close"
        aria-label="关闭"
        title="关闭"
        onClick={() => void withWindow((w) => w.close())}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <path
            d="M1 1l4 4M5 1L1 5"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="titlebar-btn min"
        aria-label="最小化"
        title="最小化"
        onClick={() => void withWindow((w) => w.minimize())}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <path d="M0.8 3h4.4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="titlebar-btn zoom"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => void withWindow((w) => w.toggleMaximize())}
      >
        {maximized ? (
          <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
            <path
              d="M1.2 3.2V1.2h2M4.8 2.8v2H2.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
            <path
              d="M1.1 3.4V1.1H3.4M4.9 2.6v2.3H2.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

export function TitleBar({ variant = "app" }: { variant?: "app" | "auth" }) {
  return (
    <div
      className={
        variant === "auth" ? "titlebar titlebar-overlay" : "titlebar"
      }
      onDoubleClick={() => void withWindow((w) => w.toggleMaximize())}
      onMouseDown={beginWindowDrag}
    >
      <WindowControls />
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onMouseDown={beginWindowDrag}
      >
        <img className="titlebar-logo" src={appLogo} alt="" width="18" height="26" />
      </div>
    </div>
  );
}
