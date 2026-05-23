import { chain } from "./chain";

// "lamports" = unidades base del activo activo (lamports/SOL o stroops/XLM).
export const lamportsToSol = (l: number) => l / chain.baseUnitsPerToken;
export const lamportsToUsd = (l: number) => (l / chain.baseUnitsPerToken) * chain.usdRate;
export const usdToLamports = (u: number) =>
  Math.round((u / chain.usdRate) * chain.baseUnitsPerToken);

// Formatters hoisted a module scope — evita reconstruir Intl.NumberFormat por
// cada llamada (pesado en listas largas).
const USD_2_DEC = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_4_DEC = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/**
 * Formatea un USD según la magnitud:
 *   - "auto" (default) → 2 decimales si |v| >= 0.10, sino 4 decimales.
 *     Evita mostrar $5.0000 para balances grandes y a la vez mantiene precisión
 *     en precios sub-céntimos como $0.0005.
 *   - 2 → siempre 2 decimales (totales, balances, montos > $0.10)
 *   - 4 → siempre 4 decimales (precios pequeños, sub-céntimos)
 */
export function formatUsd(usd: number, fractionDigits: 2 | 4 | "auto" = "auto") {
  const fmt =
    fractionDigits === "auto"
      ? Math.abs(usd) >= 0.1
        ? USD_2_DEC
        : USD_4_DEC
      : fractionDigits === 2
        ? USD_2_DEC
        : USD_4_DEC;
  return fmt.format(usd);
}

export function formatSol(sol: number) {
  return `${sol.toFixed(6)} ${chain.asset}`;
}

export function shortSig(sig: string, chars = 4) {
  if (!sig) return "";
  if (sig.length <= chars * 2 + 3) return sig;
  return `${sig.slice(0, chars)}…${sig.slice(-chars)}`;
}

export function explorerUrl(sig: string) {
  return chain.explorerTx(sig);
}
