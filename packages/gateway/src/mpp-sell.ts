/**
 * MPP, lado vendedor: los servicios del catálogo de Kiba, a la venta para agentes de fuera.
 *
 * Cada servicio tiene una ruta pública, `/mpp/<servicio>`, que no pide cuenta ni clave de Kiba.
 * Un agente externo la llama, recibe un 402 con el precio de ese pedido, paga en USDC con MPP y
 * repite la llamada: Kiba comprueba el pago, llama al servicio y le devuelve el resultado.
 *
 * Kiba es la destinataria del pago: el USDC llega a la tesorería y lo ganado por el publicador
 * se anota en el libro, igual que una llamada pagada con créditos. De ahí sigue el camino de
 * siempre (retención y liberación, o pago por lotes si la retención está apagada).
 *
 * Las pruebas de pago ya usadas se guardan en Postgres (`mpp_store`), así un mismo pago no sirve
 * dos veces aunque haya varios procesos del gateway.
 */
import { createHash } from 'node:crypto';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { Credential, Receipt } from 'mppx';
import { Mppx as MppxServer, Store } from 'mppx/server';
import { charge as stellarServerCharge } from '@stellar/mpp/charge/server';
import { db, withTransaction } from './db';
import { lamportsToUsd } from './billing';
import { MPP_NETWORK, mppCurrency, mppTreasury } from './mpp';
import { getMasterWallet } from './wallets';
import { recordEarning } from './settlement';
import { enqueueChainTask } from './treasury-queue';
import { getSpendChain } from './spend';
import { callServiceAsPlatform, listAgents, quoteService } from './proxy';

/** ¿Se venden los servicios por MPP? `MPP_SELL=0` lo apaga. */
export function mppSellEnabled(): boolean {
  return process.env.MPP_SELL !== '0';
}

// ─── Pruebas de pago ya usadas, en Postgres ─────────────────────────────────

/**
 * Almacén clave-valor sobre Postgres para la librería de MPP. `update` es atómico: toma un
 * candado por clave dentro de una transacción, así dos procesos nunca aceptan el mismo pago.
 */
export function pgMppStore(): Store.AtomicStore {
  return Store.cloudflare({
    async get(key: string): Promise<string | null> {
      const row = (await db.prepare('SELECT value FROM mpp_store WHERE key = ?').get(key)) as { value: string } | undefined;
      return row ? row.value : null;
    },
    async put(key: string, value: string): Promise<void> {
      await db
        .prepare(
          `INSERT INTO mpp_store (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        )
        .run(key, value, Math.floor(Date.now() / 1000));
    },
    async delete(key: string): Promise<void> {
      await db.prepare('DELETE FROM mpp_store WHERE key = ?').run(key);
    },
    update<result>(
      key: string,
      fn: (current: string | null) => { op: 'noop'; result: result } | { op: 'set'; value: string; result: result } | { op: 'delete'; result: result },
    ): Promise<result> {
      return withTransaction(async (tx) => {
        await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(key);
        const row = (await tx.prepare('SELECT value FROM mpp_store WHERE key = ?').get(key)) as { value: string } | undefined;
        const change = fn(row ? row.value : null);
        if (change.op === 'set') {
          await tx
            .prepare(
              `INSERT INTO mpp_store (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            )
            .run(key, change.value, Math.floor(Date.now() / 1000));
        } else if (change.op === 'delete') {
          await tx.prepare('DELETE FROM mpp_store WHERE key = ?').run(key);
        }
        return change.result;
      });
    },
  } as never);
}

// ─── Cobro: la librería de MPP con la tesorería de destinataria ─────────────

type ChargeResult =
  | { status: 402; challenge: Response }
  | { status: 200; withReceipt: (response: Response) => Response };
/** Lo mínimo que este módulo usa de la librería: pedir el cobro de un monto para una petición. */
export interface MppCharger {
  charge(options: { amount: string; description?: string; meta?: Record<string, string> }): (request: Request) => Promise<ChargeResult>;
}

/** Secreto con el que se firman los retos. Sale de la tesorería si no se configura uno. */
function challengeSecret(): string {
  if (process.env.MPP_SECRET_KEY) return process.env.MPP_SECRET_KEY;
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return createHash('sha256').update('kiba:mpp-challenges:').update(seed).digest('base64');
}

