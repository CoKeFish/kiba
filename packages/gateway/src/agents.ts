/**
 * Servicios publicados desde el panel: registrar, cambiar, dar de baja y listar.
 *
 * El dueño de un servicio en el registro de Stellar es una wallet, y solo ella puede cambiarlo
 * o darlo de baja. Esa wallet es la del publicador, no una de Kiba:
 *
 *   - Con la wallet vinculada a la cuenta (Privy con el usuario de dueño, o una externa), el
 *     gateway ARMA la transacción y el usuario la FIRMA. Estas funciones devuelven entonces
 *     `{ prepared, wallet }` y el servicio queda registrado cuando la firma llega a `/v1/spend/submit`.
 *   - Las cuentas anteriores tienen una wallet que Kiba creó y puede firmar. Mientras no vinculen
 *     la suya, sus servicios se siguen manejando con esa wallet, como antes. Kiba ya no crea más.
 *
 * Soroban no enumera el registro: los servicios de cada cuenta se anotan en `user_agents`.
 */
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { ASSET, BASE_UNITS_PER_TOKEN, chainClientFor, chainClientForSigner } from './chain';
import { ensureFunded, existingUserSigner, getMasterWallet } from './wallets';
import { db } from './db';
import { getSpendChain, onPreparedSent, storePrepared, type PreparedTx, type WalletKind } from './spend';
import { getServiceLedgerStats, netBaseUnits } from './publisher';
import type { ChainClient } from 'kiba-sdk';

/** Fondeo on-demand antes de registrar (cubre fee + rent/TTL). Base units: 0.01 SOL / 1 XLM. */
const REGISTER_FUND_BASE_UNITS = 10_000_000;
/** Sólo cubre el tx fee. */
const UPDATE_FUND_BASE_UNITS = 100_000;

const SERVICE_RE = /^[a-z0-9](?:[a-z0-9-_]{0,30}[a-z0-9])?$/;

export interface RegisterAgentInput {
  service: string;
  pricePerCallLamports: number;
  endpoint: string;
  description: string;
}

export interface UpdateAgentInput {
  pricePerCallLamports?: number;
  endpoint?: string;
  description?: string;
}

