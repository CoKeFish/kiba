/**
 * Proxy de /v1/call: una llamada a un servicio en nombre de un usuario.
 *
 *   1. Cotización: se le pregunta al servicio cuánto cobra por ESTE pedido (precio dinámico).
 *   2. Se decide de dónde sale el pago, antes de llamar:
 *      - Créditos, si alcanzan.
 *      - Si no, el depósito retirable del usuario (channel.ts).
 *      - Si no hay ninguno de los dos, la llamada no se hace.
 *   3. El servicio se llama una sola vez, con la llamada firmada por la plataforma. Si falla,
 *      el pago se deshace.
 *   4. Lo ganado por el publicador se anota y sigue el camino de la retención (retention.ts).
 */
import axios from 'axios';
import { AgentClient, type ServiceManifest, type X402Quote, type X402Trace } from 'kiba-sdk';
import { debit, getBalance, lamportsToUsd } from './billing';
import { db, withTransaction } from './db';
import {
  getMasterWallet,
  getPlatformSigner,
  masterWalletPubkey,
  platformPublicKey,
} from './wallets';
import { BASE_UNITS_PER_TOKEN, explorerTxUrl } from './chain';
import { recordEarning } from './settlement';
import { type PerCallFundResult } from './escrows';
import { payOrFundForCall, perCallPaymentEnabled } from './kiba-pay';
import { confirmChannel, releaseChannel, reserveChannel } from './channel';
import { retentionEnabled } from './retention';

/**
 * Cuánto espera la respuesta al fund per-call (la tarea sigue en background si excede). Por
 * defecto 0: el fondeo tarda 10-15 s y la llamada ya está pagada con crédito, así que se responde
 * al instante y el link on-chain llega después por `onExplorerUrl`.
 */
const FUND_WAIT_TIMEOUT_MS = Number(process.env.PER_CALL_FUND_TIMEOUT_MS ?? 0) || 0;

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';

