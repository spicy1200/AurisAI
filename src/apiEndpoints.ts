function stripSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function env(name: "VITE_API_HTTP_URL" | "VITE_INTERVIEW_WS_URL"): string {
  const raw = (import.meta.env[name] as string | undefined)?.trim();
  return raw ? stripSlash(raw) : "";
}

/** HTTP API base used for login / account / answers. */
export const PROD_API_HTTP_URL = "https://aurisai.mmming.cn/interview-api";
/** Interview WebSocket used when starting a live session. */
export const PROD_INTERVIEW_WS_URL =
  "wss://aurisai.mmming.cn/interview-api/ws/interview";

export const DEV_API_HTTP_URL = "http://127.0.0.1:8089";
export const DEV_INTERVIEW_WS_URL = "ws://127.0.0.1:8089/ws/interview";

export function defaultApiHttpUrl(): string {
  return (
    env("VITE_API_HTTP_URL") ||
    (import.meta.env.DEV ? DEV_API_HTTP_URL : PROD_API_HTTP_URL)
  );
}

export function defaultInterviewWsUrl(): string {
  return (
    env("VITE_INTERVIEW_WS_URL") ||
    (import.meta.env.DEV ? DEV_INTERVIEW_WS_URL : PROD_INTERVIEW_WS_URL)
  );
}
