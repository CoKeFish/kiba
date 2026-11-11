/**
 * x402 estándar hacia fuera (lado comprador).
 *
 * Kiba paga cualquier API que cobre con x402 (HTTP 402) en Stellar, esté o no en el
 * registro de Kiba. El flujo es el del estándar (x402 v2, esquema `exact`, red
 * `stellar:testnet` / `stellar:pubnet`, USDC):
 *
 *   1. Se llama a la URL sin pago. Si no responde 402, se devuelve tal cual (gratis).
 *   2. Del 402 se leen los requisitos de pago (cabecera PAYMENT-REQUIRED) y se elige la
 *      opción en Stellar con USDC.
 *   3. Se cobra al usuario (crédito o depósito) y la TREASURY firma la
 *      autorización de la transferencia USDC (solo las auth entries: la red la paga
 *      el facilitador del vendedor, la treasury no gasta XLM).
 *   4. Se repite la llamada con la cabecera PAYMENT-SIGNATURE. El vendedor verifica y
 *      liquida on-chain vía su facilitador y responde con PAYMENT-RESPONSE (hash de la tx).
 *   5. Si la API rechaza la llamada pagada sin liquidar, se reembolsa al usuario.
 *
 * Este carril es solo de interoperabilidad: los servicios del registro siguen por la vía
 * de confianza (proxy.ts), que es off-chain e instantánea.
 */
import { randomBytes } from 'node:crypto';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { readLimitedText } from '@x402/core/http';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SchemeNetworkClient,
  SettleResponse,
} from '@x402/core/types';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createEd25519Signer, getUsdcAddress, isStellarNetwork } from '@x402/stellar';
import { attachSignature, debit, getBalance, lamportsToUsd, usdToLamports } from './billing';
import { db, withTransaction } from './db';
import { explorerTxUrl } from './chain';
import { getMasterWallet } from './wallets';
import { confirmChannel, releaseChannel, reserveChannel, type ChannelReserve } from './channel';
import { assertAllowedUrl } from './net-guard';
import { resultUrl } from './results';

/** Red x402 (CAIP-2) derivada de STELLAR_NETWORK, igual que el resto del gateway. */
export const X402_NETWORK: `stellar:${string}` =
  (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';

/** Tope por llamada si el usuario no autoriza otro (USD). */
const MAX_USD_DEFAULT = Number(process.env.X402_MAX_USD_PER_CALL) || 1;
/** Tope absoluto que ningún `maxUsd` puede superar (USD). */
const MAX_USD_HARD = Number(process.env.X402_MAX_USD_HARD) || 20;
const RESPONSE_LIMIT_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.X402_TIMEOUT_MS) || 60_000;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Cabeceras que el llamador no puede fijar (las pone el gateway o el protocolo). */
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'payment-signature',
  'x-payment',
  'payment-required',
  'payment-response',
]);

export interface X402CallArgs {
  userId: number;
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Precio máximo que el usuario autoriza para ESTA llamada (USD). */
  maxUsd?: number;
  /** Llamada padre ya validada (results.resolveParentCall): un servicio paga esta API mientras sirve esa llamada. */
  parentId?: string | null;
}

export interface X402CallResult {
  resultId: string;
  resultUrl: string;
  url: string;
  status: number;
  /** Cuerpo de la respuesta de la API (JSON parseado o texto). */
  result: unknown;
  paid: boolean;
  cost: { lamports: number; usd: number };
  paidWith?: 'credit' | 'wallet';
  network?: string;
  payTo?: string;
  payer?: string;
  txHash?: string;
  explorerUrl?: string;
  newBalance?: { lamports: number; usd: number };
  /** Aviso cuando la API cobró pero respondió error (no hay reembolso: el pago ya está en cadena). */
  warning?: string;
}

// ─── firma: la treasury como pagador x402 ──────────────────────────────────

let schemeFactory: (() => SchemeNetworkClient) | null = null;
/** Tests: sustituye el esquema de pago (null = el real, con la treasury). */
export function setX402Scheme(factory: (() => SchemeNetworkClient) | null): void {
  schemeFactory = factory;
}

function treasurySecret(): string {
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return StellarKeypair.fromRawEd25519Seed(seed).secret();
}

/** Cuenta Stellar (G...) desde la que Kiba paga las APIs x402. */
export function x402PayerAddress(): string {
  return StellarKeypair.fromSecret(treasurySecret()).publicKey();
}

function paymentScheme(): SchemeNetworkClient {
  if (schemeFactory) return schemeFactory();
  const signer = createEd25519Signer(treasurySecret(), X402_NETWORK);
  const rpcUrl = process.env.STELLAR_RPC_URL;
  return new ExactStellarScheme(signer, rpcUrl ? { url: rpcUrl } : undefined);
}

function httpClient(): x402HTTPClient {
  // El tope de gasto lo aplica este módulo (maxUsd) antes de firmar; el del cliente x402
  // (1 USD por defecto) estorbaría cuando el usuario autoriza más.
  const client = new x402Client().register(X402_NETWORK, paymentScheme()).setSpendControls(false);
  return new x402HTTPClient(client);
}

