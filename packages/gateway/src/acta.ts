/**
 * Depósito de las licencias en ACTA (acta.build): credenciales verificables en vaults de Soroban.
 *
 * La credencial de Kiba (licenses.ts) vale por sí sola. Esta capa, opcional, la deposita además en
 * el vault ACTA del comprador, para que viva en infraestructura del ecosistema Stellar, con estado
 * on-chain y verificable con el visor de ACTA o cualquier resolver de did:stellar. Corre en cola
 * con reintentos: si ACTA no responde, la licencia sigue siendo válida y se reintenta después.
 *
 * Flujo (API REST de ACTA, todo en dos pasos prepare → firma local → submit; ACTA nunca firma):
 *   1. Emisor: un `did:stellar` controlado por la cuenta de licencias de Kiba (se registra una vez
 *      en did.acta.build y se guarda en `issuer_identities`).
 *   2. Comprador: un vault patrocinado por Kiba (`/contracts/sponsored-vault/create`), con su
 *      `did:key` como DID del titular (sin transacción para el usuario). Se guarda en `acta_vaults`.
 *   3. Credencial: `/contracts/vc/issue` con la VC firmada por Kiba como `vcData`. La tasa on-chain
 *      la paga el emisor (5 XLM por credencial en testnet; 1 USDC en mainnet).
 *
 * Se activa con ACTA_API_KEY (clave de dapp.acta.build, una por red) y ACTA_SIGNER_SECRET (o
 * KIBA_LICENSE_ISSUER_SECRET): la cuenta Stellar que firma, paga y controla el did:stellar.
 */
import { randomBytes } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { db } from './db';
import { didKeyFromStellar, getLicense, type LicenseRow } from './licenses';

const NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
const DEFAULT_API = NETWORK === 'mainnet' ? 'https://production-api.acta.build' : 'https://sandbox-api.acta.build';
const MAX_ATTEMPTS = 12;
const WORKER_INTERVAL_MS = Number(process.env.ACTA_WORKER_INTERVAL_MS) || 30_000;

export interface ActaConfig {
  apiKey: string;
  apiUrl: string;
  didApiUrl: string;
  signer: Keypair;
  network: 'mainnet' | 'testnet';
}

export function actaConfigFromEnv(): ActaConfig | null {
  const apiKey = process.env.ACTA_API_KEY;
  const secret = process.env.ACTA_SIGNER_SECRET || process.env.KIBA_LICENSE_ISSUER_SECRET;
  if (!apiKey || !secret) return null;
  return {
    apiKey,
    apiUrl: (process.env.ACTA_API_URL || DEFAULT_API).replace(/\/$/, ''),
    didApiUrl: (process.env.ACTA_DID_API_URL || 'https://did.acta.build').replace(/\/$/, ''),
    signer: Keypair.fromSecret(secret),
    network: NETWORK,
  };
}

export function actaEnabled(): boolean {
  return actaConfigFromEnv() !== null;
}

interface PrepareResponse {
  xdr: string;
  network?: string;
  networkPassphrase?: string;
}
interface SubmitResponse {
  tx_id?: string;
  txId?: string;
  txHash?: string;
}

export class ActaClient {
  private readonly http: AxiosInstance;
  private readonly didHttp: AxiosInstance;
  private passphrase?: string;

  constructor(readonly cfg: ActaConfig) {
    this.http = axios.create({
      baseURL: cfg.apiUrl,
      timeout: 60_000,
      headers: { 'X-ACTA-Key': cfg.apiKey, 'content-type': 'application/json' },
      validateStatus: () => true,
    });
    this.didHttp = axios.create({ baseURL: cfg.didApiUrl, timeout: 60_000, validateStatus: () => true });
  }

  get address(): string {
    return this.cfg.signer.publicKey();
  }

