/**
 * Split de comisión de la plataforma (95/5). Matemática pura, agnóstica de cadena.
 * Debe coincidir con `PLATFORM_FEE_BPS` del contrato Soroban (lib.rs).
 */

/** Comisión que cobra la plataforma — 500 bps = 5%. */
export const PLATFORM_FEE_BPS = 500;
export const BPS_DENOMINATOR = 10_000;

/** Calcula el split (owner net + platform fee) para un amount en unidades base. */
export function computeFeeSplit(amount: bigint | number): {
  ownerAmount: bigint;
  platformFee: bigint;
} {
  const a = BigInt(amount);
  const fee = (a * BigInt(PLATFORM_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  return { ownerAmount: a - fee, platformFee: fee };
}
