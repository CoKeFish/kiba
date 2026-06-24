/**
 * Proxy de /v1/call al SDK de Kiba.
 *
 * Modelo: cascada virtual → on-chain con pricing dinámico y x402 trace.
 *   1. Pre-quote: probe HTTP sin pago para obtener el monto REAL que el agente
 *      cobrará por ESTE payload (pricing dinámico via priceFn).
 *   2. Cascada (decide ANTES de llamar):
 *      - Si crédito virtual cubre el costo → debita virtual, master refilla la
 *        custodial on-chain (ensureFunded). En este modo el user paga "USD".
 *      - Si no → modo wallet-direct: la custodial paga directo con su SOL
 *        on-chain (lo que el user transfirió desde Phantom externa). Sin debit
 *        ni refill master.
 *   3. La llamada al servicio se hace UNA sola vez (callWithTrace), después de
 *      la decisión. El SDK maneja el handshake x402 internamente y devuelve
 *      un trace estructurado de los 4 steps.
 *   4. La cascada es por call entera, no parcial — para no fragmentar el escrow.
 */
import axios from 'axios';
import { AgentClient, type X402Trace } from '@kiba/sdk';
import { attachSignature, debit, getBalance, lamportsToUsd } from './billing';
import { db } from './db';
import {
  ensureFunded,
  getOnChainBalance,
  loadUserWallet,
  masterWalletPubkey,
  type RefillResult,
} from './wallets';
import { BASE_UNITS_PER_TOKEN } from './chain';

const WALLET_TX_FEE_BUFFER = 5_000_000;

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';

export async function listAgents(query?: string): Promise<unknown[]> {
  const url = query
    ? `${BACKEND_URL}/agents?q=${encodeURIComponent(query)}&mode=hybrid`
    : `${BACKEND_URL}/agents`;
  const r = await axios.get(url);
  return r.data;
}

/**
 * Pulls the on-chain signature out of an x402 trace. Prefers `claimSignature`
 * (proves the agent received payment); falls back to `escrow_opened.signature`
 * (proves the user funded the escrow) when claim is missing. Returns undefined
 * for legacy/no-program responses (signature === 'NO_ONCHAIN_PROGRAM_ID').
 */
function pickOnChainSignature(trace: X402Trace): string | undefined {
  const responded = trace.steps.find((s) => s.type === 'service_responded');
  const opened = trace.steps.find((s) => s.type === 'escrow_opened');
  const claim = responded?.type === 'service_responded' ? responded.claimSignature : undefined;
  const open = opened?.type === 'escrow_opened' ? opened.signature : undefined;
  const sig = claim ?? open;
  if (!sig || sig === 'NO_ONCHAIN_PROGRAM_ID') return undefined;
  return sig;
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
  floorPricePerCall: number;
  signature?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
     VALUES (?, 'call', ?, ?, ?, ?, ?)`,
  ).run(
    args.userId,
    -args.lamports,
    args.service,
    args.signature ?? null,
    JSON.stringify({
      mode: 'wallet-direct',
      floorPricePerCall: args.floorPricePerCall,
      dynamicAmountLamports: args.lamports,
    }),
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
  trace: X402Trace;
}> {
  const userWallet = loadUserWallet(args.userId);

  // Cliente del SDK con la wallet del user — esto firmará open_escrow/claim_payment
  const client = new AgentClient({
    wallet: userWallet,
    rpcUrl: process.env.SOLANA_RPC_URL,
  });

  // 1. Pre-quote: precio REAL que el agente cobrará para ESTE payload
  //    (pricing dinámico via priceFn — translator cobra por chars, oracle por
  //    símbolos, etc.). La cascada decide con este monto, no con el floor.
  const { manifest, quote } = await client.getQuote(args.service, args.payload, {
    timeoutMs: 30_000,
  });
  const lamports = Number(quote.amount);
  const virtualBalance = getBalance(args.userId);

  // 2. Cascada — decide modo y prepara fondos antes de la llamada.
  let mode: 'virtual' | 'wallet-direct';
  let debitResult: { newBalance: number; transactionId: number } | null = null;
  let refillInfo: RefillResult | null = null;

  if (virtualBalance >= lamports) {
    mode = 'virtual';

    const debited = debit({
      userId: args.userId,
      lamports,
      service: args.service,
      metadata: {
        mode: 'virtual',
        floorPricePerCall: manifest.pricePerCall,
        dynamicAmountLamports: lamports,
      },
    });
    if (!debited.ok) throw new Error(`debit failed: ${debited.error}`);
    debitResult = debited;

    try {
      refillInfo = await ensureFunded(args.userId, lamports);
    } catch (err) {
      refundDebit(args.userId, lamports, args.service, `refill failed: ${(err as Error).message}`);
      throw err;
    }
  } else {
    mode = 'wallet-direct';

    const onChain = await getOnChainBalance(userWallet);
    const required = lamports + WALLET_TX_FEE_BUFFER;
    if (onChain < required) {
      throw new Error(
        `insufficient funds: virtual ${virtualBalance} lamports + wallet ${onChain} lamports < ${required} (price ${lamports} + fee buffer ${WALLET_TX_FEE_BUFFER})`,
      );
    }
  }

  // 3. Llamada única al servicio. callWithTrace devuelve el resultado + un
  //    timeline de los 4 steps del handshake x402 (discover, 402_received,
  //    escrow_opened, service_responded). El monto del escrow coincide con
  //    `lamports` porque priceFn es determinista en el payload.
  let result: unknown;
  let trace: X402Trace;
  try {
    const traced = await client.callWithTrace(args.service, args.payload, {
      // maxPrice circuit breaker — 2x del cotizado por seguridad (en unidades del token)
      maxPrice: (lamports / BASE_UNITS_PER_TOKEN) * 2,
      timeoutMs: 30_000,
    });
    result = traced.result;
    trace = traced.trace;
  } catch (err) {
    if (mode === 'virtual') {
      refundDebit(args.userId, lamports, args.service, (err as Error).message);
    }
    throw err;
  }

  // 4. Post-pago: estampar la signature on-chain.
  //    - Virtual: el row ya existe (lo creó debit()) — UPDATE para backfill la sig.
  //    - Wallet-direct: insertamos el row ahora (no había debit) con la sig en el INSERT.
  //    En ambos casos la sig sale del trace; preferimos el claim (prueba que el agente
  //    cobró) sobre el escrow (prueba que el cliente fundó).
  const onChainSig = pickOnChainSignature(trace);
  if (mode === 'virtual' && debitResult && onChainSig) {
    attachSignature(debitResult.transactionId, onChainSig);
  }
  if (mode === 'wallet-direct') {
    recordWalletDirectCall({
      userId: args.userId,
      lamports,
      service: args.service,
      floorPricePerCall: manifest.pricePerCall,
      signature: onChainSig,
    });
  }

  return {
    result,
    cost: { lamports, usd: lamportsToUsd(lamports) },
    mode,
    newBalance:
      mode === 'virtual' && debitResult
        ? { lamports: debitResult.newBalance, usd: lamportsToUsd(debitResult.newBalance) }
        : { lamports: virtualBalance, usd: lamportsToUsd(virtualBalance) },
    ...(refillInfo?.refilled && refillInfo.signature
      ? {
          refill: {
            signature: refillInfo.signature,
            lamports: refillInfo.afterLamports - refillInfo.beforeLamports,
          },
        }
      : {}),
    trace,
  };
}

// Re-export para que index.ts lo siga importando desde aquí
export { masterWalletPubkey };