  private async networkPassphrase(): Promise<string> {
    if (this.passphrase) return this.passphrase;
    const r = await this.http.get('/config');
    const p = (r.data as { networkPassphrase?: string })?.networkPassphrase;
    this.passphrase =
      p ??
      (this.cfg.network === 'mainnet'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015');
    return this.passphrase;
  }

  /** Firma un XDR devuelto por un prepare con la cuenta de Kiba. */
  async signXdr(xdr: string, passphrase?: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(xdr, passphrase ?? (await this.networkPassphrase()));
    tx.sign(this.cfg.signer);
    return tx.toXDR();
  }

  /** prepare → firma → submit contra un endpoint de la API de ACTA. Devuelve el id de la transacción. */
  async write(path: string, body: Record<string, unknown>): Promise<string> {
    const prep = await this.http.post(path, body);
    if (prep.status >= 300) throw new ActaError(path, prep.status, prep.data);
    const p = prep.data as PrepareResponse;
    if (!p?.xdr) throw new ActaError(path, prep.status, prep.data, 'prepare sin xdr');
    const signedXdr = await this.signXdr(p.xdr, p.networkPassphrase);
    const sub = await this.http.post(path, { signedXdr });
    if (sub.status >= 300) throw new ActaError(path, sub.status, sub.data, 'submit');
    const s = sub.data as SubmitResponse;
    return s.tx_id ?? s.txId ?? s.txHash ?? '';
  }

  /** Registra un did:stellar nuevo controlado por la cuenta de Kiba (did.acta.build). */
  async registerIssuerDid(): Promise<{ did: string; txId: string }> {
    const did = `did:stellar:${this.cfg.network}:${base32Lower(randomBytes(16))}`;
    const key = { publicKeyMultibase: didKeyFromStellar(this.address).slice('did:key:'.length) };
    const body = {
      did,
      sourcePublicKey: this.address,
      record: { controller: this.address, authentication: [key], assertionMethod: [key], keyAgreement: [], services: [] },
    };
    const prep = await this.didHttp.post('/v1/dids/stellar', body);
    if (prep.status >= 300) throw new ActaError('/v1/dids/stellar', prep.status, prep.data);
    const p = prep.data as PrepareResponse;
    if (!p?.xdr) throw new ActaError('/v1/dids/stellar', prep.status, prep.data, 'prepare sin xdr');
    const signedXdr = await this.signXdr(p.xdr, p.networkPassphrase);
    const sub = await this.didHttp.post('/v1/dids/stellar/submit', { signedXdr });
    if (sub.status >= 300) throw new ActaError('/v1/dids/stellar/submit', sub.status, sub.data, 'submit');
    const s = sub.data as SubmitResponse;
    return { did, txId: s.txId ?? s.tx_id ?? '' };
  }

  async sponsoredVaultCreate(owner: string, didUri: string): Promise<string> {
    try {
      return await this.write('/contracts/sponsored-vault/create', {
        sponsor: this.address,
        owner,
        didUri,
        sourcePublicKey: this.address,
      });
    } catch (err) {
      // Un vault que ya existe no es un error: el comprador ya tenía el suyo.
      if (err instanceof ActaError && /already (deployed|exists)/i.test(JSON.stringify(err.body ?? ''))) return 'existing';
      throw err;
    }
  }

  async issue(owner: string, vcId: string, vcData: unknown, issuerDid: string): Promise<string> {
    return this.write('/contracts/vc/issue', {
      owner,
      vcId,
      vcData,
      issuer: issuerDid,
      issuerDid,
      sourcePublicKey: this.address,
    });
  }

  async verify(owner: string, vcId: string): Promise<unknown> {
    const r = await this.http.post('/contracts/vault/verify-vc', { owner, vcId });
    if (r.status >= 300) throw new ActaError('/contracts/vault/verify-vc', r.status, r.data);
    return r.data;
  }
}

export class ActaError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
    stage = 'request',
  ) {
    super(`ACTA ${stage} ${path} → ${status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body ?? '').slice(0, 200)}`);
  }
}

