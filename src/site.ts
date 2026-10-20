export const LOCAL_WEB_BASE = "http://localhost:5173";

function stripSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function envBase(name: "VITE_WEB_BASE" | "VITE_WEB_BASE_PROD"): string {
  const raw = (import.meta.env[name] as string | undefined)?.trim();
  return raw ? stripSlash(raw) : "";
}

/** Packaged / production website. Override with VITE_WEB_BASE or VITE_WEB_BASE_PROD. */
export const PROD_WEB_BASE =
  envBase("VITE_WEB_BASE_PROD") || envBase("VITE_WEB_BASE") || "https://www.aurisai.cn";

export const WEB_PATHS = {
  home: "/",
  contact: "/contact",
  plans: "/account",
  membership: "/membership",
  help: "/help/faq",
} as const;

export function resolveWebBase(): string {
  const fromEnv = envBase("VITE_WEB_BASE");
  if (fromEnv) return fromEnv;
  return import.meta.env.DEV ? LOCAL_WEB_BASE : PROD_WEB_BASE;
}

export function webPageUrl(
  path: string,
  query: Record<string, string | number | undefined | null> = {},
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${resolveWebBase()}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has("from")) {
    url.searchParams.set("from", "desktop");
  }
  return url.toString();
}
