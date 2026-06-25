/**
 * Selección de cadena del gateway, centralizada. Todo lo que dependa de la
 * cadena (unidades, rate USD, balances, fondeo) sale de aquí, de modo que
 * `CHAIN=stellar` baste para cambiar el gateway entero a Stellar.
 *
 * El proxy x402 ya usa AgentClient del SDK (que respeta CHAIN); este módulo
 * cubre el resto: balances de las custodiales y refill/fondeo.
 */
import type { Keypair } from '@solana/web3.js';
import { createChainClient, type ChainClient } from '@kiba/sdk';

export const CHAIN = (process.env.CHAIN || 'stellar').toLowerCase();
export const IS_STELLAR = CHAIN === 'stellar';

/** Unidades base por token del activo activo: 1e9 (lamports/SOL) o 1e7 (stroops/XLM). */
export const BASE_UNITS_PER_TOKEN = IS_STELLAR ? 1e7 : 1e9;

/** Símbolo del activo. */
export const ASSET: 'SOL' | 'XLM' = IS_STELLAR ? 'XLM' : 'SOL';

/** Tasa USD del activo (demo, fija). */
export const ASSET_USD_RATE = IS_STELLAR
  ? Number(process.env.XLM_USD_RATE) || 0.12
  : Number(process.env.SOL_USD_RATE) || 150;

/**
 * ChainClient para una custodial dada. La abstracción deriva la cuenta Stellar
 * del mismo seed ed25519 de la keypair (Solana), así que la misma custodial
 * sirve para ambas cadenas.
 */
export function chainClientFor(wallet: Keypair, label = 'gateway'): ChainClient | null {
  return createChainClient({ wallet, rpcUrl: process.env.SOLANA_RPC_URL, label });
}
