/**
 * Configuración de cadena del dashboard, derivada de una sola variable
 * (`VITE_CHAIN`, que el compose mapea desde `CHAIN`). Todo lo visual que dependa
 * de la cadena —símbolo del activo, decimales, tasa USD, explorer, etiqueta de
 * red— sale de aquí, para que el frontend refleje la cadena activa.
 */
export interface ChainConfig {
  key: string;
  /** Símbolo del activo (SOL, XLM). */
  asset: string;
  /** Unidades base por token: 1e9 (lamports/SOL), 1e7 (stroops/XLM). */
  baseUnitsPerToken: number;
  /** Tasa USD demo del activo. */
  usdRate: number;
  /** Etiqueta de red para encabezados. */
  networkLabel: string;
  /** URL del explorer para una transacción. */
  explorerTx: (sig: string) => string;
  /** URL del explorer para una cuenta/dirección. */
  explorerAddr: (addr: string) => string;
}

const CONFIGS: Record<string, ChainConfig> = {
  stellar: {
    key: "stellar",
    asset: "XLM",
    baseUnitsPerToken: 10_000_000,
    usdRate: Number(import.meta.env.VITE_XLM_USD_RATE) || 0.12,
    networkLabel: "Stellar testnet",
    explorerTx: (sig) => `https://stellar.expert/explorer/testnet/tx/${sig}`,
    explorerAddr: (addr) => `https://stellar.expert/explorer/testnet/account/${addr}`,
  },
};

const KEY = (import.meta.env.VITE_CHAIN || "stellar").toLowerCase();

/** Config de la cadena activa. */
export const chain: ChainConfig = CONFIGS[KEY] ?? CONFIGS.stellar;
