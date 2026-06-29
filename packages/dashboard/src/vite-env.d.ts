/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string;
  readonly VITE_BACKEND_URL: string;
  /** URL WSS directa al backend en prod (Vercel no proxea WS). Vacío en dev. */
  readonly VITE_WS_URL?: string;
  /** URL pública del conector MCP remoto (/mcp). Fallback al gateway de prod si no se setea. */
  readonly VITE_MCP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
