import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

export const AUTH_EXPIRED_EVENT = "auris-auth-expired";
export const AUTH_EXPIRED_MSG = "登录已过期，请重新登录";
const AUTH_MESSAGE_KEY = "auris.authMessage";

export function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error(
      "请在桌面窗口中使用（npm run tauri dev），不要用浏览器直接打开 localhost:1420",
    );
  }
}

export function isAuthExpiredError(err: unknown): boolean {
  const s = String(err ?? "");
  return (
    s.includes(AUTH_EXPIRED_MSG) ||
    s.includes("Authorization verify failed") ||
    s.includes("登录已过期或无效") ||
    s.includes("Token has expired") ||
    /登录已过期/.test(s)
  );
}

export function stashAuthMessage(message: string) {
  try {
    sessionStorage.setItem(AUTH_MESSAGE_KEY, message);
  } catch {
    /* ignore */
  }
}

export function takeAuthMessage(): string {
  try {
    const v = sessionStorage.getItem(AUTH_MESSAGE_KEY) || "";
    if (v) sessionStorage.removeItem(AUTH_MESSAGE_KEY);
    return v;
  } catch {
    return "";
  }
}

export function emitAuthExpired(message = AUTH_EXPIRED_MSG) {
  stashAuthMessage(message);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AUTH_EXPIRED_EVENT, { detail: message }),
    );
  }
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  ensureTauri();
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    if (isAuthExpiredError(e) && cmd !== "logout_interview") {
      emitAuthExpired(AUTH_EXPIRED_MSG);
    }
    throw e;
  }
}
