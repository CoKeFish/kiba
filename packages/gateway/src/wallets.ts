/**
 * Per-user custodial wallets + master wallet, sobre Stellar/Soroban.
 *
 * Cada user tiene una keypair ed25519 (creada en signup, secret en
 * users.custodial_wallet_secret) que firma open_escrow / claim_payment en Soroban
 * (la dirección Stellar G... se deriva del seed). Las cantidades están en unidades
 * base del activo (stroops) — ver chain.ts / billing.ts.
 *
 * Fondeo on-demand (testnet): la cuenta del user se fondea con friendbot la primera
 * vez (10.000 XLM), suficiente para la demo.
 */
import { Keypair } from '@solana/web3.js';
import { loadOrCreateKeypair } from '@kiba/sdk';
import { getBalance, lamportsToSol, lamportsToUsd } from './billing';
import { ASSET, chainClientFor } from './chain';
import { db } from './db';

/** Nombre de la unidad base de la cadena activa (stroops en Stellar). */
export const BASE_UNIT_NAME: 'lamports' | 'stroops' = 'stroops';

const MASTER_KEYPAIR_PATH = process.env.MASTER_KEYPAIR_PATH || '/app/data/master-wallet.json';

function loadMasterWallet(): Keypair {
  const fromEnv = process.env.MASTER_WALLET_SECRET;
  if (fromEnv) {
    const arr = JSON.parse(fromEnv) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return loadOrCreateKeypair(MASTER_KEYPAIR_PATH);
}

const masterWallet = loadMasterWallet();

export function getMasterWallet(): Keypair {
  return masterWallet;
}

export function masterWalletPubkey(): string {
  // Dirección nativa de la cadena activa (Stellar deriva del seed).
  const cc = chainClientFor(masterWallet, 'master');
  return cc?.ownerAddress ?? masterWallet.publicKey.toBase58();
}

export function loadUserWallet(userId: number): Keypair {
  const row = db
    .prepare('SELECT custodial_wallet_secret FROM users WHERE id = ?')
    .get(userId) as { custodial_wallet_secret: string } | undefined;
  if (!row) throw new Error(`user ${userId} not found`);
  const secret = JSON.parse(row.custodial_wallet_secret) as number[];
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

/** Saldo on-chain de una custodial, en unidades base del activo activo. */
export async function getOnChainBalance(wallet: Keypair): Promise<number> {
  const cc = chainClientFor(wallet);
  if (!cc) return 0;
  try {
    return Number(await cc.getBalanceBaseUnits());
  } catch (err) {
    console.warn('[wallets] balance query failed:', (err as Error).message);
    return 0;
  }
}

/**
 * Balances de un user, en USD + unidades base + activo nativo (XLM).
 *
 * `*_lamports` y `*_sol` se conservan como aliases legacy: los valores numéricos
 * son los mismos que los nuevos `*_base_units` y `*_asset_amount` — para no romper
 * integraciones existentes que aún leen los nombres viejos.
 */
export interface UserBalances {
  // Chain-agnostic (preferido).
  asset: 'SOL' | 'XLM';
  baseUnitName: 'lamports' | 'stroops';
  creditBaseUnits: number;
  creditUsd: number;
  walletBaseUnits: number;
  walletAssetAmount: number;
  walletUsd: number;
  totalBaseUnits: number;
  totalAssetAmount: number;
  totalUsd: number;

  // Legacy (deprecated): mismos números que los *_base_units/*_asset_amount.
  /** @deprecated use creditBaseUnits */ creditLamports: number;
  /** @deprecated use walletBaseUnits */ walletLamports: number;
  /** @deprecated use walletAssetAmount */ walletSol: number;
  /** @deprecated use totalBaseUnits */ totalLamports: number;
  /** @deprecated use totalAssetAmount */ totalSol: number;
}

export async function getUserBalances(userId: number): Promise<UserBalances> {
  const creditLamports = getBalance(userId);
  let walletLamports = 0;
  try {
    const wallet = loadUserWallet(userId);
    walletLamports = await getOnChainBalance(wallet);
  } catch (err) {
    console.warn(`[wallets] on-chain balance failed for user ${userId}:`, (err as Error).message);
  }
  const totalLamports = creditLamports + walletLamports;
  const walletSol = lamportsToSol(walletLamports);
  const totalSol = lamportsToSol(totalLamports);
  return {
    asset: ASSET,
    baseUnitName: BASE_UNIT_NAME,
    creditBaseUnits: creditLamports,
    creditUsd: lamportsToUsd(creditLamports),
    walletBaseUnits: walletLamports,
    walletAssetAmount: walletSol,
    walletUsd: lamportsToUsd(walletLamports),
    totalBaseUnits: totalLamports,
    totalAssetAmount: totalSol,
    totalUsd: lamportsToUsd(totalLamports),
    // Legacy aliases.
    creditLamports,
    walletLamports,
    walletSol,
    totalLamports,
    totalSol,
  };
}

export interface RefillResult {
  refilled: boolean;
  signature?: string;
  beforeLamports: number;
  afterLamports: number;
}

/**
 * Asegura que la custodial del user tenga fondos on-chain para operar.
 * Testnet: friendbot fondea la cuenta (una vez; idempotente si ya existe).
 */
export async function ensureFunded(
  userId: number,
  requiredLamports: number,
): Promise<RefillResult> {
  const userWallet = loadUserWallet(userId);
  const cc = chainClientFor(userWallet, `user:${userId}`);
  const beforeLamports = cc ? Number(await cc.getBalanceBaseUnits()) : 0;
  if (cc && beforeLamports < requiredLamports + 1_000_000) {
    // ensureFunds usa friendbot si la cuenta no existe (crea + fondea 10k XLM).
    await cc.ensureFunds(0, 0);
  }
  const afterLamports = cc ? Number(await cc.getBalanceBaseUnits()) : beforeLamports;
  return { refilled: afterLamports > beforeLamports, beforeLamports, afterLamports };
}
