/**
 * Proxy de /v1/call al SDK de Agent Bazaar.
 *
 * Modelo de wallet: per-user custodial.
 *   1. Cada user tiene su propia keypair (en users.custodial_wallet_secret).
 *      Esa keypair es la que firma open_escrow / claim_payment.
 *   2. Cuando una call requiere más SOL del que la wallet del user tiene
 *      on-chain, el gateway transfiere lo que falta desde su master wallet
 *      (refill on-demand, ver wallets.ensureFunded).
 *   3. El balance USD interno (users.balance_lamports) es lo que el user ve y
 *      lo que se debita por cada call. La master es solo treasury.
 */
import axios from 'axios';
import { AgentClient, type X402Trace } from '@agent-bazaar/sdk';
import { debit, lamportsToUsd } from './billing';
import { db } from './db';
import { ensureFunded, loadUserWallet, masterWalletPubkey, type RefillResult } from './wallets';

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

export async function callOnBehalf(args: {
  userId: number;
  service: string;
  payload: unknown;
}): Promise<{
  result: unknown;
  cost: { lamports: number; usd: number };
  newBalance: { lamports: number; usd: number };
  refill?: { signature: string; lamports: number };
  trace: X402Trace;
}> {
  const userWallet = loadUserWallet(args.userId);

  // Cliente del SDK con la wallet del user — esto firmará open_escrow/claim_payment
  const client = new AgentClient({
    wallet: userWallet,
    rpcUrl: process.env.SOLANA_RPC_URL,
  });

  // 1. Pre-quote (probe sin pago) → conseguimos el precio REAL que el agente
  //    cobrará por este payload específico (puede ser > floor si el agente usa
  //    priceFn dinámico). Esto es lo que debitamos del balance USD del user.
  const { manifest, quote } = await client.getQuote(args.service, args.payload, {
    timeoutMs: 30_000,
  });
  const lamports = Number(quote.amount);

  // 2. Debit USD virtual (atomic) — por el monto REAL, no por el floor
  const debitResult = debit({
    userId: args.userId,
    lamports,
    service: args.service,
    metadata: {
      mode: 'gateway-custodial-per-user',
      floorPricePerCall: manifest.pricePerCall,
      dynamicAmountLamports: lamports,
    },
  });
  if (!debitResult.ok) throw new Error(`debit failed: ${debitResult.error}`);

  // 3. Refill on-chain de la wallet del user si está bajo
  let refillInfo: RefillResult;
  try {
    refillInfo = await ensureFunded(args.userId, lamports);
  } catch (err) {
    refundDebit(args.userId, lamports, args.service, `refill failed: ${(err as Error).message}`);
    throw err;
  }

  // 4. Llamar al servicio vía SDK firmando con la wallet del user.
  //    El SDK hará su propio probe (nuevo nonce) y abrirá escrow por el monto
  //    cotizado en ese momento. priceFn es determinista en el payload, así que
  //    el monto coincidirá con `lamports` (lo que ya debitamos).
  let result: unknown;
  let trace: X402Trace;
  try {
    const traced = await client.callWithTrace(args.service, args.payload, {
      // maxPrice como circuit breaker — 2x del cotizado por seguridad
      maxPrice: (lamports / 1e9) * 2,
      timeoutMs: 30_000,
    });
    result = traced.result;
    trace = traced.trace;
  } catch (err) {
    refundDebit(args.userId, lamports, args.service, (err as Error).message);
    throw err;
  }

  return {
    result,
    cost: { lamports, usd: lamportsToUsd(lamports) },
    newBalance: {
      lamports: debitResult.newBalance,
      usd: lamportsToUsd(debitResult.newBalance),
    },
    trace,
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

// Re-export para que index.ts lo siga importando desde aquí
export { masterWalletPubkey };
