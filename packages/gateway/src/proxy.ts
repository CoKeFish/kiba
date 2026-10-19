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
import { AgentClient, type X402Trace } from 'kiba-sdk';
import { debit, getBalance, lamportsToUsd } from './billing';
import { db, withTransaction } from './db';
import {
  getMasterWallet,
  getPlatformSigner,
  loadUserSigner,
  masterWalletPubkey,
  platformPublicKey,
  userOnChainBalance,
} from './wallets';
import { BASE_UNITS_PER_TOKEN, explorerTxUrl } from './chain';
import { recordEarning } from './settlement';
import { fundForCall, perCallFundEnabled, type PerCallFundResult } from './escrows';
import { hasSpendWallet, releaseSpend, reserveSpend } from './spend';

/**
 * Cuánto espera la respuesta al fund per-call (la tarea sigue en background si excede). Por
 * defecto 0: el fondeo tarda 10-15 s y la llamada ya está pagada con crédito, así que se responde
 * al instante y el link on-chain llega después por `onExplorerUrl`.
 */
const FUND_WAIT_TIMEOUT_MS = Number(process.env.PER_CALL_FUND_TIMEOUT_MS ?? 0) || 0;

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

async function refundDebit(
  userId: number,
  lamports: number,
  service: string,
  reason: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await withTransaction(async (tx) => {
    await tx
      .prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?')
      .run(lamports, userId);
    await tx
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'refund', ?, ?, ?, ?)`,
      )
      .run(userId, lamports, service, JSON.stringify({ reason }), now);
  });
}

async function recordWalletDirectCall(args: {
  userId: number;
  lamports: number;
  service: string;
  floorPricePerCall: number;
  signature?: string;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
     VALUES (?, 'call', ?, ?, ?, ?, ?)`,
    )
    .run(
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

async function recordSpendCall(args: {
  userId: number;
  lamports: number;
  service: string;
  floorPricePerCall: number;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
     VALUES (?, 'call', ?, ?, ?, ?)`,
    )
    .run(
      args.userId,
      -args.lamports,
      args.service,
      JSON.stringify({
        mode: 'spend-permit',
        settlement: 'deferred',
        floorPricePerCall: args.floorPricePerCall,
        dynamicAmountLamports: args.lamports,
      }),
      Math.floor(Date.now() / 1000),
    );
}

/**
 * Trace de una llamada por la vía de confianza (crédito o permiso de gasto): discover +
 * 402_received + (escrow_opened si el fund per-call confirmó) + service_responded — step types
 * que el dashboard ya conoce. El 402_received registra la pre-quote REAL (probe 402 de getQuote);
 * sin él, el panel de flujo del dashboard dejaba "Cotización recibida" eternamente en espera.
 * En escrow_opened va el hash REAL del fondeo.
 */
function platformTrace(a: {
  manifest: { service: string; endpoint: string; pricePerCall: number };
  quote: { amount: unknown; payTo: unknown; asset?: unknown; nonce: unknown; expiresAt?: unknown };
  tQuote: number;
  quoteDurationMs: number;
  t0: number;
  lamports: number;
  fund?: { txHash: string; escrowId?: string; t1: number };
}): X402Trace {
  const elapsed = Math.max(1, Date.now() - a.t0);
  return {
    service: a.manifest.service,
    endpoint: a.manifest.endpoint,
    totalDurationMs: elapsed,
    steps: [
      {
        type: 'discover',
        service: a.manifest.service,
        endpoint: a.manifest.endpoint,
        pricePerCall: a.manifest.pricePerCall,
        durationMs: 1,
        timestamp: a.tQuote,
      },
      {
        type: '402_received',
        quote: {
          amount: String(a.quote.amount),
          payTo: String(a.quote.payTo),
          asset: String(a.quote.asset ?? 'USDC'),
          nonce: String(a.quote.nonce),
          expiresAt: Number(a.quote.expiresAt ?? 0),
        },
        durationMs: a.quoteDurationMs,
        timestamp: a.tQuote,
      },
      ...(a.fund
        ? [
            {
              type: 'escrow_opened' as const,
              signature: a.fund.txHash,
              escrowId: a.fund.escrowId,
              amount: String(a.lamports),
              nonce: a.fund.escrowId ?? '',
              durationMs: Math.max(1, Date.now() - a.fund.t1),
              timestamp: a.fund.t1,
            },
          ]
        : []),
      { type: 'service_responded', status: 200, durationMs: elapsed, timestamp: Date.now() },
    ],
  };
}

export async function callOnBehalf(args: {
  userId: number;
  service: string;
  payload: unknown;
  /** Modo crédito: link de la tx del fund per-call cuando confirma (después de responder). */
  onExplorerUrl?: (url: string) => void;
}): Promise<{
  result: unknown;
  cost: { lamports: number; usd: number };
  mode: 'virtual' | 'spend-permit' | 'wallet-direct';
  paidWith: 'credit' | 'wallet';
  newBalance: { lamports: number; usd: number };
  trace: X402Trace;
  /** Link a stellar.expert para inspeccionar la tx on-chain de ESTA llamada: el escrow
   *  x402 en wallet-direct, o el fondeo per-call del escrow del ciclo en modo crédito. */
  explorerUrl?: string;
}> {
  // Cliente para la QUOTE (lectura, no firma). El firmante del usuario se carga SOLO en modo
  // wallet-direct: cargarlo provisiona una wallet de Privy controlada por Kiba si no tiene una,
  // y con crédito o wallet de pagos no hace falta.
  const client = new AgentClient({ wallet: getMasterWallet() });

  // 1. Pre-quote: precio REAL que el agente cobrará para ESTE payload
  //    (pricing dinámico via priceFn — translator cobra por chars, oracle por
  //    símbolos, etc.). La cascada decide con este monto, no con el floor.
  const tQuote = Date.now();
  // La cotización va firmada con la clave de plataforma: todas las llamadas de todos los
  // usuarios llegan al agente desde la IP del gateway, y sin firma el límite por IP del agente
  // (60/min) se convierte en un límite de toda la plataforma.
  const { manifest, quote } = await client.getQuote(args.service, args.payload, {
    timeoutMs: 30_000,
    signer: getPlatformSigner(),
  });
  const quoteDurationMs = Math.max(1, Date.now() - tQuote);
  const lamports = Number(quote.amount);
  const virtualBalance = await getBalance(args.userId);

  // 2. Cascada — decide modo según el crédito disponible.

  // ── MODO CRÉDITO (off-chain, camino caliente) ─────────────────────────────
  // El usuario tiene crédito → debita crédito (off-chain) y llama al agente por la VÍA DE
  // CONFIANZA: la plataforma FIRMA la llamada con su clave privada y el agente la verifica con
  // la clave PÚBLICA publicada (sin secreto compartido, SIN escrow per-call). La ganancia del
  // agente se acredita y se liquida on-chain por LOTES (settlement.ts). Instantáneo.
  if (virtualBalance >= lamports) {
    // Firmante de la plataforma (asimétrico). Deriva de la treasury si no hay KIBA_PLATFORM_SECRET.
    const platformSigner = getPlatformSigner();

    const debited = await debit({
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
      result = await client.callSigned(manifest.endpoint, args.payload, {
        signer: platformSigner,
        service: args.service,
        timeoutMs: 120_000,
      });
    } catch (err) {
      // El agente no entregó (o rechazó la firma de la plataforma) → reembolsa el crédito.
      await refundDebit(args.userId, lamports, args.service, (err as Error).message);
      throw err;
    }

    // Acredita la ganancia del agente con el precio COMPLETO (el 95/5 se aplica al liquidar
    // vía TW). Solo tras una llamada exitosa → un fallo nunca acumula ganancia.
    const earningId = await recordEarning({ service: args.service, payTo: quote.payTo, lamports });

    // Fund per-call: fondea el escrow TW del ciclo del servicio con el monto de ESTA
    // llamada — una tx Stellar consultable por llamada. Esperamos el hash en línea (la
    // demo lo muestra en la respuesta), con tope: si excede, la tarea sigue en background
    // (la fila y transactions.signature quedan bien; solo esta respuesta sale sin link).
    // Ante cualquier fallo on-chain la ganancia ya quedó acumulada (legacy) — la llamada
    // nunca falla por la cadena.
    let onchain: PerCallFundResult = {};
    const t1 = Date.now();
    if (perCallFundEnabled()) {
      const fund = fundForCall({
        service: args.service,
        payTo: quote.payTo,
        lamports,
        earningId,
        transactionId: debited.transactionId,
      }).catch((): PerCallFundResult => ({}));
      void fund.then((r) => {
        if (r.txHash) args.onExplorerUrl?.(explorerTxUrl(r.txHash));
      });
      if (FUND_WAIT_TIMEOUT_MS > 0) {
        onchain = await Promise.race([
          fund,
          new Promise<PerCallFundResult>((resolve) => setTimeout(() => resolve({}), FUND_WAIT_TIMEOUT_MS)),
        ]);
      }
    }

    const trace = platformTrace({
      manifest,
      quote,
      tQuote,
      quoteDurationMs,
      t0,
      lamports,
      fund: onchain.txHash ? { txHash: onchain.txHash, escrowId: onchain.escrowId, t1 } : undefined,
    });

    return {
      result,
      cost: { lamports, usd: lamportsToUsd(lamports) },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: debited.newBalance, usd: lamportsToUsd(debited.newBalance) },
      trace,
      explorerUrl: onchain.txHash ? explorerTxUrl(onchain.txHash) : undefined,
    };
  }

  // ── MODO PERMISO DE GASTO (wallet propia del usuario, spend.ts) ──────────
  // Sin crédito → si el usuario vinculó su wallet con un permiso de gasto, la llamada se anota
  // como deuda al instante (acotada por saldo, permiso y tope de deuda) y se cobra por lotes con
  // transfer_from. El agente se llama por la vía de confianza, igual que en modo crédito.
  if (await hasSpendWallet(args.userId)) {
    const reserved = await reserveSpend(args.userId, lamports);
    if (!reserved.ok) throw new Error(`permiso de gasto: ${reserved.reason}`);

    const t0 = Date.now();
    let result: unknown;
    try {
      result = await client.callSigned(manifest.endpoint, args.payload, {
        signer: getPlatformSigner(),
        service: args.service,
        timeoutMs: 120_000,
      });
    } catch (err) {
      await releaseSpend(args.userId, lamports);
      throw err;
    }
    await recordEarning({ service: args.service, payTo: quote.payTo, lamports });
    await recordSpendCall({
      userId: args.userId,
      lamports,
      service: args.service,
      floorPricePerCall: manifest.pricePerCall,
    });

    // Saldo restante según la lectura de la reserva: releer la cadena aquí añadía hasta ~13 s
    // a la llamada cuando el RPC tenía un pico.
    const left = reserved.left;
    return {
      result,
      cost: { lamports, usd: lamportsToUsd(lamports) },
      mode: 'spend-permit',
      paidWith: 'wallet',
      newBalance: { lamports: left, usd: lamportsToUsd(left) },
      trace: platformTrace({ manifest, quote, tQuote, quoteDurationMs, t0, lamports }),
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

  // Este modo SÍ firma con la wallet del usuario (escrow x402 per-call).
  const walletClient = new AgentClient({ signer: await loadUserSigner(args.userId) });
  const traced = await walletClient.callWithTrace(args.service, args.payload, {
    // maxPrice circuit breaker — 2x del cotizado por seguridad (en unidades del token)
    maxPrice: (lamports / BASE_UNITS_PER_TOKEN) * 2,
    timeoutMs: 120_000,
  });
  const onChainSig = pickOnChainSignature(traced.trace);
  await recordWalletDirectCall({
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
    explorerUrl: onChainSig ? explorerTxUrl(onChainSig) : undefined,
  };
}

// Re-export para que index.ts lo siga importando desde aquí
export { masterWalletPubkey, platformPublicKey };