let charger: MppCharger | null = null;
/** Tests: sustituye el cobro (null = el real, contra la red). */
export function setMppCharger(c: MppCharger | null): void {
  charger = c;
}
function getCharger(): MppCharger {
  if (charger) return charger;
  charger = MppxServer.create({
    secretKey: challengeSecret(),
    realm: process.env.MPP_REALM || 'kiba',
    methods: [
      stellarServerCharge({
        recipient: mppTreasury().publicKey(),
        currency: mppCurrency(),
        network: MPP_NETWORK,
        store: pgMppStore(),
        ...(process.env.STELLAR_RPC_URL ? { rpcUrl: process.env.STELLAR_RPC_URL } : {}),
      }),
    ],
  }) as unknown as MppCharger;
  return charger;
}

// ─── El servicio detrás de la ruta ──────────────────────────────────────────

export interface MppSellDeps {
  /** Cuánto cobra el servicio por este pedido y a quién se le anota la ganancia. */
  quote(service: string, payload: unknown): Promise<{ lamports: number; payTo: string; ctx?: unknown }>;
  /** Llama al servicio ya pagado y devuelve su resultado. */
  serve(service: string, payload: unknown, ctx: unknown): Promise<unknown>;
}
const realDeps: MppSellDeps = {
  async quote(service, payload) {
    const q = await quoteService(service, payload);
    return { lamports: q.lamports, payTo: q.quote.payTo, ctx: q.manifest };
  },
  serve: (service, payload, ctx) => callServiceAsPlatform(ctx as never, service, payload),
};
let deps: MppSellDeps = realDeps;
/** Tests: sustituye la cotización y la llamada al servicio (null = las reales). */
export function setMppSellDeps(d: MppSellDeps | null): void {
  deps = d ?? realDeps;
}

// ─── Límite de peticiones por IP ────────────────────────────────────────────
// La ruta es pública y cada petición le pide una cotización al servicio del publicador.

const RATE_PER_MIN = Number(process.env.MPP_RATE_PER_MIN) || 60;
const hits = new Map<string, { n: number; resetAt: number }>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.resetAt <= now) {
    if (hits.size > 10_000) hits.clear();
    hits.set(ip, { n: 1, resetAt: now + 60_000 });
    return true;
  }
  h.n++;
  return h.n <= RATE_PER_MIN;
}

// ─── Devolución cuando el servicio falla después de cobrar ──────────────────

type Refunder = (to: string, lamports: number) => Promise<string>;
const realRefund: Refunder = (to, lamports) =>
  enqueueChainTask(async () => {
    const sc = getSpendChain();
    const treasury = mppTreasury();
    const tx = TransactionBuilder.fromXDR(await sc.buildPayment(treasury.publicKey(), to, BigInt(lamports)), sc.passphrase());
    tx.sign(treasury);
    return sc.submitSponsored(tx.toXDR());
  });
let refunder: Refunder = realRefund;
/** Tests: sustituye la devolución en la red (null = la real). */
export function setMppRefunder(fn: Refunder | null): void {
  refunder = fn ?? realRefund;
}

/** Dirección Stellar de quien pagó, leída de su prueba de pago (`did:pkh:stellar:<red>:<G...>`). */
function payerOf(authorization: string | undefined): string | null {
  if (!authorization) return null;
  try {
    const source = (Credential.deserialize(authorization) as { source?: string }).source ?? '';
    const g = source.split(':').pop() ?? '';
    return /^G[A-Z2-7]{55}$/.test(g) ? g : null;
  } catch {
    return null;
  }
}

const usdc = (lamports: number): string => {
  const s = String(lamports).padStart(8, '0');
  return `${s.slice(0, -7)}.${s.slice(-7)}`.replace(/\.?0+$/, '') || '0';
};

async function send(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.send(await response.text());
}

/** Catálogo público de lo que se puede comprar por MPP, con la URL de cada servicio. */
export async function listMppServices(base: string): Promise<unknown[]> {
  const agents = (await listAgents()) as Array<Record<string, unknown>>;
  return agents.map((a) => ({
    service: a.service,
    description: a.description,
    url: `${base}/mpp/${encodeURIComponent(String(a.service))}`,
    method: 'POST',
    // Precio base; el de cada pedido lo da el 402.
    pricePerCall: a.pricePerCall,
    protocol: 'mpp',
    network: MPP_NETWORK,
    currency: mppCurrency(),
  }));
}

