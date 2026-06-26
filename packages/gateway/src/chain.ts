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

/** Unidades base por token del activo (1e7 stroops por XLM). */
export const BASE_UNITS_PER_TOKEN = 1e7;

/** Símbolo del activo. */
export const ASSET: 'SOL' | 'XLM' = 'XLM';

/** Tasa USD del activo (demo, fija). */
export const ASSET_USD_RATE = Number(process.env.XLM_USD_RATE) || 0.12;

/**
 * ChainClient para una custodial dada. La abstracción deriva la cuenta Stellar
 * del mismo seed ed25519 de la keypair.
 */
export function chainClientFor(wallet: Keypair, label = 'gateway'): ChainClient | null {
  return createChainClient({ wallet, label });
}
