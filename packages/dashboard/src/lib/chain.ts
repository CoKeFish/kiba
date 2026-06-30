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
  /** Horizon REST de la red activa — para armar/enviar la tx desde el navegador. */
  horizonUrl: string;
  /** Passphrase de la red (Networks.TESTNET / Networks.PUBLIC). */
  networkPassphrase: string;
  /** Código del activo USDC. */
  usdcCode: string;
  /** Emisor del USDC (debe coincidir con TRUSTLESS_WORK_TRUSTLINE_ADDRESS del gateway). */
  usdcIssuer: string;
}

const CONFIGS: Record<string, ChainConfig> = {
  stellar: {
    key: "stellar",
    // Activo de liquidación: USDC (vía Trustless Work). Stellar usa 7 decimales.
    asset: "USDC",
    baseUnitsPerToken: 10_000_000,
    usdRate: Number(import.meta.env.VITE_USDC_USD_RATE) || 1.0,
    networkLabel: "Stellar testnet",
    explorerTx: (sig) => `https://stellar.expert/explorer/testnet/tx/${sig}`,
    explorerAddr: (addr) => `https://stellar.expert/explorer/testnet/account/${addr}`,
    horizonUrl: import.meta.env.VITE_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    networkPassphrase:
      import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
    usdcCode: "USDC",
    usdcIssuer:
      import.meta.env.VITE_USDC_ISSUER ||
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
};

const KEY = (import.meta.env.VITE_CHAIN || "stellar").toLowerCase();

/** Config de la cadena activa. */
export const chain: ChainConfig = CONFIGS[KEY] ?? CONFIGS.stellar;