/**
 * `ALL /mpp/:service` — una llamada de un agente externo a un servicio del catálogo, pagada con MPP.
 * El pedido va en el cuerpo JSON (o en la URL si se llama con GET).
 */
export async function handleMppSell(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  if (!mppSellEnabled()) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!allowed(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'demasiadas peticiones; intenta en un minuto' });
    return;
  }
  const service = String(req.params.service ?? '');
  const payload: unknown = req.method === 'GET' ? { ...req.query } : (req.body ?? {});

  // 1. Cuánto cuesta este pedido.
  let quote: Awaited<ReturnType<MppSellDeps['quote']>>;
  try {
    quote = await deps.quote(service, payload);
  } catch (err) {
    const msg = (err as Error).message;
    res.status(/not found|no existe|unknown service/i.test(msg) ? 404 : 502).json({ error: `no se pudo cotizar '${service}': ${msg}` });
    return;
  }

  // 2. Cobro: 402 con el reto, o pago comprobado y liquidado en la red.
  const authorization = req.get('authorization') ?? undefined;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const webRequest = new Request(url, { method: req.method, headers: authorization ? { authorization } : {} });
  let result: ChargeResult;
  try {
    result = await getCharger().charge({
      amount: usdc(quote.lamports),
      description: `Kiba: ${service}`,
      meta: { service },
    })(webRequest);
  } catch (err) {
    console.error(`[mpp] cobro de ${service}:`, (err as Error).message);
    res.status(502).json({ error: `no se pudo comprobar el pago: ${(err as Error).message}` });
    return;
  }
  if (result.status === 402) {
    await send(res, result.challenge);
    return;
  }

  // 3. Pagado. El recibo trae el hash de la transacción: queda anotado antes de servir.
  const receiptHeaders = result.withReceipt(new Response(null)).headers;
  let reference = '';
  try {
    reference = Receipt.deserialize(receiptHeaders.get('payment-receipt') ?? '').reference;
  } catch {
    /* sin recibo legible: la llamada sigue, pero no hay hash que guardar */
  }
  const payer = payerOf(authorization);
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO mpp_payments (service, pay_to, payer, amount, reference, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'paid', ?) RETURNING id`,
    )
    .run(service, quote.payTo, payer, quote.lamports, reference || null, now);
  const paymentId = Number(row.lastInsertRowid);

  // 4. Servir. Solo una llamada servida le deja ganancia al publicador.
  let out: unknown;
  try {
    out = await deps.serve(service, payload, quote.ctx);
  } catch (err) {
    const msg = (err as Error).message;
    let refundTx: string | null = null;
    let status = 'refund_pending';
    if (payer) {
      try {
        refundTx = await refunder(payer, quote.lamports);
        status = 'refunded';
      } catch (e) {
        console.error(`[mpp] devolución del pago ${paymentId} a ${payer}:`, (e as Error).message);
      }
    }
    await db.prepare('UPDATE mpp_payments SET status = ?, refund_tx = ?, error = ? WHERE id = ?').run(status, refundTx, msg.slice(0, 300), paymentId);
    res.status(502).json({
      error: `el servicio '${service}' falló después del pago: ${msg}`,
      payment: { reference: reference || null, amountUsd: lamportsToUsd(quote.lamports) },
      refund: refundTx ? { status: 'refunded', transaction: refundTx } : { status: 'pending' },
    });
    return;
  }
  const earningId = await recordEarning({ service, payTo: quote.payTo, lamports: quote.lamports });
  await db.prepare(`UPDATE mpp_payments SET status = 'served', earning_id = ? WHERE id = ?`).run(earningId, paymentId);

  await send(
    res,
    result.withReceipt(
      Response.json({
        service,
        result: out,
        cost: { baseUnits: quote.lamports, usd: lamportsToUsd(quote.lamports) },
        payment: { reference: reference || null, network: MPP_NETWORK },
      }),
    ),
  );
}
