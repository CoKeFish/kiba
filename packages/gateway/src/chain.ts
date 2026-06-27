/**
 * Selección de cadena del gateway (Stellar/Soroban). Todo lo que dependa de la
 * cadena (unidades, rate USD, balances, fondeo) sale de aquí.
 *
 * El proxy x402 usa AgentClient del SDK (que opera Soroban); este módulo cubre el
 * resto: balances de las custodiales y fondeo.
 */
import type { Keypair } from '@solana/web3.js';
import { createChainClient, type ChainClient } from '@kiba/sdk';

export const CHAIN = (process.env.CHAIN || 'stellar').toLowerCase();
export const IS_STELLAR = true;

/** Unidades base por token (1e7 — 7 decimales en Stellar, vale para USDC). */
export const BASE_UNITS_PER_TOKEN = 1e7;

/** Símbolo del activo de liquidación (USDC vía Trustless Work; XLM nativo no aplica). */
export const ASSET: 'SOL' | 'XLM' | 'USDC' = 'USDC';

/** Tasa USD del activo (USDC ≈ 1.0). */
export const ASSET_USD_RATE = Number(process.env.USDC_USD_RATE) || 1.0;

/**
 * ChainClient para una custodial dada. La abstracción deriva la cuenta Stellar
 * del mismo seed ed25519 de la keypair.
 */
export function chainClientFor(wallet: Keypair, label = 'gateway'): ChainClient | null {
  return createChainClient({ wallet, label });
}
