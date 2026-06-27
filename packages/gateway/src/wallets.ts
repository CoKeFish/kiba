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
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import { loadOrCreateKeypair, LocalKeypairSigner, type StellarSigner } from '@kiba/sdk';
import { getBalance, lamportsToSol, lamportsToUsd } from './billing';
import { ASSET, chainClientFor, chainClientForSigner } from './chain';
import { db } from './db';
import { privyEnabled, createStellarWallet, PrivyStellarSigner } from './privy';

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

/**
 * Firmante Stellar del usuario.
 *  - Migrado a Privy → firma remota (la clave vive en el TEE de Privy, no en la DB).
 *  - No migrado y Privy habilitado → provisiona la wallet de Privy de forma lazy,
 *    guarda la referencia y BORRA el secret local (la clave sale de la DB).
 *  - Privy no configurado → firma local con el secret guardado (legacy/degradado).
 */
export async function loadUserSigner(userId: number): Promise<StellarSigner> {
  const row = db
    .prepare('SELECT custodial_wallet_secret, privy_wallet_id, stellar_address FROM users WHERE id = ?')
    .get(userId) as
    | { custodial_wallet_secret: string | null; privy_wallet_id: string | null; stellar_address: string | null }
    | undefined;
  if (!row) throw new Error(`user ${userId} not found`);

  if (row.privy_wallet_id && row.stellar_address) {
    return new PrivyStellarSigner(row.privy_wallet_id, row.stellar_address);
  }

  if (privyEnabled()) {
    const w = await createStellarWallet();
    db.prepare(
      "UPDATE users SET privy_wallet_id = ?, stellar_address = ?, custodial_wallet_pubkey = ?, custodial_wallet_secret = '' WHERE id = ?",
    ).run(w.walletId, w.address, w.address, userId);
    console.log(`[wallets] user ${userId} migrado a Privy ${w.walletId} (${w.address})`);
    return new PrivyStellarSigner(w.walletId, w.address);
  }

  // Legacy: deriva el keypair Stellar del seed ed25519 guardado.
  const kp = loadUserWallet(userId);
  return new LocalKeypairSigner(StellarKeypair.fromRawEd25519Seed(Buffer.from(kp.secretKey.slice(0, 32))));
}

/** Saldo on-chain (unidades base) de la wallet del usuario, vía su firmante. */
export async function userOnChainBalance(userId: number): Promise<number> {
  const cc = chainClientForSigner(await loadUserSigner(userId), `user:${userId}`);
  if (!cc) return 0;
  try {
    return Number(await cc.getBalanceBaseUnits());
  } catch (err) {
    console.warn('[wallets] user balance query failed:', (err as Error).message);
    return 0;
  }
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
  asset: 'SOL' | 'XLM' | 'USDC';
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
    walletLamports = await userOnChainBalance(userId);
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
  const cc = chainClientForSigner(await loadUserSigner(userId), `user:${userId}`);
  const beforeLamports = cc ? Number(await cc.getBalanceBaseUnits()) : 0;
  if (cc && beforeLamports < requiredLamports + 1_000_000) {
    // ensureFunds usa friendbot si la cuenta no existe (crea + fondea) + trustline USDC.
    await cc.ensureFunds(0, 0);
  }
  const afterLamports = cc ? Number(await cc.getBalanceBaseUnits()) : beforeLamports;
  return { refilled: afterLamports > beforeLamports, beforeLamports, afterLamports };
}

/**
 * Asegura que la TREASURY de la plataforma (master wallet) exista y tenga fondos
 * on-chain. Es quien liquida los escrows pagados con CRÉDITO (la custodial del
 * usuario NO se toca en ese modo). En testnet, friendbot la crea+fondea (10k XLM)
 * una vez; idempotente si ya existe.
 */
export async function ensureTreasuryFunded(): Promise<void> {
  const cc = chainClientFor(masterWallet, 'treasury');
  if (!cc) return;
  try {
    await cc.ensureFunds(0, 0);
  } catch (err) {
    console.warn('[wallets] ensureTreasuryFunded:', (err as Error).message);
  }
}
