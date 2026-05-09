/**
 * Proxy de /v1/call al SDK de Agent Bazaar.
 *
 * Para hackathon: gateway tiene UNA wallet master que paga por todos los usuarios.
 * Internamente lleva contabilidad por usuario. Cuando llega un /v1/call:
 *   1. Verifica balance del usuario
 *   2. Llama al SDK con la wallet master (en modo degradado por ahora — sin PROGRAM_ID)
 *   3. Descuenta del balance del usuario
 *   4. Devuelve resultado
 */
import axios from 'axios';
import { Keypair } from '@solana/web3.js';
import { AgentClient, loadOrCreateKeypair } from '@agent-bazaar/sdk';
import { debit, lamportsToUsd } from './billing';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';
const MASTER_KEYPAIR_PATH = process.env.MASTER_KEYPAIR_PATH || '/app/data/master-wallet.json';

// Wallet master que firma los pagos x402 en nombre de todos los usuarios.
// En producción: una wallet por usuario; aquí simplificamos a una sola.
const masterWallet = loadOrCreateKeypair(MASTER_KEYPAIR_PATH);

const sdkClient = new AgentClient({
  wallet: masterWallet,
  rpcUrl: process.env.SOLANA_RPC_URL,
});

export async function listAgents(): Promise<unknown[]> {
  const r = await axios.get(`${BACKEND_URL}/agents`);
  return r.data;
}

export async function callOnBehalf(args: {
  userId: number;
  service: string;
  payload: unknown;
}): Promise<{
  result: unknown;
  cost: { lamports: number; usd: number };
  newBalance: { lamports: number; usd: number };
}> {
  // 1. Discover service para conocer el precio
  const manifest = await sdkClient.discover(args.service);
  const lamports = Math.floor(manifest.pricePerCall * 1e9);

  // 2. Debit (atomic)
  const debitResult = debit({
    userId: args.userId,
    lamports,
    service: args.service,
    metadata: { mode: 'gateway-custodial' },
  });
  if (!debitResult.ok) {
    throw new Error(`debit failed: ${debitResult.error}`);
  }

  // 3. Llamar al servicio vía SDK
  let result: unknown;
  try {
    result = await sdkClient.call(args.service, args.payload, {
      maxPrice: manifest.pricePerCall + 0.01, // buffer
      timeoutMs: 30_000,
    });
  } catch (err) {
    // Refund si falla la llamada
    const now = Math.floor(Date.now() / 1000);
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || '/app/data/gateway.db';
    const db = new Database(dbPath);
    db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(
      lamports,
      args.userId,
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'refund', ?, ?, ?, ?)`,
    ).run(args.userId, lamports, args.service, JSON.stringify({ reason: (err as Error).message }), now);
    db.close();
    throw err;
  }

  return {
    result,
    cost: { lamports, usd: lamportsToUsd(lamports) },
    newBalance: {
      lamports: debitResult.newBalance,
      usd: lamportsToUsd(debitResult.newBalance),
    },
  };
}

export function masterWalletPubkey(): string {
  return masterWallet.publicKey.toBase58();
}