// ─── URL: solo destinos públicos ───────────────────────────────────────────
// El filtro anti-SSRF vive en net-guard.ts (lo comparte la copia de archivos de resultados).
export { assertAllowedUrl };

function cleanHeaders(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const key = k.toLowerCase();
    if (RESERVED_HEADERS.has(key) || typeof v !== 'string') continue;
    out[key] = v;
  }
  return out;
}

interface HttpReply {
  status: number;
  headers: Headers;
  body: unknown;
}

async function send(u: URL, method: string, headers: Record<string, string>, body?: string): Promise<HttpReply> {
  const res = await fetch(u, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await readLimitedText(res, RESPONSE_LIMIT_BYTES);
  let parsed: unknown = text;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

// ─── requisitos de pago ────────────────────────────────────────────────────

/** Elige la opción de pago en Stellar (USDC, esquema exact, nuestra red). */
export function pickStellarRequirements(accepts: PaymentRequirements[]): PaymentRequirements {
  const usdc = getUsdcAddress(X402_NETWORK);
  const match = accepts.find(
    (a) => a.network === X402_NETWORK && a.scheme === 'exact' && a.asset === usdc,
  );
  if (match) return match;
  const offered = Array.from(new Set(accepts.map((a) => `${a.scheme}@${a.network}`)));
  const stellarOther = accepts.find((a) => isStellarNetwork(a.network));
  if (stellarOther && stellarOther.network !== X402_NETWORK) {
    throw new Error(
      `la API cobra en ${stellarOther.network} y Kiba opera en ${X402_NETWORK} (ofrece: ${offered.join(', ')})`,
    );
  }
  throw new Error(`la API no acepta USDC en ${X402_NETWORK} (ofrece: ${offered.join(', ') || 'nada'})`);
}

function describe(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const b = body as Record<string, unknown>;
  const msg = b.error ?? b.message ?? b.detail;
  return typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(body).slice(0, 300);
}

// ─── cobro y reembolso ─────────────────────────────────────────────────────

async function refundCredit(userId: number, lamports: number, service: string, reason: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await withTransaction(async (tx) => {
    await tx.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(lamports, userId);
    await tx
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
         VALUES (?, 'refund', ?, ?, ?, ?)`,
      )
      .run(userId, lamports, service, JSON.stringify({ reason, mode: 'x402' }), now);
  });
}

async function recordSpendCall(userId: number, lamports: number, service: string, meta: object): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'call', ?, ?, ?, ?)`,
    )
    .run(userId, -lamports, service, JSON.stringify({ ...meta, settlement: 'deferred' }), Math.floor(Date.now() / 1000));
}

async function openResult(
  userId: number,
  service: string,
  payload: unknown,
  parentId?: string | null,
): Promise<string> {
  const id = `res_${randomBytes(12).toString('hex')}`;
  await db
    .prepare(
      `INSERT INTO call_results (id, user_id, service, payload, status, parent_id, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(id, userId, service, JSON.stringify(payload ?? {}), parentId ?? null, Math.floor(Date.now() / 1000));
  return id;
}

async function closeResult(id: string, out: { result?: unknown; error?: string; lamports?: number; explorerUrl?: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (out.error !== undefined) {
    await db
      .prepare(`UPDATE call_results SET status = 'error', error = ?, completed_at = ? WHERE id = ?`)
      .run(out.error, now, id)
      .catch(() => undefined);
    return;
  }
  await db
    .prepare(
      `UPDATE call_results SET status = 'done', result = ?, cost_lamports = ?, explorer_url = ?, completed_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(out.result ?? null), out.lamports ?? 0, out.explorerUrl ?? null, now, id)
    .catch(() => undefined);
}

// ─── entrada principal ─────────────────────────────────────────────────────

export async function callX402Url(args: X402CallArgs): Promise<X402CallResult> {
  const u = await assertAllowedUrl(args.url);
  const method = (args.method ?? (args.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  if (!METHODS.has(method)) throw new Error(`método no soportado: ${method}`);
  const headers = cleanHeaders(args.headers);
  const bodyText =
    args.body === undefined || args.body === null
      ? undefined
      : typeof args.body === 'string'
        ? args.body
        : JSON.stringify(args.body);
  if (bodyText !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  if (!headers.accept) headers.accept = 'application/json';
  const maxUsd = Math.min(args.maxUsd ?? MAX_USD_DEFAULT, MAX_USD_HARD);

  const service = `x402:${u.host}`;
  const resultId = await openResult(
    args.userId,
    service,
    { url: u.href, method, body: args.body ?? undefined },
    args.parentId,
  );
  const base = { resultId, resultUrl: resultUrl(resultId), url: u.href };

  // 1. Sin pago: ¿cobra?
  const first = await send(u, method, headers, bodyText).catch(async (err) => {
    await closeResult(resultId, { error: (err as Error).message });
    throw new Error(`no se pudo llamar a ${u.host}: ${(err as Error).message}`);
  });
  if (first.status !== 402) {
    await closeResult(resultId, { result: first.body, lamports: 0 });
    return { ...base, status: first.status, result: first.body, paid: false, cost: { lamports: 0, usd: 0 } };
  }

  // 2. Requisitos de pago en Stellar.
  const http = httpClient();
  let required: PaymentRequired;
  let accept: PaymentRequirements;
  try {
    required = http.getPaymentRequiredResponse((n) => first.headers.get(n), first.body);
    accept = pickStellarRequirements(required.accepts ?? []);
  } catch (err) {
    await closeResult(resultId, { error: (err as Error).message });
    throw err;
  }
  const lamports = Number(BigInt(accept.amount));
  const capLamports = usdToLamports(maxUsd);
  if (lamports > capLamports) {
    const msg = `la API cobra ${lamportsToUsd(lamports).toFixed(4)} USD por esta llamada y el límite es ${maxUsd} USD; repite con maxUsd para autorizarlo`;
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  }

  // 3. Cobro al usuario: crédito primero, si no su depósito.
  const meta = { mode: 'x402', url: u.href, network: accept.network, payTo: accept.payTo, scheme: accept.scheme };
  let paidWith: 'credit' | 'wallet';
  let hold: ChannelReserve = { ok: false, reason: 'none', available: 0 };
  let debitTxId: number | undefined;
  let left: number;
  const virtual = await getBalance(args.userId);
  if (virtual >= lamports) {
    const d = await debit({ userId: args.userId, lamports, service, metadata: meta });
    if (!d.ok) {
      await closeResult(resultId, { error: d.error });
      throw new Error(`debit failed: ${d.error}`);
    }
    paidWith = 'credit';
    debitTxId = d.transactionId;
    left = d.newBalance;
  } else if ((hold = await reserveChannel(args.userId, lamports)).ok) {
    // Depósito retirable: el precio se aparta del canal y pasa a consumido si la API responde.
    paidWith = 'wallet';
    left = hold.left;
  } else if (hold.reason === 'insufficient') {
    const msg = `depósito insuficiente: la API cobra ${lamportsToUsd(lamports).toFixed(4)} USD y quedan ${lamportsToUsd(hold.available).toFixed(4)} USD; recarga el depósito`;
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  } else {
    const msg = `saldo insuficiente: la API cobra ${lamportsToUsd(lamports).toFixed(4)} USD y tienes ${lamportsToUsd(virtual).toFixed(4)} USD`;
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  }
  const refund = async (reason: string) => {
    if (paidWith === 'credit') await refundCredit(args.userId, lamports, service, reason);
    else if (hold.ok) await releaseChannel(hold);
  };

  // 4. Firma de la treasury + llamada pagada.
  let payload: PaymentPayload;
  try {
    payload = await http.createPaymentPayload({ ...required, accepts: [accept] });
  } catch (err) {
    const msg = `no se pudo firmar el pago: ${(err as Error).message}`;
    await refund(msg);
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  }
  let second: HttpReply;
  try {
    second = await send(u, method, { ...headers, ...http.encodePaymentSignatureHeader(payload) }, bodyText);
  } catch (err) {
    const msg = `la llamada pagada a ${u.host} falló: ${(err as Error).message}`;
    await refund(msg);
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  }

  // 5. Resultado: liquidado (PAYMENT-RESPONSE) o rechazo.
  const parsed = http.parsePaymentResult({ status: second.status, getHeader: (n) => second.headers.get(n), body: second.body });
  const settled = parsed.paymentStatus === 'settled' ? (parsed.header as SettleResponse) : undefined;
  if (second.status >= 400 && !settled) {
    const msg = `la API rechazó la llamada pagada (${second.status}): ${describe(second.body) || 'sin detalle'}`;
    await refund(msg);
    await closeResult(resultId, { error: msg });
    throw new Error(msg);
  }

  const txHash = settled?.transaction || undefined;
  const explorerUrl = txHash ? explorerTxUrl(txHash) : undefined;
  if (txHash && debitTxId != null) await attachSignature(debitTxId, txHash).catch(() => undefined);
  if (hold.ok) await confirmChannel(hold);
  if (paidWith === 'wallet') await recordSpendCall(args.userId, lamports, service, { ...meta, txHash, ...(hold.ok ? { paidFrom: 'deposit' } : {}) });
  await closeResult(resultId, { result: second.body, lamports, explorerUrl });

  return {
    ...base,
    status: second.status,
    result: second.body,
    paid: true,
    paidWith,
    cost: { lamports, usd: lamportsToUsd(lamports) },
    network: accept.network,
    payTo: accept.payTo,
    payer: settled?.payer,
    txHash,
    explorerUrl,
    newBalance: { lamports: left, usd: lamportsToUsd(left) },
    ...(second.status >= 400
      ? { warning: `la API cobró (${txHash ?? 'tx sin hash'}) pero respondió ${second.status}` }
      : {}),
  };
}
