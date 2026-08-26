import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

export function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error(
      "请在桌面窗口中使用（npm run tauri dev），不要用浏览器直接打开 localhost:1420",
    );
  }
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  ensureTauri();
  return tauriInvoke<T>(cmd, args);
}
