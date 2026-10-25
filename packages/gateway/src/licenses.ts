/**
 * Licencias de medios como credenciales verificables (W3C Verifiable Credentials 2.0).
 *
 * Cuando una llamada pagada devuelve un bloque `license` (ver packages/sdk/src/license.ts), el
 * gateway emite una credencial `MediaLicenseCredential`: quién la tiene (la cuenta de Kiba del
 * comprador), sobre qué archivo (SHA-256), con qué términos (forma de RSL 1.0) y cómo se pagó
 * (la llamada y, cuando existe, la transacción en Stellar). La firma es Data Integrity
 * `eddsa-jcs-2022` (Ed25519 sobre JSON canónico, RFC 8785) con la clave del emisor de licencias,
 * publicada como `did:key`. Cualquiera la verifica sin preguntarle a Kiba; `GET /v1/licenses/:id`
 * es pública. La revocación va por una Bitstring Status List (`GET /v1/licenses/status/1`).
 *
 * No es un token: una licencia es una afirmación sobre una persona y un archivo, no un activo
 * transferible. Emitirla no cuesta nada y se verifica sin conexión. El depósito en el vault ACTA
 * del comprador (did:stellar) es una capa aparte (acta.ts), en cola: la credencial vale sin él.
 */
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import type { LicenseGrant, LicenseTerms } from 'kiba-sdk';
import { db } from './db';
import { ASSET, explorerTxUrl } from './chain';
import { lamportsToUsd } from './billing';
import { getPlatformSigner } from './wallets';

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8000').replace(/\/$/, '');
const DASHBOARD_URL = (process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3020').replace(/\/$/, '');
const NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'pubnet' : 'testnet';
const STATUS_LIST_ID = '1';
/** Tamaño mínimo de la lista de estado según la especificación (131 072 bits). */
const STATUS_LIST_BITS = 131_072;

export const CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';
export const CONTEXT_KIBA = `${PUBLIC_URL}/v1/licenses/context/v1`;

// ─── emisor ─────────────────────────────────────────────────────────────

interface IssuerKey {
  publicKey(): string;
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

let issuerKey: IssuerKey | null = null;
/**
 * Clave del emisor de licencias: KIBA_LICENSE_ISSUER_SECRET (S…) si está, o la clave de
 * plataforma. Una cuenta dedicada aísla las licencias de los pagos y es la misma que luego
 * controla el `did:stellar` del emisor en ACTA.
 */
function getIssuerKey(): IssuerKey {
  if (issuerKey) return issuerKey;
  const secret = process.env.KIBA_LICENSE_ISSUER_SECRET;
  if (secret) {
    const kp = Keypair.fromSecret(secret);
    issuerKey = { publicKey: () => kp.publicKey(), sign: (m) => kp.sign(Buffer.from(m)) };
  } else {
    issuerKey = getPlatformSigner();
  }
  return issuerKey;
}

/** `did:key` (Ed25519, multicodec 0xed01, base58btc) de una clave Stellar G…. */
export function didKeyFromStellar(publicKey: string): string {
  const raw = StrKey.decodeEd25519PublicKey(publicKey);
  return `did:key:z${base58btcEncode(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(raw)]))}`;
}

/** Clave Stellar G… a partir de un `did:key` Ed25519 (para verificar). */
export function stellarFromDidKey(did: string): string {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)(#.*)?$/.exec(did);
  if (!m) throw new Error('unsupported DID (expected did:key with base58btc)');
  const bytes = base58btcDecode(m[1]);
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('did:key is not Ed25519');
  return StrKey.encodeEd25519PublicKey(Buffer.from(bytes.subarray(2)));
}

export function issuerDid(): string {
  return didKeyFromStellar(getIssuerKey().publicKey());
}

export function issuerInfo(): { did: string; stellarAddress: string; verificationMethod: string } {
  const did = issuerDid();
  return { did, stellarAddress: getIssuerKey().publicKey(), verificationMethod: `${did}#${did.slice('did:key:'.length)}` };
}

// ─── canonicalización y firma (eddsa-jcs-2022) ────────────────────────────

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

function sha256(data: string | Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58btcEncode(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function base58btcDecode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error('invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(n === 0n ? '' : hex, 'hex');
  let zeros = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    zeros++;
  }
  if (zeros) bytes = Buffer.concat([Buffer.alloc(zeros), bytes]);
  return bytes;
}

type Json = Record<string, unknown>;

/** Firma un documento con Data Integrity `eddsa-jcs-2022`. Devuelve el documento con `proof`. */
export async function signCredential(unsecured: Json, key: IssuerKey = getIssuerKey()): Promise<Json> {
  const { proof: _ignored, ...doc } = unsecured;
  const did = didKeyFromStellar(key.publicKey());
  const proofConfig: Json = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: new Date().toISOString(),
    verificationMethod: `${did}#${did.slice('did:key:'.length)}`,
    proofPurpose: 'assertionMethod',
  };
  const hashData = Buffer.concat([sha256(jcs(proofConfig)), sha256(jcs(doc))]);
  const signature = await key.sign(hashData);
  return { ...doc, proof: { ...proofConfig, proofValue: `z${base58btcEncode(signature)}` } };
}

/** Verifica la firma `eddsa-jcs-2022` de un documento. No consulta estado. */
export function verifySignature(secured: Json): { ok: boolean; issuer?: string; error?: string } {
  try {
    const { proof, ...doc } = secured as Json & { proof?: Json };
    if (!proof || proof.cryptosuite !== 'eddsa-jcs-2022') return { ok: false, error: 'unsupported proof' };
    const { proofValue, ...proofConfig } = proof as Json & { proofValue?: string };
    if (typeof proofValue !== 'string' || !proofValue.startsWith('z')) return { ok: false, error: 'missing proofValue' };
    const vm = String(proofConfig.verificationMethod ?? '');
    const g = stellarFromDidKey(vm.split('#')[0]);
    const issuer = typeof doc.issuer === 'string' ? doc.issuer : (doc.issuer as Json | undefined)?.id;
    if (issuer !== vm.split('#')[0]) return { ok: false, error: 'verificationMethod does not belong to issuer' };
    const hashData = Buffer.concat([sha256(jcs(proofConfig)), sha256(jcs(doc))]);
    const ok = Keypair.fromPublicKey(g).verify(hashData, Buffer.from(base58btcDecode(proofValue.slice(1))));
    return ok ? { ok: true, issuer: String(issuer) } : { ok: false, issuer: String(issuer), error: 'bad signature' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── credencial ─────────────────────────────────────────────────────────

export interface LicenseRow {
  id: string;
  seq: number;
  call_id: string;
  user_id: number;
  service: string;
  publisher: string | null;
  asset_id: string | null;
  asset_sha256: string;
  title: string | null;
  terms: string;
  amount_lamports: number | null;
  tx_hash: string | null;
  vc: string;
  status: 'valid' | 'revoked';
  revoked_at: number | null;
  revoke_reason: string | null;
  acta_vc_id: string | null;
  acta_tx: string | null;
  acta_attempts?: number | null;
  acta_error?: string | null;
  acta_next_at?: number | null;
  created_at: number;
  updated_at: number | null;
}

export function licenseUrl(id: string): string {
  return `${PUBLIC_URL}/v1/licenses/${id}`;
}

function statusListUrl(): string {
  return `${PUBLIC_URL}/v1/licenses/status/${STATUS_LIST_ID}`;
}

function txHashFromExplorerUrl(url: string | null | undefined): string | undefined {
  const m = url ? /\/tx\/([a-f0-9]{64})/i.exec(url) : null;
  return m ? m[1].toLowerCase() : undefined;
}

/** Cuerpo (sin firma) de la credencial de una licencia. */
function buildCredential(a: {
  id: string;
  seq: number;
  userId: number;
  holderAddress?: string | null;
  callId: string;
  service: string;
  publisher?: string | null;
  grant: LicenseGrant;
  amountLamports?: number | null;
  txHash?: string | null;
  issuedAt: string;
}): Json {
  const did = issuerDid();
  const receipt: Json = {
    type: ['KibaPaymentReceipt'],
    id: `${licenseUrl(a.id)}/receipt`,
    callId: a.callId,
    network: `stellar:${NETWORK}`,
    asset: ASSET,
    ...(a.amountLamports != null
      ? { amountBaseUnits: String(a.amountLamports), amountUsd: Number(lamportsToUsd(a.amountLamports).toFixed(6)) }
      : {}),
    ...(a.txHash ? { txHash: a.txHash, explorerUrl: explorerTxUrl(a.txHash) } : {}),
  };
  const { terms, ...asset } = a.grant;
  return {
    '@context': [CONTEXT_V2, CONTEXT_KIBA],
    id: licenseUrl(a.id),
    type: ['VerifiableCredential', 'MediaLicenseCredential'],
    issuer: { id: did, name: 'Kiba', url: 'https://kiba.tools' },
    validFrom: a.issuedAt,
    credentialSubject: {
      // Un DID cuando el comprador tiene cuenta Stellar (did:key de su clave; ACTA exige un DID);
      // si no, su cuenta de Kiba.
      id: holderDid(a.holderAddress) ?? `urn:kiba:user:${a.userId}`,
      kibaAccount: `urn:kiba:user:${a.userId}`,
      ...(a.holderAddress ? { holderAccount: `stellar:${NETWORK}:${a.holderAddress}` } : {}),
      license: {
        service: a.service,
        ...(a.publisher ? { publisher: a.publisher } : {}),
        ...asset,
        terms: terms ?? {},
      },
    },
    evidence: [receipt],
    credentialStatus: {
      id: `${statusListUrl()}#${a.seq}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: String(a.seq),
      statusListCredential: statusListUrl(),
    },
  };
}

function holderDid(address: string | null | undefined): string | null {
  if (!address || !StrKey.isValidEd25519PublicKey(address)) return null;
  return didKeyFromStellar(address);
}

function grantOf(result: unknown): LicenseGrant | null {
  if (typeof result !== 'object' || result === null) return null;
  const g = (result as { license?: unknown }).license;
  if (typeof g !== 'object' || g === null) return null;
  const sha = (g as { assetSha256?: unknown }).assetSha256;
  if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) return null;
  return { ...(g as LicenseGrant), assetSha256: sha.toLowerCase() };
}

async function holderAddress(userId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT stellar_address, custodial_wallet_pubkey FROM users WHERE id = ?')
    .get<{ stellar_address: string | null; custodial_wallet_pubkey: string | null }>(userId);
  const a = row?.stellar_address || row?.custodial_wallet_pubkey || null;
  return a && StrKey.isValidEd25519PublicKey(a) ? a : null;
}

/**
 * Emite la credencial de una llamada cuyo resultado trae `license`. Idempotente por llamada.
 * Nunca lanza: una licencia que no se pudo emitir se registra y la llamada sigue siendo válida.
 */
export async function issueLicenseForCall(a: {
  callId: string;
  userId: number;
  service: string;
  result: unknown;
  costLamports?: number | null;
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
    const issuedAt = new Date(now * 1000).toISOString();
    const txHash = txHashFromExplorerUrl(a.explorerUrl);
    // Reserva la fila (y su `seq`) antes de firmar: el índice de estado va dentro de la credencial.
    const inserted = await db
      .prepare(
        `INSERT INTO licenses (id, call_id, user_id, service, publisher, asset_id, asset_sha256, title, terms,
           amount_lamports, tx_hash, vc, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'valid', ?) RETURNING seq`,
      )
      .get<{ seq: number }>(
        id,
        a.callId,
        a.userId,
        a.service,
        a.publisher ?? null,
        grant.assetId ?? null,
        grant.assetSha256,
        grant.title ?? null,
        JSON.stringify(grant.terms ?? {}),
        a.costLamports ?? null,
        txHash ?? null,
        now,
      );
    const seq = Number(inserted?.seq ?? 0);
    const vc = await signCredential(
      buildCredential({
        id,
        seq,
        userId: a.userId,
        holderAddress: await holderAddress(a.userId),
        callId: a.callId,
        service: a.service,
        publisher: a.publisher,
        grant,
        amountLamports: a.costLamports,
        txHash,
        issuedAt,
      }),
    );
    await db.prepare('UPDATE licenses SET vc = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(vc), now, id);
    console.log(`[licenses] emitida ${id} para ${a.callId} (${a.service}, sha256 ${grant.assetSha256.slice(0, 12)}…)`);
    return (await getLicense(id)) ?? null;
  } catch (err) {
    console.log(`[licenses] no se pudo emitir la licencia de ${a.callId}:`, (err as Error).message);
    return null;
  }
}

/**
 * El enlace on-chain del pago llega después de la respuesta (modo crédito). Al llegar, la
 * credencial se vuelve a firmar con la transacción como evidencia. El id y `validFrom` no cambian.
 */
export async function attachSettlement(callId: string, explorerUrl: string): Promise<void> {
  try {
    const row = await licenseForCall(callId);
    const txHash = txHashFromExplorerUrl(explorerUrl);
    if (!row || !txHash || row.tx_hash === txHash) return;
    const vc = JSON.parse(row.vc) as Json;
    const subject = vc.credentialSubject as Json | undefined;
    const license = (subject?.license ?? {}) as LicenseGrant & { service?: string; publisher?: string };
    const { service: _s, publisher: _p, ...grant } = license;
    const resigned = await signCredential(
      buildCredential({
        id: row.id,
        seq: row.seq,
        userId: row.user_id,
        holderAddress: await holderAddress(row.user_id),
        callId,
        service: row.service,
        publisher: row.publisher,
        grant: grant as LicenseGrant,
        amountLamports: row.amount_lamports,
        txHash,
        issuedAt: String(vc.validFrom),
      }),
    );
    await db
      .prepare('UPDATE licenses SET tx_hash = ?, vc = ?, updated_at = ? WHERE id = ?')
      .run(txHash, JSON.stringify(resigned), Math.floor(Date.now() / 1000), row.id);
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

/** Resumen para la API y el conector (sin la credencial entera). */
export function licenseDto(row: LicenseRow): Record<string, unknown> {
  const terms = JSON.parse(row.terms) as LicenseTerms;
  return {
    id: row.id,
    status: row.status,
    service: row.service,
    publisher: row.publisher ?? undefined,
    assetId: row.asset_id ?? undefined,
    assetSha256: row.asset_sha256,
    title: row.title ?? undefined,
    terms,
    issuer: issuerInfo(),
    txHash: row.tx_hash ?? undefined,
    explorerUrl: row.tx_hash ? explorerTxUrl(row.tx_hash) : undefined,
    credentialUrl: licenseUrl(row.id),
    verifyUrl: `${licenseUrl(row.id)}/verify`,
    certificateUrl: `${licenseUrl(row.id)}/certificate`,
    dashboardUrl: `${DASHBOARD_URL}/verify/${row.id}`,
    actaVcId: row.acta_vc_id ?? undefined,
    actaTx: row.acta_tx ?? undefined,
    actaExplorerUrl: row.acta_tx && /^[a-f0-9]{64}$/i.test(row.acta_tx) ? explorerTxUrl(row.acta_tx) : undefined,
    issuedAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

/** Verificación completa: firma + estado. Es lo que corre `GET /v1/licenses/:id/verify`. */
export async function verifyLicense(row: LicenseRow): Promise<Record<string, unknown>> {
  const vc = JSON.parse(row.vc) as Json;
  const sig = verifySignature(vc);
  const checks = {
    signature: sig.ok,
    issuerIsKiba: sig.issuer === issuerDid(),
    notRevoked: row.status === 'valid',
    paymentAnchored: !!row.tx_hash,
  };
  return {
    verified: checks.signature && checks.issuerIsKiba && checks.notRevoked,
    checks,
    status: row.status,
    issuer: sig.issuer,
    ...(sig.error ? { error: sig.error } : {}),
    assetSha256: row.asset_sha256,
    txHash: row.tx_hash ?? undefined,
    explorerUrl: row.tx_hash ? explorerTxUrl(row.tx_hash) : undefined,
  };
}

/** Credencial de la lista de estado (Bitstring Status List): bit `seq` a 1 = revocada. */
export async function statusListCredential(): Promise<Json> {
  const revoked = await db.prepare(`SELECT seq FROM licenses WHERE status = 'revoked'`).all<{ seq: number }>();
  const maxSeq = Math.max(STATUS_LIST_BITS, ...revoked.map((r) => Number(r.seq) + 1));
  const bits = Buffer.alloc(Math.ceil(maxSeq / 8));
  for (const r of revoked) {
    const i = Number(r.seq);
    bits[i >> 3] |= 0x80 >> (i & 7); // orden de bits de la especificación: el bit 0 es el más alto
  }
  const encodedList = `u${gzipSync(bits).toString('base64url')}`;
  return signCredential({
    '@context': [CONTEXT_V2],
    id: statusListUrl(),
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: issuerDid(),
    validFrom: new Date().toISOString(),
    credentialSubject: {
      id: `${statusListUrl()}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList,
    },
  });
}

/** Contexto JSON-LD de los términos propios de Kiba (sirve `GET /v1/licenses/context/v1`). */
export function kibaContext(): Json {
  const ns = 'https://kiba.tools/credentials#';
  const t = (name: string) => ({ '@id': `${ns}${name}` });
  return {
    '@context': {
      '@protected': true,
      MediaLicenseCredential: `${ns}MediaLicenseCredential`,
      KibaPaymentReceipt: `${ns}KibaPaymentReceipt`,
      holderAccount: t('holderAccount'),
      license: { '@id': `${ns}license`, '@type': '@json' },
      callId: t('callId'),
      network: t('network'),
      asset: t('asset'),
      amountBaseUnits: t('amountBaseUnits'),
      amountUsd: t('amountUsd'),
      txHash: t('txHash'),
      explorerUrl: { '@id': `${ns}explorerUrl`, '@type': '@id' },
    },
  };
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Certificado legible (HTML imprimible → PDF desde el navegador). Público: no lleva datos personales. */
export function certificateHtml(row: LicenseRow): string {
  const terms = JSON.parse(row.terms) as LicenseTerms;
  const vc = JSON.parse(row.vc) as Json;
  const subject = vc.credentialSubject as Json;
  const lic = (subject.license ?? {}) as Record<string, unknown>;
  const issuer = issuerInfo();
  const yesNo = (v: unknown) => (v ? 'yes' : 'no');
  const rows: [string, string][] = [
    ['License ID', row.id],
    ['Status', row.status === 'valid' ? 'Valid' : `Revoked${row.revoke_reason ? ` (${row.revoke_reason})` : ''}`],
    ['Issued', new Date(row.created_at * 1000).toUTCString()],
    ['Licensee', String(subject.id ?? '')],
    ['Service / publisher', `${row.service}${row.publisher ? ` · ${row.publisher}` : ''}`],
    ['Asset', `${String(lic.title ?? lic.filename ?? row.asset_id ?? '')}${lic.mimeType ? ` (${String(lic.mimeType)}${lic.bytes ? `, ${String(lic.bytes)} bytes` : ''})` : ''}`],
    ['Asset SHA-256', row.asset_sha256],
    ['Template', String(terms.name ?? 'commercial')],
    ['Permitted users', (terms.user ?? []).join(', ')],
    ['Permitted usage', (terms.usage ?? []).join(', ')],
    ['Territory', (terms.geo ?? ['*']).join(', ').replace('*', 'worldwide')],
    ['Duration', String(terms.duration ?? 'perpetual')],
    ['Attribution required', yesNo(terms.attribution)],
    ['Exclusive', yesNo(terms.exclusive)],
    ['Transferable', yesNo(terms.transferable)],
    ...(terms.notes ? ([['Notes', String(terms.notes)]] as [string, string][]) : []),
    ...(terms.termsUrl ? ([['Full terms', String(terms.termsUrl)]] as [string, string][]) : []),
    ['Payment', row.tx_hash ? `Stellar ${NETWORK} · ${row.tx_hash}` : `Kiba call ${row.call_id} (on-chain settlement pending)`],
    ['Issuer', `Kiba · ${issuer.did} · Stellar ${issuer.stellarAddress}`],
    ['Verify', `${licenseUrl(row.id)}/verify`],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kiba license ${esc(row.id)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:14px/1.5 system-ui,sans-serif;margin:40px auto;max-width:760px;color:#111;padding:0 16px}h1{font-size:22px;margin:0 0 4px}p.sub{color:#555;margin:0 0 24px}table{border-collapse:collapse;width:100%}td{padding:8px 10px;border-top:1px solid #e5e5e5;vertical-align:top;word-break:break-all}td:first-child{color:#555;white-space:nowrap;width:180px}.ok{color:#0a7d2c;font-weight:600}.bad{color:#b00020;font-weight:600}footer{margin-top:28px;color:#555;font-size:12px}@media print{a{color:inherit;text-decoration:none}}</style></head>
<body><h1>Media license certificate</h1><p class="sub">Issued by Kiba as a W3C Verifiable Credential. The machine-readable credential is at <a href="${esc(licenseUrl(row.id))}">${esc(licenseUrl(row.id))}</a>.</p>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="${k === 'Status' ? (row.status === 'valid' ? 'ok' : 'bad') : ''}">${esc(v)}</td></tr>`).join('')}</table>
<footer>The licensee is identified by a Kiba account identifier, not by name. Anyone can verify this certificate: fetch the credential, check its Ed25519 signature against the issuer's did:key, check the status list, and open the Stellar transaction. Credential status: <a href="${esc(statusListUrl())}">${esc(statusListUrl())}</a>.</footer>
</body></html>`;
}
