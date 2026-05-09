/**
 * Per-user custodial wallets + master treasury.
 *
 * Cada user tiene una keypair Solana (creada en signup, secret en
 * users.custodial_wallet_secret). Esa keypair es la que firma open_escrow /
 * claim_payment cuando llega una llamada.
 *
 * Como esa wallet no recibe SOL real desde fuera (el user paga en USD via topup),
 * el gateway mantiene una master wallet que actúa como "treasury": cuando una
 * call requiere más SOL del que la wallet del user tiene on-chain, transferimos
 * lo que falta desde la master de forma transparente. Es un refill on-demand.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { loadOrCreateKeypair } from '@agent-bazaar/sdk';
import { db } from './db';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const MASTER_KEYPAIR_PATH = process.env.MASTER_KEYPAIR_PATH || '/app/data/master-wallet.json';

/**
 * Buffer extra que dejamos en la wallet del user después de un refill: cubre
 * tx fees + rent-exempt minimum (~0.00089 SOL) sin tener que recalcular cada call.
 */
const REFILL_TARGET_BUFFER = 10_000_000; // 0.01 SOL

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const masterWallet = loadOrCreateKeypair(MASTER_KEYPAIR_PATH);

export function getMasterWallet(): Keypair {
  return masterWallet;
}

export function masterWalletPubkey(): string {
  return masterWallet.publicKey.toBase58();
}

export function loadUserWallet(userId: number): Keypair {
  const row = db
    .prepare('SELECT custodial_wallet_secret FROM users WHERE id = ?')
    .get(userId) as { custodial_wallet_secret: string } | undefined;
  if (!row) throw new Error(`user ${userId} not found`);
  const secret = JSON.parse(row.custodial_wallet_secret) as number[];
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

export async function getOnChainBalance(pubkey: PublicKey): Promise<number> {
  return connection.getBalance(pubkey, 'confirmed');
}

export interface RefillResult {
  refilled: boolean;
  signature?: string;
  beforeLamports: number;
  afterLamports: number;
}

/**
 * Asegura que la wallet del user tenga al menos `requiredLamports + REFILL_TARGET_BUFFER`.
 * Si no, transfiere desde la master wallet. Idempotente — múltiples llamadas concurrentes
 * pueden disparar refills paralelos: el resultado es overshoot inofensivo.
 */
export async function ensureFunded(
  userId: number,
  requiredLamports: number,
): Promise<RefillResult> {
  const userWallet = loadUserWallet(userId);
  const beforeLamports = await getOnChainBalance(userWallet.publicKey);
  const target = requiredLamports + REFILL_TARGET_BUFFER;

  if (beforeLamports >= target) {
    return { refilled: false, beforeLamports, afterLamports: beforeLamports };
  }

  const refillAmount = target - beforeLamports;

  // Verifica que la master tenga lo suficiente
  const masterBalance = await getOnChainBalance(masterWallet.publicKey);
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

  const afterLamports = await getOnChainBalance(userWallet.publicKey);
  console.log(
    `[wallets] refilled user ${userId}: ${(refillAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL → ${userWallet.publicKey.toBase58().slice(0, 8)}... (sig ${signature.slice(0, 8)}...)`,
  );

  return { refilled: true, signature, beforeLamports, afterLamports };
}