export async function listAgents(query?: string): Promise<unknown[]> {
  const url = query
    ? `${BACKEND_URL}/agents?q=${encodeURIComponent(query)}&mode=hybrid`
    : `${BACKEND_URL}/agents`;
  const r = await axios.get(url);
  return r.data;
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

/** Historial de una llamada pagada del depósito retirable (canal de pago del usuario). */
async function recordDepositCall(args: {
  userId: number;
  lamports: number;
  service: string;
  floorPricePerCall: number;
}): Promise<number> {
  const info = await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
     VALUES (?, 'call', ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      args.userId,
      -args.lamports,
      args.service,
      JSON.stringify({
        mode: 'deposit',
        settlement: 'deferred',
        floorPricePerCall: args.floorPricePerCall,
        dynamicAmountLamports: args.lamports,
      }),
      Math.floor(Date.now() / 1000),
    );
  return Number(info.lastInsertRowid);
}

/**
 * Trace de una llamada por la vía de confianza (crédito o depósito): discover +
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

/**
 * Ficha (manifest) de cada servicio. Buscarla en el registro on-chain cuesta ~60 ms por llamada
 * (con picos de segundos) y casi nunca cambia: se reutiliza MANIFEST_TTL_MS y luego se renueva en
 * segundo plano sin hacer esperar a la llamada. Si el servicio falla, se descarta. El precio y el
 * destinatario del pago NO salen de aquí: vienen de la quote del servicio en cada llamada.
 */
const MANIFEST_TTL_MS = 60_000;
const MANIFEST_MAX_STALE_MS = 10 * 60_000;
const manifests = new Map<string, { m: ServiceManifest; at: number; refreshing?: boolean }>();

async function cachedManifest(client: AgentClient, service: string): Promise<ServiceManifest> {
  const c = manifests.get(service);
  const age = c ? Date.now() - c.at : Infinity;
  if (c && age < MANIFEST_MAX_STALE_MS) {
    if (age > MANIFEST_TTL_MS && !c.refreshing) {
      c.refreshing = true;
      void client
        .discover(service)
        .then((m) => manifests.set(service, { m, at: Date.now() }))
        .catch(() => {
          c.refreshing = false;
        });
    }
    return c.m;
  }
  const m = await client.discover(service);
  manifests.set(service, { m, at: Date.now() });
  return m;
}

export async function callOnBehalf(args: {
  userId: number;
  service: string;
  payload: unknown;
  /** Modo crédito: link de la tx del fund per-call cuando confirma (después de responder). */
  onExplorerUrl?: (url: string) => void;
  /** Modo crédito: se llama con el resultado ANTES de enviar el pago por llamada. Lo que devuelva
   *  (u64) viaja en el `reference` del pago: la huella del documento de licencia (licenses.ts). */
  onBeforePay?: (result: unknown, info: { lamports: number; payTo: string }) => Promise<bigint | undefined>;
  /** Id de la llamada (call_results). Viaja al servicio en `X-Kiba-Call-Id`: lo que el servicio
   *  pague a otros mientras la sirve (ctx.kiba) queda ligado a ella como llamada hija. */
  callId?: string;
}): Promise<{
  result: unknown;
  cost: { lamports: number; usd: number };
  mode: 'virtual' | 'deposit';
  paidWith: 'credit' | 'wallet';
  newBalance: { lamports: number; usd: number };
  trace: X402Trace;
  /** Link a stellar.expert de la transacción de ESTA llamada, cuando se paga al momento. */
  explorerUrl?: string;
}> {
  // Cliente para la cotización y la llamada. Nunca firma con la wallet del usuario.
  const client = new AgentClient({ wallet: getMasterWallet() });

  // 1. Pre-quote: precio REAL que el agente cobrará para ESTE payload
  //    (pricing dinámico via priceFn — translator cobra por chars, oracle por
  //    símbolos, etc.). La cascada decide con este monto, no con el floor.
  const tQuote = Date.now();
  // La cotización va firmada con la clave de plataforma: todas las llamadas de todos los
  // usuarios llegan al agente desde la IP del gateway, y sin firma el límite por IP del agente
  // (60/min) se convierte en un límite de toda la plataforma.
  let manifest: ServiceManifest;
  let quote: X402Quote;
  try {
    ({ manifest, quote } = await client.getQuote(args.service, args.payload, {
      timeoutMs: 30_000,
      signer: getPlatformSigner(),
      manifest: await cachedManifest(client, args.service),
    }));
  } catch (err) {
    manifests.delete(args.service); // endpoint viejo o servicio caído: la próxima vez se rebusca
    throw err;
  }
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
        callId: args.callId,
      });
    } catch (err) {
      // El agente no entregó (o rechazó la firma de la plataforma) → reembolsa el crédito.
      manifests.delete(args.service);
      await refundDebit(args.userId, lamports, args.service, (err as Error).message);
      throw err;
    }

    // Acredita la ganancia del agente con el precio COMPLETO (el 95/5 se aplica al liquidar
    // vía TW). Solo tras una llamada exitosa → un fallo nunca acumula ganancia.
    const earningId = await recordEarning({
      service: args.service,
      payTo: quote.payTo,
      lamports,
      paidBy: { userId: args.userId, transactionId: debited.transactionId, paidWith: 'credit' },
    });

    // Fund per-call: fondea el escrow TW del ciclo del servicio con el monto de ESTA
    // llamada — una tx Stellar consultable por llamada. Esperamos el hash en línea (la
    // demo lo muestra en la respuesta), con tope: si excede, la tarea sigue en background
    // (la fila y transactions.signature quedan bien; solo esta respuesta sale sin link).
    // Ante cualquier fallo on-chain la ganancia ya quedó acumulada (legacy) — la llamada
    // nunca falla por la cadena.
    let onchain: PerCallFundResult = {};
    const t1 = Date.now();
    // Si el resultado trae licencia, su documento se escribe ahora (con la wallet que cobra) y su
    // huella viaja en el pago por llamada.
    const reference = await args.onBeforePay?.(result, { lamports, payTo: quote.payTo }).catch(() => undefined);
    // Con retención, la ganancia espera su plazo en un escrow y no se paga por llamada. La
    // excepción es una llamada que devuelve una licencia: su pago lleva la huella del documento
    // y es la prueba de la licencia, así que se hace ahora.
    if (perCallPaymentEnabled() && (!retentionEnabled() || reference !== undefined)) {
      const fund = payOrFundForCall({
        service: args.service,
        payTo: quote.payTo,
        lamports,
        earningId,
        transactionId: debited.transactionId,
        reference,
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

  // ── MODO DEPÓSITO (canal de pago del usuario, channel.ts) ────────────────
  // Sin crédito → si el usuario tiene un depósito abierto, el precio se aparta de ahí al
  // instante (sin cadena) y, si el servicio responde, pasa a consumido. Kiba lo cobra al canal
  // por tandas. El servicio se llama por la vía de confianza, igual que en modo crédito.
  const hold = await reserveChannel(args.userId, lamports);
  if (!hold.ok && hold.reason === 'insufficient') {
    throw new Error(
      `depósito insuficiente: la llamada cuesta ${lamportsToUsd(lamports).toFixed(4)} USD y quedan ${lamportsToUsd(hold.available).toFixed(4)} USD; recarga el depósito`,
    );
  }
  if (hold.ok) {
    const t0 = Date.now();
    let result: unknown;
    try {
      result = await client.callSigned(manifest.endpoint, args.payload, {
        signer: getPlatformSigner(),
        service: args.service,
        timeoutMs: 120_000,
        callId: args.callId,
      });
    } catch (err) {
      manifests.delete(args.service);
      await releaseChannel(hold);
      throw err;
    }
    await confirmChannel(hold);
    const transactionId = await recordDepositCall({
      userId: args.userId,
      lamports,
      service: args.service,
      floorPricePerCall: manifest.pricePerCall,
    });
    await recordEarning({
      service: args.service,
      payTo: quote.payTo,
      lamports,
      paidBy: { userId: args.userId, transactionId, paidWith: 'deposit', channelId: hold.channelId },
    });
    return {
      result,
      cost: { lamports, usd: lamportsToUsd(lamports) },
      mode: 'deposit',
      paidWith: 'wallet',
      newBalance: { lamports: hold.left, usd: lamportsToUsd(hold.left) },
      trace: platformTrace({ manifest, quote, tQuote, quoteDurationMs, t0, lamports }),
    };
  }

  // Sin créditos ni depósito no hay de dónde pagar.
  throw new Error(
    `saldo insuficiente: la llamada cuesta ${lamportsToUsd(lamports).toFixed(4)} USD y tienes ${lamportsToUsd(virtualBalance).toFixed(4)} USD en créditos; recarga créditos o abre un depósito desde tu wallet`,
  );
}

export { masterWalletPubkey, platformPublicKey };
