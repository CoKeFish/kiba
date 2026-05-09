/**
 * Proxy de /v1/call al SDK de Agent Bazaar.
 *
 * Modelo de wallet: cascada virtual → on-chain.
 *   1. Cada user tiene su propia keypair (en users.custodial_wallet_secret).
 *      Esa keypair es la que firma open_escrow / claim_payment.
 *   2. Cada call decide modo según `balance_lamports` (USD virtual) vs precio:
 *      - Si virtual cubre el costo → debita virtual y la master rellena la
 *        custodial on-demand (ver wallets.ensureFunded).
 *      - Si virtual no alcanza → modo "pay-from-wallet": no se toca virtual ni
 *        master, la custodial firma directo con su SOL on-chain (lo que el user
 *        haya transferido manualmente desde su Phantom externa).
 *   3. La cascada es por call entera, no parcial — para no fragmentar el escrow.
 */
import axios from 'axios';
import type { Keypair } from '@solana/web3.js';
import { AgentClient } from '@agent-bazaar/sdk';
import { debit, getBalance, lamportsToUsd } from './billing';
import { db } from './db';
import {
  ensureFunded,
  getOnChainBalance,
  loadUserWallet,
  masterWalletPubkey,
  type RefillResult,
} from './wallets';

const WALLET_TX_FEE_BUFFER = 5_000_000;

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';

export async function listAgents(): Promise<unknown[]> {
  const r = await axios.get(`${BACKEND_URL}/agents`);
  return r.data;
}

function refundDebit(userId: number, lamports: number, service: string, reason: string) {
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(
      lamports,
      userId,
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'refund', ?, ?, ?, ?)`,
    ).run(userId, lamports, service, JSON.stringify({ reason }), now);
  });
  tx();
}

function recordWalletDirectCall(args: {
  userId: number;
  lamports: number;
  service: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
     VALUES (?, 'call', ?, ?, ?, ?)`,
  ).run(
    args.userId,
    -args.lamports,
    args.service,
    JSON.stringify({ mode: 'wallet-direct' }),
    now,
  );
}

export async function callOnBehalf(args: {
  userId: number;
  service: string;
  payload: unknown;
}): Promise<{
  result: unknown;
  cost: { lamports: number; usd: number };
  mode: 'virtual' | 'wallet-direct';
  newBalance: { lamports: number; usd: number };
  refill?: { signature: string; lamports: number };
}> {
  const userWallet = loadUserWallet(args.userId);

  // Cliente del SDK con la wallet del user — esto firmará open_escrow/claim_payment
  const client = new AgentClient({
    wallet: userWallet,
    rpcUrl: process.env.SOLANA_RPC_URL,
  });

  // 1. Discover (precio + endpoint)
  const manifest = await client.discover(args.service);
  const lamports = Math.floor(manifest.pricePerCall * 1e9);

  // 2. Decidir modo: si el saldo virtual cubre el costo, virtual+refill master;
  //    si no, pay-from-wallet directo desde la custodial on-chain.
  const virtualBalance = getBalance(args.userId);

  if (virtualBalance >= lamports) {
    return await callViaVirtual({ ...args, client, manifest, lamports });
  }

  return await callViaWallet({ ...args, client, userWallet, manifest, lamports, virtualBalance });
}

async function callViaVirtual(args: {
  userId: number;
  service: string;
  payload: unknown;
  client: AgentClient;
  manifest: { pricePerCall: number };
  lamports: number;
}) {
  const debitResult = debit({
    userId: args.userId,
    lamports: args.lamports,
    service: args.service,
    metadata: { mode: 'virtual' },
  });
  if (!debitResult.ok) throw new Error(`debit failed: ${debitResult.error}`);

  let refillInfo: RefillResult;
  try {
    refillInfo = await ensureFunded(args.userId, args.lamports);
  } catch (err) {
    refundDebit(args.userId, args.lamports, args.service, `refill failed: ${(err as Error).message}`);
    throw err;
  }

  let result: unknown;
  try {
    result = await args.client.call(args.service, args.payload, {
      maxPrice: args.manifest.pricePerCall + 0.01,
      timeoutMs: 30_000,
    });
  } catch (err) {
    refundDebit(args.userId, args.lamports, args.service, (err as Error).message);
    throw err;
  }

  return {
    result,
    cost: { lamports: args.lamports, usd: lamportsToUsd(args.lamports) },
    mode: 'virtual' as const,
    newBalance: {
      lamports: debitResult.newBalance,
      usd: lamportsToUsd(debitResult.newBalance),
    },
    ...(refillInfo.refilled && refillInfo.signature
      ? {
          refill: {
            signature: refillInfo.signature,
            lamports: refillInfo.afterLamports - refillInfo.beforeLamports,
          },
        }
      : {}),
  };
}

async function callViaWallet(args: {
  userId: number;
  service: string;
  payload: unknown;
  client: AgentClient;
  userWallet: Keypair;
  manifest: { pricePerCall: number };
  lamports: number;
  virtualBalance: number;
}) {
  // Verifica que la custodial tenga lamports + buffer para fees on-chain.
  const onChain = await getOnChainBalance(args.userWallet.publicKey);
  const required = args.lamports + WALLET_TX_FEE_BUFFER;
  if (onChain < required) {
    throw new Error(
      `insufficient funds: virtual ${args.virtualBalance} lamports + wallet ${onChain} lamports < ${required} (price ${args.lamports} + fee buffer ${WALLET_TX_FEE_BUFFER})`,
    );
  }

  // Pay-from-wallet sin debit virtual: si falla, el saldo USD virtual no cambió.
  const result = await args.client.call(args.service, args.payload, {
    maxPrice: args.manifest.pricePerCall + 0.01,
    timeoutMs: 30_000,
  });

  recordWalletDirectCall({
    userId: args.userId,
    lamports: args.lamports,
    service: args.service,
  });

  return {
    result,
    cost: { lamports: args.lamports, usd: lamportsToUsd(args.lamports) },
    mode: 'wallet-direct' as const,
    newBalance: {
      lamports: args.virtualBalance,
      usd: lamportsToUsd(args.virtualBalance),
    },
  };
}

// Re-export para que index.ts lo siga importando desde aquí
export { masterWalletPubkey };
