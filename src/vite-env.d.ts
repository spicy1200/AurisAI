/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEB_BASE?: string;
  readonly VITE_WEB_BASE_PROD?: string;
  readonly VITE_API_HTTP_URL?: string;
  readonly VITE_INTERVIEW_WS_URL?: string;
}
