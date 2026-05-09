const SOL_USD_RATE = 150;
const LAMPORTS_PER_SOL = 1_000_000_000;

export const lamportsToSol = (l: number) => l / LAMPORTS_PER_SOL;
export const lamportsToUsd = (l: number) => (l / LAMPORTS_PER_SOL) * SOL_USD_RATE;
export const usdToLamports = (u: number) => Math.round((u / SOL_USD_RATE) * LAMPORTS_PER_SOL);

export function formatUsd(usd: number, fractionDigits = 4) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(usd);
}

export function formatSol(sol: number) {
  return `${sol.toFixed(6)} SOL`;
}

export function shortSig(sig: string, chars = 4) {
  if (!sig) return "";
  if (sig.length <= chars * 2 + 3) return sig;
  return `${sig.slice(0, chars)}…${sig.slice(-chars)}`;
}

export function explorerUrl(sig: string, network = "devnet") {
  return `https://explorer.solana.com/tx/${sig}?cluster=${network}`;
}
