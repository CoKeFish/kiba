/**
 * Proxy de /v1/call al SDK de Kiba.
 *
 * Modelo: dos buckets de fondos.
 *   1. Pre-quote: probe HTTP sin pago para obtener el monto REAL que el agente
 *      cobrará por ESTE payload (pricing dinámico via priceFn).
 *   2. Cascada (decide ANTES de llamar):
 *      - Si el CRÉDITO de plataforma cubre el costo → debita crédito y la TREASURY
 *        de la plataforma liquida el escrow on-chain (el wallet del user NO se toca).
 *      - Si no → modo wallet-direct: la custodial del user paga directo con su XLM
 *        on-chain. Sin debit de crédito.
 *   3. La llamada al servicio se hace UNA sola vez (callWithTrace), después de
 *      la decisión. El SDK maneja el handshake x402 internamente y devuelve
 *      un trace estructurado de los 4 steps.
 *   4. La cascada es por call entera, no parcial — para no fragmentar el escrow.
 */
import axios from 'axios';
import { AgentClient, type X402Trace } from '@kiba/sdk';
import { debit, getBalance, lamportsToUsd } from './billing';
import { db } from './db';
import { loadUserSigner, masterWalletPubkey, userOnChainBalance } from './wallets';
import { BASE_UNITS_PER_TOKEN } from './chain';
import { recordEarning } from './settlement';

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
  paidWith: 'credit' | 'wallet';
  newBalance: { lamports: number; usd: number };
  trace: X402Trace;
}> {
  const userSigner = await loadUserSigner(args.userId);

  // Cliente para la QUOTE (lectura). El cliente que LIQUIDA (firma open_escrow) se
  // elige según el bucket: treasury para crédito, custodial del user para wallet.
  const client = new AgentClient({ signer: userSigner });

  // 1. Pre-quote: precio REAL que el agente cobrará para ESTE payload
  //    (pricing dinámico via priceFn — translator cobra por chars, oracle por
  //    símbolos, etc.). La cascada decide con este monto, no con el floor.
  const { manifest, quote } = await client.getQuote(args.service, args.payload, {
    timeoutMs: 30_000,
  });
  const lamports = Number(quote.amount);
  const virtualBalance = getBalance(args.userId);

  // 2. Cascada — decide modo según el crédito disponible.

  // ── MODO CRÉDITO (off-chain, camino caliente) ─────────────────────────────
  // El usuario tiene crédito → debita crédito (off-chain) y llama al agente por la VÍA DE
  // CONFIANZA (X-Platform-Auth, SIN escrow per-call). La ganancia del agente se acredita en el
  // ledger y se liquida on-chain por LOTES (settlement.ts). Instantáneo: sin deploy/TW/indexer.
  if (virtualBalance >= lamports) {
    const platformAuth = process.env.PLATFORM_CALL_SECRET;
    if (!platformAuth) {
      // Fail-closed: sin el secreto no podemos usar la vía de confianza (y no queremos caer al
      // escrow per-call silenciosamente). El operador debe setear PLATFORM_CALL_SECRET.
      throw new Error(
        'PLATFORM_CALL_SECRET no configurado: el modo crédito off-chain requiere la vía de confianza',
      );
    }

    const debited = debit({
      userId: args.userId,
      lamports,
      service: args.service,
      metadata: {
        mode: 'virtual',
        settlement: 'deferred',
        floorPricePerCall: manifest.pricePerCall,
        dynamicAmountLamports: lamports,
      },
    });
    if (!debited.ok) throw new Error(`debit failed: ${debited.error}`);

    const t0 = Date.now();
    let result: unknown;
    try {
      result = await client.callTrusted(manifest.endpoint, args.payload, {
        platformAuth,
        timeoutMs: 120_000,
      });
    } catch (err) {
      // El agente no entregó (o rechazó la vía de confianza) → reembolsa el crédito.
      refundDebit(args.userId, lamports, args.service, (err as Error).message);
      throw err;
    }

    // Acredita la ganancia del agente con el precio COMPLETO (el 95/5 se aplica al liquidar
    // vía TW). Solo tras una llamada exitosa → un fallo nunca acumula ganancia.
    recordEarning({ service: args.service, payTo: quote.payTo, lamports });

    // Trace mínimo (sin escrow): solo discover + service_responded — los únicos step types
    // que el dashboard conoce. No hay signature on-chain por llamada (la liquidación es aparte).
    const elapsed = Math.max(1, Date.now() - t0);
    const trace: X402Trace = {
      service: manifest.service,
      endpoint: manifest.endpoint,
      totalDurationMs: elapsed,
      steps: [
        {
          type: 'discover',
          service: manifest.service,
          endpoint: manifest.endpoint,
          pricePerCall: manifest.pricePerCall,
          durationMs: 1,
          timestamp: t0,
        },
        { type: 'service_responded', status: 200, durationMs: elapsed, timestamp: Date.now() },
      ],
    };

    return {
      result,
      cost: { lamports, usd: lamportsToUsd(lamports) },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: debited.newBalance, usd: lamportsToUsd(debited.newBalance) },
      trace,
    };
  }

  // ── MODO WALLET-DIRECT (no-custodial, escrow per-call on-chain) ───────────
  // Sin crédito suficiente → la custodial del usuario paga directo el escrow on-chain.
  // Sin cambios respecto al flujo previo: este modo conserva la liquidación x402 per-call.
  const onChain = await userOnChainBalance(args.userId);
  const required = lamports + WALLET_TX_FEE_BUFFER;
  if (onChain < required) {
    throw new Error(
      `insufficient funds: credit ${virtualBalance} + wallet ${onChain} < ${required} (price ${lamports} + fee buffer ${WALLET_TX_FEE_BUFFER})`,
    );
  }

  const traced = await client.callWithTrace(args.service, args.payload, {
    // maxPrice circuit breaker — 2x del cotizado por seguridad (en unidades del token)
    maxPrice: (lamports / BASE_UNITS_PER_TOKEN) * 2,
    timeoutMs: 120_000,
  });
  const onChainSig = pickOnChainSignature(traced.trace);
  recordWalletDirectCall({
    userId: args.userId,
    lamports,
    service: args.service,
    floorPricePerCall: manifest.pricePerCall,
    signature: onChainSig,
  });

  const newBalanceLamports = await userOnChainBalance(args.userId);
  return {
    result: traced.result,
    cost: { lamports, usd: lamportsToUsd(lamports) },
    mode: 'wallet-direct',
    paidWith: 'wallet',
    newBalance: { lamports: newBalanceLamports, usd: lamportsToUsd(newBalanceLamports) },
    trace: traced.trace,
  };
}

// Re-export para que index.ts lo siga importando desde aquí
export { masterWalletPubkey };