export function validateRegisterInput(input: RegisterAgentInput): string | null {
  if (!input.service || typeof input.service !== 'string') return 'service required';
  if (input.service.length > 32) return 'service too long (max 32)';
  if (!SERVICE_RE.test(input.service))
    return 'service must be lowercase, alphanumeric, with optional - or _ (start/end alphanumeric)';
  if (!Number.isInteger(input.pricePerCallLamports) || input.pricePerCallLamports <= 0)
    return 'pricePerCallLamports must be positive integer';
  if (input.pricePerCallLamports > 100_000_000_000) return 'pricePerCallLamports unreasonably high';
  if (!input.endpoint || !/^https?:\/\//.test(input.endpoint))
    return 'endpoint must be http(s)://...';
  if (input.endpoint.length > 256) return 'endpoint too long (max 256)';
  if (!input.description) return 'description required';
  if (input.description.length > 512) return 'description too long (max 512)';
  return null;
}

export function validateUpdateInput(input: UpdateAgentInput): string | null {
  if (input.pricePerCallLamports !== undefined) {
    if (!Number.isInteger(input.pricePerCallLamports) || input.pricePerCallLamports <= 0)
      return 'pricePerCallLamports must be positive integer';
    if (input.pricePerCallLamports > 100_000_000_000) return 'pricePerCallLamports unreasonably high';
  }
  if (input.endpoint !== undefined) {
    if (!/^https?:\/\//.test(input.endpoint)) return 'endpoint must be http(s)://...';
    if (input.endpoint.length > 256) return 'endpoint too long (max 256)';
  }
  if (input.description !== undefined) {
    if (input.description.length > 512) return 'description too long (max 512)';
  }
  return null;
}

// ─── Acceso al registro ─────────────────────────────────────────────────────

/** Lo que este módulo lee del registro. Inyectable en tests. */
export interface RegistryReader {
  fetchAgent: ChainClient['fetchAgent'];
}
let reader: RegistryReader | null = null;
/** Tests: sustituye la lectura del registro (null = la red). */
export function setRegistryReader(r: RegistryReader | null): void {
  reader = r;
}
function registry(): RegistryReader {
  if (reader) return reader;
  const cc = chainClientFor(getMasterWallet(), 'treasury');
  if (!cc) throw new Error('on-chain registry unavailable (no chain configured)');
  return cc;
}
function registryId(): string {
  const id = process.env.STELLAR_CONTRACT_ID;
  if (!id) throw new Error('on-chain registry unavailable (no chain configured)');
  return id;
}

/** La wallet con la que el usuario firma: la que vinculó a su cuenta. null si no tiene. */
async function linkedWallet(userId: number): Promise<{ address: string; kind: WalletKind } | null> {
  const row = (await db.prepare('SELECT spend_address, spend_kind FROM users WHERE id = ?').get(userId)) as
    | { spend_address: string | null; spend_kind: string | null }
    | undefined;
  return row?.spend_address ? { address: row.spend_address, kind: row.spend_kind === 'privy' ? 'privy' : 'external' } : null;
}

/** Cliente del registro que firma con la wallet anterior de la cuenta (la que Kiba controla). null si no tiene. */
async function legacyChain(userId: number): Promise<ChainClient | null> {
  const signer = await existingUserSigner(userId);
  return signer ? chainClientForSigner(signer, `user:${userId}`) : null;
}

/** Lo que el usuario tiene que firmar con su wallet para que el cambio ocurra. */
export interface NeedsSignature {
  prepared: PreparedTx;
  wallet: { address: string; kind: WalletKind };
}
export const needsSignature = (r: unknown): r is NeedsSignature => typeof r === 'object' && r !== null && 'prepared' in r;

const str = (v: string) => nativeToScVal(v, { type: 'string' });
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const opt = (v: xdr.ScVal | null) => v ?? xdr.ScVal.scvVoid();

async function trackService(service: string, userId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_agents (service, user_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (service) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at`,
    )
    .run(service, userId, Math.floor(Date.now() / 1000));
}
// Cuando la firma del usuario entra en la red, el servicio queda (o deja de estar) en su lista.
onPreparedSent('agent_register', async ({ userId, meta }) => trackService(String(meta.service), userId));
onPreparedSent('agent_deregister', async ({ userId, meta }) => {
  await db.prepare('DELETE FROM user_agents WHERE service = ? AND user_id = ?').run(String(meta.service), userId);
});

export interface RegisterResult {
  signature: string;
  pda: string;
  owner: string;
  service: string;
  refill?: { signature: string; lamports: number };
}

export async function registerAgent(userId: number, input: RegisterAgentInput): Promise<RegisterResult | NeedsSignature> {
  if (await registry().fetchAgent(input.service)) throw new Error(`service "${input.service}" is already registered`);

  // Con wallet propia: el usuario firma el registro y queda de dueño.
  const wallet = await linkedWallet(userId);
  if (wallet) {
    const built = await getSpendChain().buildContractCall(wallet.address, registryId(), 'register_agent', [
      nativeToScVal(wallet.address, { type: 'address' }),
      str(input.service),
      i128(BigInt(input.pricePerCallLamports)),
      str(input.endpoint),
      str(input.description),
    ]);
    return { prepared: await storePrepared(userId, 'agent_register', wallet.address, built, { service: input.service }), wallet };
  }

  // Sin wallet propia: solo las cuentas que ya tenían una wallet creada por Kiba.
  const cc = await legacyChain(userId);
  if (!cc) throw new Error('para publicar un servicio vincula tu wallet: el servicio queda a tu nombre y lo firmas tú');
  const refillInfo = await ensureFunded(userId, REGISTER_FUND_BASE_UNITS);
  const signature = await cc.registerAgent({
    service: input.service,
    pricePerCallBaseUnits: BigInt(input.pricePerCallLamports),
    endpoint: input.endpoint,
    description: input.description,
  });
  await trackService(input.service, userId);
  return {
    signature,
    pda: `${ASSET === 'XLM' ? 'stellar' : 'solana'}:${input.service}`,
    owner: cc.ownerAddress,
    service: input.service,
    ...(refillInfo.refilled && refillInfo.signature
      ? { refill: { signature: refillInfo.signature, lamports: refillInfo.afterLamports - refillInfo.beforeLamports } }
      : {}),
  };
}

/**
 * Con qué wallet se cambia un servicio ya registrado: la del usuario si es la dueña, o la
 * anterior de la cuenta si lo es ella. Lanza si la cuenta no es dueña.
 */
async function ownerOf(userId: number, service: string): Promise<{ wallet: { address: string; kind: WalletKind } } | { legacy: ChainClient }> {
  const existing = await registry().fetchAgent(service);
  if (!existing) throw new Error(`service "${service}" not found`);
  const wallet = await linkedWallet(userId);
  if (wallet && wallet.address === existing.ownerAddress) return { wallet };
  const cc = await legacyChain(userId);
  if (cc && cc.ownerAddress === existing.ownerAddress) return { legacy: cc };
  throw new Error('not the owner of this agent');
}

export interface UpdateResult {
  signature: string;
  service: string;
}

export async function updateAgent(userId: number, service: string, input: UpdateAgentInput): Promise<UpdateResult | NeedsSignature> {
  const owner = await ownerOf(userId, service);
  if ('wallet' in owner) {
    const built = await getSpendChain().buildContractCall(owner.wallet.address, registryId(), 'update_agent', [
      str(service),
      opt(input.pricePerCallLamports !== undefined ? i128(BigInt(input.pricePerCallLamports)) : null),
      opt(input.endpoint !== undefined ? str(input.endpoint) : null),
      opt(input.description !== undefined ? str(input.description) : null),
    ]);
    return { prepared: await storePrepared(userId, 'agent_update', owner.wallet.address, built, { service }), wallet: owner.wallet };
  }
  await ensureFunded(userId, UPDATE_FUND_BASE_UNITS);
  const signature = await owner.legacy.updateAgent({
    service,
    pricePerCallBaseUnits: input.pricePerCallLamports !== undefined ? BigInt(input.pricePerCallLamports) : null,
    endpoint: input.endpoint ?? null,
    description: input.description ?? null,
  });
  return { signature, service };
}

export interface DeregisterResult {
  signature: string;
  service: string;
}

export async function deregisterAgent(userId: number, service: string): Promise<DeregisterResult | NeedsSignature> {
  const owner = await ownerOf(userId, service);
  if ('wallet' in owner) {
    const built = await getSpendChain().buildContractCall(owner.wallet.address, registryId(), 'deregister_agent', [str(service)]);
    return { prepared: await storePrepared(userId, 'agent_deregister', owner.wallet.address, built, { service }), wallet: owner.wallet };
  }
  await ensureFunded(userId, UPDATE_FUND_BASE_UNITS);
  const signature = await owner.legacy.deregisterAgent(service);
  await db.prepare('DELETE FROM user_agents WHERE service = ? AND user_id = ?').run(service, userId);
  return { signature, service };
}

export interface AgentSummary {
  pda: string;
  owner: string;
  service: string;
  pricePerCallLamports: number;
  pricePerCallSol: number;
  endpoint: string;
  description: string;
  // Stats del ledger Postgres (NETO), no del contrato registro (cuyos contadores son 0).
  totalCalls: number;
  totalEarnedLamports: number; // neto lifetime
  totalEarnedSol: number; // neto lifetime
  pendingLamports: number; // neto aún no confirmado on-chain
  pendingSol: number;
  settledLamports: number; // neto ya confirmado on-chain
  settledSol: number;
  createdAt: number;
}

export async function listMyAgents(userId: number): Promise<AgentSummary[]> {
  const cc = registry();
  const rows = (await db
    .prepare('SELECT service FROM user_agents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)) as { service: string }[];

  // Calls/earnings reales desde el ledger, en UNA query (no N+1). Los contadores del contrato
  // registro (a.totalCalls/a.totalEarnedBaseUnits) nunca se incrementan → siempre 0.
  const stats = await getServiceLedgerStats(rows.map((r) => r.service));

  const out: AgentSummary[] = [];
  for (const { service } of rows) {
    const a = await cc.fetchAgent(service);
    if (!a) {
      // Ya no existe on-chain → limpiar el tracking y omitir.
      await db.prepare('DELETE FROM user_agents WHERE service = ? AND user_id = ?').run(service, userId);
      continue;
    }
    const price = Number(a.pricePerCallBaseUnits);
    const st = stats.get(service);
    const earnedNet = netBaseUnits(st?.grossLifetime ?? 0);
    const pendingNet = netBaseUnits(st?.grossPending ?? 0);
    const settledNet = netBaseUnits(st?.grossSettled ?? 0);
    // Nombres *_lamports/*_sol conservados por compat con el dashboard (legacy alias),
    // con valores correctos para la cadena activa (stroops/XLM cuando CHAIN=stellar).
    out.push({
      pda: `${ASSET === 'XLM' ? 'stellar' : 'solana'}:${a.service}`,
      owner: a.ownerAddress,
      service: a.service,
      pricePerCallLamports: price,
      pricePerCallSol: price / BASE_UNITS_PER_TOKEN,
      endpoint: a.endpoint,
      description: a.description,
      totalCalls: st?.calls ?? 0,
      totalEarnedLamports: earnedNet,
      totalEarnedSol: earnedNet / BASE_UNITS_PER_TOKEN,
      pendingLamports: pendingNet,
      pendingSol: pendingNet / BASE_UNITS_PER_TOKEN,
      settledLamports: settledNet,
      settledSol: settledNet / BASE_UNITS_PER_TOKEN,
      createdAt: a.createdAt != null ? Number(a.createdAt) : 0,
    });
  }
  return out;
}
