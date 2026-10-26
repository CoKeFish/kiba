/**
 * Licencias de medios: un documento por archivo comprado, anclado al pago en Stellar.
 *
 * Cuando una llamada pagada devuelve un bloque `license` (ver packages/sdk/src/license.ts), el
 * gateway escribe un documento de licencia en JSON plano: comprador (cuenta de Kiba), vendedor
 * (servicio y wallet que cobra), archivo (SHA-256), términos y precio. Su huella es el SHA-256
 * del JSON canónico (RFC 8785). El pago por llamada con el contrato de Kiba lleva los primeros
 * 8 bytes de esa huella en el argumento `reference` (u64) de `pay`: una transacción de Soroban
 * no admite memo y el contrato desplegado no tiene un campo de 32 bytes. Verificar = recomputar
 * la huella del documento y leer el `reference` de la transacción en la cadena.
 *
 * Sin firma de Kiba, sin credencial, sin certificado: la transacción es la prueba y el documento
 * es lo que prueba. `GET /v1/licenses/:id` sirve el documento a cualquiera. Un reembolso marca
 * la licencia como revocada en Kiba (la transacción no cambia).
 */
import { createHash, randomBytes } from 'node:crypto';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { LicenseGrant, LicenseTerms } from 'kiba-sdk';
import { db } from './db';
import { ASSET, explorerTxUrl } from './chain';
import { lamportsToUsd } from './billing';

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8000').replace(/\/$/, '');
const DASHBOARD_URL = (process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3020').replace(/\/$/, '');
const NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'pubnet' : 'testnet';
const RPC_URL =
  process.env.STELLAR_RPC_URL ||
  (NETWORK === 'pubnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');

export const LICENSE_KIND = 'kiba-license/1';

// ─── canonicalización y huella ──────────────────────────────────────────

/** JSON Canonicalization Scheme (RFC 8785): claves ordenadas, sin espacios, números como JSON. */
export function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => jcs(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`).join(',')}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Huella que viaja en el pago: los primeros 8 bytes del SHA-256 del documento, como u64 big-endian. */
export function referenceOf(docSha256: string): bigint {
  return BigInt(`0x${docSha256.slice(0, 16)}`);
}

export function referenceMatches(docSha256: string, reference: bigint | undefined): boolean {
  return reference !== undefined && reference === referenceOf(docSha256);
}

// ─── documento ──────────────────────────────────────────────────────────

/** El documento de licencia: lo que la transacción de pago prueba. */
export interface LicenseDocument {
  kind: typeof LICENSE_KIND;
  id: string;
  issuedAt: string;
  buyer: { account: string; stellarAddress?: string };
  seller: { service: string; payTo?: string; publisher?: string };
  asset: { sha256: string; assetId?: string; title?: string; filename?: string; mimeType?: string; bytes?: number };
  terms: LicenseTerms;
  attributionText?: string;
  price: { amountBaseUnits: string; amountUsd: number; token: string; network: string };
  callId: string;
}

export interface LicenseRow {
  id: string;
  call_id: string;
  user_id: number;
  service: string;
  pay_to: string | null;
  publisher: string | null;
  asset_id: string | null;
  asset_sha256: string;
  title: string | null;
  terms: string;
  amount_lamports: number | null;
  tx_hash: string | null;
  /** El documento en JSON canónico (los bytes exactos cuya huella es doc_sha256). */
  doc: string;
  doc_sha256: string;
  status: 'valid' | 'revoked';
  revoked_at: number | null;
  revoke_reason: string | null;
  /** Resultado de la última lectura de la transacción (null = no comprobada todavía). */
  anchor_ok: boolean | null;
  anchor_checked_at: number | null;
  created_at: number;
  updated_at: number | null;
}

export function licenseUrl(id: string): string {
  return `${PUBLIC_URL}/v1/licenses/${id}`;
}

function txHashFromExplorerUrl(url: string | null | undefined): string | undefined {
  const m = url ? /\/tx\/([a-f0-9]{64})/i.exec(url) : null;
  return m ? m[1].toLowerCase() : undefined;
}

function grantOf(result: unknown): LicenseGrant | null {
  if (typeof result !== 'object' || result === null) return null;
  const g = (result as { license?: unknown }).license;
  if (typeof g !== 'object' || g === null) return null;
  const sha = (g as { assetSha256?: unknown }).assetSha256;
  if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) return null;
  return { ...(g as LicenseGrant), assetSha256: sha.toLowerCase() };
}

async function buyerAddress(userId: number): Promise<string | undefined> {
  const row = await db
    .prepare('SELECT stellar_address, spend_address FROM users WHERE id = ?')
    .get<{ stellar_address: string | null; spend_address: string | null }>(userId);
  return row?.spend_address || row?.stellar_address || undefined;
}

function buildDocument(a: {
  id: string;
  issuedAt: string;
  userId: number;
  buyerAddress?: string;
  callId: string;
  service: string;
  payTo?: string | null;
  publisher?: string | null;
  grant: LicenseGrant;
  amountLamports: number | null;
}): LicenseDocument {
  const { terms, attributionText, assetUrl: _url, assetSha256, ...asset } = a.grant;
  const lamports = a.amountLamports ?? 0;
  return {
    kind: LICENSE_KIND,
    id: a.id,
    issuedAt: a.issuedAt,
    buyer: { account: `urn:kiba:user:${a.userId}`, ...(a.buyerAddress ? { stellarAddress: a.buyerAddress } : {}) },
    seller: {
      service: a.service,
      ...(a.payTo ? { payTo: a.payTo } : {}),
      ...(a.publisher ? { publisher: a.publisher } : {}),
    },
    asset: { sha256: assetSha256, ...asset },
    terms: terms ?? {},
    ...(attributionText ? { attributionText } : {}),
    price: {
      amountBaseUnits: String(lamports),
      amountUsd: Number(lamportsToUsd(lamports).toFixed(6)),
      token: ASSET,
      network: `stellar:${NETWORK}`,
    },
    callId: a.callId,
  };
}

/**
 * Escribe el documento de licencia de una llamada cuyo resultado trae `license`. Idempotente por
 * llamada. Se llama ANTES de enviar el pago por llamada (su huella viaja en el pago) y, por si
 * la llamada no pasó por ahí, otra vez al guardar el resultado. Nunca lanza: una licencia que no
 * se pudo escribir se registra y la llamada sigue siendo válida.
 */
export async function issueLicenseForCall(a: {
  callId: string;
  userId: number;
  service: string;
  result: unknown;
  costLamports?: number | null;
  payTo?: string | null;
  explorerUrl?: string | null;
  publisher?: string | null;
}): Promise<LicenseRow | null> {
  try {
    const grant = grantOf(a.result);
    if (!grant) return null;
    const existing = await licenseForCall(a.callId);
    if (existing) return existing;

    const id = `lic_${randomBytes(10).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const doc = buildDocument({
      id,
      issuedAt: new Date(now * 1000).toISOString(),
      userId: a.userId,
      buyerAddress: await buyerAddress(a.userId),
      callId: a.callId,
      service: a.service,
      payTo: a.payTo,
      publisher: a.publisher,
      grant,
      amountLamports: a.costLamports ?? null,
    });
    const canonical = jcs(doc);
    const docSha256 = sha256Hex(canonical);
    await db
      .prepare(
        `INSERT INTO licenses (id, call_id, user_id, service, pay_to, publisher, asset_id, asset_sha256, title, terms,
           amount_lamports, tx_hash, doc, doc_sha256, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?)`,
      )
      .run(
        id,
        a.callId,
        a.userId,
        a.service,
        a.payTo ?? null,
        a.publisher ?? null,
        grant.assetId ?? null,
        grant.assetSha256,
        grant.title ?? null,
        JSON.stringify(grant.terms ?? {}),
        a.costLamports ?? null,
        txHashFromExplorerUrl(a.explorerUrl) ?? null,
        canonical,
        docSha256,
        now,
      );
    console.log(`[licenses] ${id} para ${a.callId} (${a.service}, huella ${docSha256.slice(0, 16)})`);
    return (await getLicense(id)) ?? null;
  } catch (err) {
    console.log(`[licenses] no se pudo escribir la licencia de ${a.callId}:`, (err as Error).message);
    return null;
  }
}

/** El enlace on-chain del pago llega después de la respuesta (modo crédito): se guarda el hash. */
export async function attachSettlement(callId: string, explorerUrl: string): Promise<void> {
  try {
    const txHash = txHashFromExplorerUrl(explorerUrl);
    if (!txHash) return;
    await db
      .prepare(
        `UPDATE licenses SET tx_hash = ?, anchor_ok = NULL, anchor_checked_at = NULL, updated_at = ?
         WHERE call_id = ? AND (tx_hash IS NULL OR tx_hash <> ?)`,
      )
      .run(txHash, Math.floor(Date.now() / 1000), callId, txHash);
  } catch (err) {
    console.log(`[licenses] no se pudo anclar el pago de ${callId}:`, (err as Error).message);
  }
}

export async function getLicense(id: string): Promise<LicenseRow | null> {
  return (await db.prepare('SELECT * FROM licenses WHERE id = ?').get<LicenseRow>(id)) ?? null;
}

export async function licenseForCall(callId: string): Promise<LicenseRow | null> {
  return (await db.prepare('SELECT * FROM licenses WHERE call_id = ?').get<LicenseRow>(callId)) ?? null;
}

export async function listLicenses(userId: number, limit = 50): Promise<LicenseRow[]> {
  return db
    .prepare('SELECT * FROM licenses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all<LicenseRow>(userId, Math.min(Math.max(limit, 1), 200));
}

export async function revokeLicense(id: string, reason: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const r = await db
    .prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ?, revoke_reason = ?, updated_at = ? WHERE id = ? AND status = 'valid'`)
    .run(now, reason, now, id);
  return (r as { changes?: number }).changes !== 0;
}

/** Resumen para la API, el conector y el dashboard. */
export function licenseDto(row: LicenseRow): Record<string, unknown> {
  const terms = JSON.parse(row.terms) as LicenseTerms;
  return {
    id: row.id,
    status: row.status,
    service: row.service,
    payTo: row.pay_to ?? undefined,
    publisher: row.publisher ?? undefined,
    assetId: row.asset_id ?? undefined,
    assetSha256: row.asset_sha256,
    title: row.title ?? undefined,
    terms,
    documentUrl: `${licenseUrl(row.id)}/document`,
    documentSha256: row.doc_sha256,
    reference: referenceOf(row.doc_sha256).toString(),
    txHash: row.tx_hash ?? undefined,
    explorerUrl: row.tx_hash ? explorerTxUrl(row.tx_hash) : undefined,
    verifyUrl: `${licenseUrl(row.id)}/verify`,
    dashboardUrl: `${DASHBOARD_URL}/verify/${row.id}`,
    issuedAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

// ─── verificación ───────────────────────────────────────────────────────

/** Lo que se lee de la transacción de pago en la cadena. */
export interface PaymentTx {
  found: boolean;
  /** Argumentos de `pay(from, to, amount, reference)`, cuando la tx es una invocación de `pay`. */
  to?: string;
  amount?: bigint;
  reference?: bigint;
  error?: string;
}

export type PaymentReader = (txHash: string) => Promise<PaymentTx>;

/** Lee la transacción por RPC y saca los argumentos de `pay` del sobre (sin confiar en Kiba). */
export async function readPaymentTx(txHash: string, rpcUrl = RPC_URL): Promise<PaymentTx> {
  try {
    const server = new rpc.Server(rpcUrl);
    const r = await server.getTransaction(txHash);
    if (r.status !== rpc.Api.GetTransactionStatus.SUCCESS) return { found: false };
    const env = r.envelopeXdr;
    const tx =
      env.switch().value === xdr.EnvelopeType.envelopeTypeTxFeeBump().value
        ? env.feeBump().tx().innerTx().v1().tx()
        : env.v1().tx();
    const body = tx.operations()[0]?.body();
    if (!body || body.switch().value !== xdr.OperationType.invokeHostFunction().value) return { found: true };
    const fn = body.invokeHostFunctionOp().hostFunction();
    if (fn.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) return { found: true };
    const call = fn.invokeContract();
    const args = call.args();
    if (call.functionName().toString() !== 'pay' || args.length < 4) return { found: true };
    return {
      found: true,
      to: String(scValToNative(args[1])),
      amount: BigInt(scValToNative(args[2])),
      reference: BigInt(scValToNative(args[3])),
    };
  } catch (err) {
    return { found: false, error: (err as Error).message };
  }
}

/**
 * Verificación completa (`GET /v1/licenses/:id/verify`): el documento servido tiene la huella
 * registrada, el pago existe en la cadena y lleva esa huella, y la licencia no está revocada.
 * La lectura de la cadena se guarda una vez que confirma (anchor_ok).
 */
export async function verifyLicense(row: LicenseRow, readTx: PaymentReader = readPaymentTx): Promise<Record<string, unknown>> {
  let document = false;
  try {
    document = sha256Hex(row.doc) === row.doc_sha256 && sha256Hex(jcs(JSON.parse(row.doc))) === row.doc_sha256;
  } catch {
    document = false;
  }
  let paymentFound = false;
  let paymentCommits = false;
  let error: string | undefined;
  if (row.tx_hash) {
    if (row.anchor_ok === true) {
      paymentFound = true;
      paymentCommits = true;
    } else {
      const tx = await readTx(row.tx_hash);
      paymentFound = tx.found;
      paymentCommits = tx.found && referenceMatches(row.doc_sha256, tx.reference);
      error = tx.error;
      if (tx.found) {
        await db
          .prepare('UPDATE licenses SET anchor_ok = ?, anchor_checked_at = ? WHERE id = ?')
          .run(paymentCommits, Math.floor(Date.now() / 1000), row.id)
          .catch(() => {});
      }
    }
  }
  const notRevoked = row.status === 'valid';
  return {
    verified: document && notRevoked && paymentCommits,
    pending: !row.tx_hash,
    checks: { document, paymentFound, paymentCommits, notRevoked },
    status: row.status,
    documentSha256: row.doc_sha256,
    reference: referenceOf(row.doc_sha256).toString(),
    assetSha256: row.asset_sha256,
    txHash: row.tx_hash ?? undefined,
    explorerUrl: row.tx_hash ? explorerTxUrl(row.tx_hash) : undefined,
    ...(error ? { error } : {}),
  };
}