function base32Lower(bytes: Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

// ─── identidad del emisor y vaults (persistidos) ────────────────────────────

export async function ensureIssuerDid(client: ActaClient): Promise<string> {
  const row = await db
    .prepare('SELECT did FROM issuer_identities WHERE controller = ? AND network = ?')
    .get<{ did: string }>(client.address, client.cfg.network);
  if (row?.did) return row.did;
  const { did, txId } = await client.registerIssuerDid();
  await db
    .prepare('INSERT INTO issuer_identities (controller, network, did, tx_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(client.address, client.cfg.network, did, txId || null, Math.floor(Date.now() / 1000));
  console.log(`[acta] did:stellar del emisor registrado: ${did} (${txId})`);
  return did;
}

export async function ensureHolderVault(client: ActaClient, userId: number, owner: string, didUri: string): Promise<void> {
  const row = await db
    .prepare('SELECT owner FROM acta_vaults WHERE user_id = ? AND network = ?')
    .get<{ owner: string }>(userId, client.cfg.network);
  if (row) return;
  const txId = await client.sponsoredVaultCreate(owner, didUri);
  await db
    .prepare('INSERT INTO acta_vaults (user_id, network, owner, did_uri, vault_tx, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, client.cfg.network, owner, didUri, txId || null, Math.floor(Date.now() / 1000));
}

/** Dirección Stellar del comprador: su wallet de pagos o, si no la activó, la custodial. */
async function holderAddress(userId: number): Promise<string | null> {
  const u = await db
    .prepare('SELECT stellar_address, custodial_wallet_pubkey FROM users WHERE id = ?')
    .get<{ stellar_address: string | null; custodial_wallet_pubkey: string | null }>(userId);
  const a = u?.stellar_address || u?.custodial_wallet_pubkey || null;
  return a && StrKey.isValidEd25519PublicKey(a) ? a : null;
}

/**
 * Los depósitos van de uno en uno en este proceso: el intento inmediato (depositSoon) y el worker
 * pueden tomar la misma licencia a la vez, y cada `vc/issue` cuesta una tasa on-chain. En serie,
 * el segundo relee la fila y ve que ya está depositada. También evita registrar dos did:stellar
 * del emisor o crear dos veces el vault de un comprador.
 */
let actaChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = actaChain.then(fn, fn);
  actaChain = run.catch(() => undefined);
  return run;
}

/**
 * Deposita UNA licencia en ACTA. Devuelve el estado final; guarda tx/errores en la fila.
 * Nunca lanza: los fallos quedan en `acta_error` con reintento programado.
 */
export function depositLicense(client: ActaClient, row: LicenseRow): Promise<'done' | 'skipped' | 'retry'> {
  return serialized(async () => {
    // Relee la fila: otro intento pudo depositarla mientras esta esperaba su turno.
    const fresh = (await getLicense(row.id)) ?? row;
    if (fresh.acta_vc_id) return 'done';
    return depositLicenseNow(client, fresh);
  });
}

async function depositLicenseNow(client: ActaClient, row: LicenseRow): Promise<'done' | 'skipped' | 'retry'> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const owner = await holderAddress(row.user_id);
    if (!owner) {
      await db
        .prepare(`UPDATE licenses SET acta_error = 'sin wallet Stellar', acta_attempts = ?, updated_at = ? WHERE id = ?`)
        .run(MAX_ATTEMPTS, now, row.id);
      return 'skipped';
    }
    const issuerDid = await ensureIssuerDid(client);
    await ensureHolderVault(client, row.user_id, owner, didKeyFromStellar(owner));
    const vc = JSON.parse(row.vc) as unknown;
    const txId = await client.issue(owner, row.id, vc, issuerDid);
    await db
      .prepare(`UPDATE licenses SET acta_vc_id = ?, acta_tx = ?, acta_error = NULL, updated_at = ? WHERE id = ?`)
      .run(row.id, txId || null, now, row.id);
    console.log(`[acta] licencia ${row.id} depositada en el vault de ${owner.slice(0, 6)}… (${txId})`);
    return 'done';
  } catch (err) {
    const attempts = (row.acta_attempts ?? 0) + 1;
    const delay = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
    const msg = (err as Error).message.slice(0, 500);
    await db
      .prepare(`UPDATE licenses SET acta_attempts = ?, acta_error = ?, acta_next_at = ?, updated_at = ? WHERE id = ?`)
      .run(attempts, msg, now + delay, now, row.id);
    console.log(`[acta] licencia ${row.id}: intento ${attempts} falló: ${msg}`);
    return 'retry';
  }
}

/** Licencias válidas sin depositar cuyo reintento ya toca. */
export async function pendingDeposits(limit = 10): Promise<LicenseRow[]> {
  const now = Math.floor(Date.now() / 1000);
  return db
    .prepare(
      `SELECT * FROM licenses WHERE acta_vc_id IS NULL AND status = 'valid'
         AND COALESCE(acta_attempts, 0) < ? AND COALESCE(acta_next_at, 0) <= ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all<LicenseRow>(MAX_ATTEMPTS, now, limit);
}

let running = false;
export async function runActaQueueOnce(client: ActaClient): Promise<number> {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (const row of await pendingDeposits()) {
      const fresh = await getLicense(row.id);
      if (fresh && (await depositLicense(client, fresh)) === 'done') n++;
    }
  } finally {
    running = false;
  }
  return n;
}

/** Arranca el worker si ACTA está configurado. Devuelve false si no lo está. */
export function startActaWorker(): boolean {
  const cfg = actaConfigFromEnv();
  if (!cfg) {
    console.log('[acta] desactivado (sin ACTA_API_KEY o sin cuenta firmante)');
    return false;
  }
  const client = new ActaClient(cfg);
  console.log(`[acta] activo: ${cfg.apiUrl} · emisor ${client.address} · red ${cfg.network}`);
  const tick = () => void runActaQueueOnce(client).catch((err) => console.log('[acta] worker:', (err as Error).message));
  setTimeout(tick, 5_000).unref();
  setInterval(tick, WORKER_INTERVAL_MS).unref();
  return true;
}

/** Intento inmediato tras emitir una licencia (sin esperar al siguiente tick). */
export function depositSoon(licenseId: string): void {
  const cfg = actaConfigFromEnv();
  if (!cfg) return;
  const client = new ActaClient(cfg);
  setTimeout(() => {
    void getLicense(licenseId)
      .then((row) => (row ? depositLicense(client, row) : undefined))
      .catch((err) => console.log('[acta] depósito inmediato:', (err as Error).message));
  }, 1_000).unref();
}
