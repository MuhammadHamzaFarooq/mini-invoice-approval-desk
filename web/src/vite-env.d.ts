/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the Express API in a deployed build, e.g. https://api.example.com
   * Leave unset locally — Vite proxies /api to http://localhost:4000.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
