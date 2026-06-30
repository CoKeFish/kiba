/**
 * Selección de cadena del gateway (Stellar/Soroban). Todo lo que dependa de la
 * cadena (unidades, rate USD, balances, fondeo) sale de aquí.
 *
 * El proxy x402 usa AgentClient del SDK (que opera Soroban); este módulo cubre el
 * resto: balances de las custodiales y fondeo.
 */
import type { Keypair } from '@solana/web3.js';
import { createChainClient, type ChainClient, type StellarSigner } from 'kiba-sdk';

export const CHAIN = (process.env.CHAIN || 'stellar').toLowerCase();

/** Unidades base por token (1e7 — 7 decimales en Stellar, vale para USDC). */
export const BASE_UNITS_PER_TOKEN = 1e7;

/** Símbolo del activo de liquidación (USDC vía Trustless Work; XLM nativo no aplica). */
export const ASSET: 'SOL' | 'XLM' | 'USDC' = 'USDC';

/** Tasa USD del activo (USDC ≈ 1.0). */
export const ASSET_USD_RATE = Number(process.env.USDC_USD_RATE) || 1.0;

/**
 * Segmento de red de stellar.expert. Deriva de STELLAR_NETWORK (igual que el SDK):
 * 'mainnet' → 'public'; cualquier otro valor (default) → 'testnet'.
 */
const EXPLORER_NETWORK =
  (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'public' : 'testnet';

/**
 * URL de stellar.expert para inspeccionar una transacción on-chain por su hash.
 * Le da al consumidor (MCP/API) un link clickeable en vez de la firma cruda.
 */
export function explorerTxUrl(signature: string): string {
  return `https://stellar.expert/explorer/${EXPLORER_NETWORK}/tx/${signature}`;
}

/**
 * ChainClient para una custodial dada. La abstracción deriva la cuenta Stellar
 * del mismo seed ed25519 de la keypair.
 */
export function chainClientFor(wallet: Keypair, label = 'gateway'): ChainClient | null {
  return createChainClient({ wallet, label });
}

/**
 * ChainClient para un firmante Stellar arbitrario (p.ej. Privy, firma remota).
 * Lo usan las wallets de usuario migradas a Privy.
 */
export function chainClientForSigner(signer: StellarSigner, label = 'user'): ChainClient | null {
  return createChainClient({ signer, label });
}
