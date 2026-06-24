/**
 * Per-user custodial wallets + master treasury, agnóstico a la cadena.
 *
 * Cada user tiene una keypair ed25519 (creada en signup, secret en
 * users.custodial_wallet_secret). Esa misma keypair firma open_escrow /
 * claim_payment en Solana y, derivando del mismo seed, en Stellar.
 *
 * Fondeo on-demand:
 *   - Solana: la wallet del user no recibe SOL desde fuera; una master wallet
 *     ("treasury") le transfiere lo que falte antes de cada call.
 *   - Stellar (testnet): se fondea la cuenta del user con friendbot la primera
 *     vez (10.000 XLM), suficiente para la demo.
 *
 * Las cantidades se manejan en "unidades base" del activo activo (lamports en
 * Solana, stroops en Stellar) — ver chain.ts / billing.ts.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { loadOrCreateKeypair } from '@kiba/sdk';
import { getBalance, lamportsToSol, lamportsToUsd } from './billing';
import { ASSET, BASE_UNITS_PER_TOKEN, IS_STELLAR, chainClientFor } from './chain';

/** Nombre de la unidad base de la cadena activa (lamports/stroops). */
export const BASE_UNIT_NAME: 'lamports' | 'stroops' = IS_STELLAR ? 'stroops' : 'lamports';
import { db } from './db';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const MASTER_KEYPAIR_PATH = process.env.MASTER_KEYPAIR_PATH || '/app/data/master-wallet.json';

/** Buffer extra tras un refill en Solana (tx fees + rent-exempt). */
const REFILL_TARGET_BUFFER = 10_000_000; // 0.01 SOL

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

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
 * Balances de un user, en USD + unidades base + activo nativo (chain-agnostic).
 *
 * `*_lamports` y `*_sol` se conservan como aliases legacy: aunque cuando
 * CHAIN=stellar la unidad base son stroops y el activo es XLM, los valores
 * numéricos son los mismos que los nuevos `*_base_units` y `*_asset_amount`
 * — para no romper integraciones existentes que aún leen los nombres viejos.
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
 *   - Stellar: friendbot fondea la cuenta (una vez; idempotente si ya existe).
 *   - Solana: transfiere desde la master lo que falte para `required + buffer`.
 */
export async function ensureFunded(
  userId: number,
  requiredLamports: number,
): Promise<RefillResult> {
  const userWallet = loadUserWallet(userId);

  if (IS_STELLAR) {
    const cc = chainClientFor(userWallet, `user:${userId}`);
    const beforeLamports = cc ? Number(await cc.getBalanceBaseUnits()) : 0;
    if (cc && beforeLamports < requiredLamports + 1_000_000) {
      // ensureFunds usa friendbot si la cuenta no existe (crea + fondea 10k XLM).
      await cc.ensureFunds(0, 0);
    }
    const afterLamports = cc ? Number(await cc.getBalanceBaseUnits()) : beforeLamports;
    return { refilled: afterLamports > beforeLamports, beforeLamports, afterLamports };
  }

  // ── Solana: refill desde la master ──
  const beforeLamports = await getOnChainBalance(userWallet);
  const target = requiredLamports + REFILL_TARGET_BUFFER;
  if (beforeLamports >= target) {
    return { refilled: false, beforeLamports, afterLamports: beforeLamports };
  }
  const refillAmount = target - beforeLamports;

  const masterBalance = await getOnChainBalance(masterWallet);
  if (masterBalance < refillAmount + 5_000_000) {
    throw new Error(
      `master wallet low (${masterBalance / LAMPORTS_PER_SOL} SOL) — cannot refill ${refillAmount / LAMPORTS_PER_SOL} SOL`,
    );
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: masterWallet.publicKey });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: masterWallet.publicKey,
      toPubkey: userWallet.publicKey,
      lamports: refillAmount,
    }),
  );
  tx.sign(masterWallet);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  const afterLamports = await getOnChainBalance(userWallet);
  console.log(
    `[wallets] refilled user ${userId}: ${(refillAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL (sig ${signature.slice(0, 8)}...)`,
  );
  return { refilled: true, signature, beforeLamports, afterLamports };
}
