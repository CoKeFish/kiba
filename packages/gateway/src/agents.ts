/**
 * Agent management — register / update / deregister / list a nombre del user,
 * AGNÓSTICO A LA CADENA (Solana o Stellar) vía la abstracción ChainClient.
 *
 * Modelo: el "owner" on-chain del agente registrado ES la custodial wallet del
 * user (la misma keypair que firma open_escrow/claim_payment). Cuando alguien
 * paga por usar ese agente, el activo llega a la custodial del user — ingresos
 * reales on-chain, visibles en /v1/wallet.
 *
 * Flujo (idéntico al de proxy.ts/callOnBehalf, ya probado en Stellar):
 *   1. ChainClient para la custodial del user (chainClientFor → respeta CHAIN).
 *   2. ensureFunded() asegura saldo on-chain (friendbot en Stellar, refill master en Solana).
 *   3. cc.registerAgent / updateAgent / deregisterAgent firma con la wallet del user.
 *
 * Soroban no enumera el registro → trackeamos los servicios de cada user en la
 * tabla `user_agents` para poder listarlos (listMyAgents) sin enumeración on-chain.
 */
import { ASSET, BASE_UNITS_PER_TOKEN, chainClientForSigner } from './chain';
import { ensureFunded, loadUserSigner } from './wallets';
import { db } from './db';
import type { ChainClient } from '@kiba/sdk';

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

/** ChainClient (chain-aware) firmando con la custodial del user. Lanza si no hay cadena. */
async function chainFor(userId: number): Promise<ChainClient> {
  const cc = chainClientForSigner(await loadUserSigner(userId), `user:${userId}`);
  if (!cc) throw new Error('on-chain registry unavailable (no chain configured)');
  return cc;
}

export interface RegisterResult {
  signature: string;
  pda: string;
  owner: string;
  service: string;
  refill?: { signature: string; lamports: number };
}

export async function registerAgent(
  userId: number,
  input: RegisterAgentInput,
): Promise<RegisterResult> {
  const cc = await chainFor(userId);

  const existing = await cc.fetchAgent(input.service);
  if (existing) throw new Error(`service "${input.service}" is already registered`);

  const refillInfo = await ensureFunded(userId, REGISTER_FUND_BASE_UNITS);

  const signature = await cc.registerAgent({
    service: input.service,
    pricePerCallBaseUnits: BigInt(input.pricePerCallLamports),
    endpoint: input.endpoint,
    description: input.description,
  });

  // Trackear para poder listar (Soroban no enumera).
  db.prepare(
    'INSERT OR REPLACE INTO user_agents (service, user_id, created_at) VALUES (?, ?, ?)',
  ).run(input.service, userId, Math.floor(Date.now() / 1000));

  return {
    signature,
    pda: `${ASSET === 'XLM' ? 'stellar' : 'solana'}:${input.service}`,
    owner: cc.ownerAddress,
    service: input.service,
    ...(refillInfo.refilled && refillInfo.signature
      ? {
          refill: {
            signature: refillInfo.signature,
            lamports: refillInfo.afterLamports - refillInfo.beforeLamports,
          },
        }
      : {}),
  };
}

export interface UpdateResult {
  signature: string;
  service: string;
}

export async function updateAgent(
  userId: number,
  service: string,
  input: UpdateAgentInput,
): Promise<UpdateResult> {
  const cc = await chainFor(userId);

  const existing = await cc.fetchAgent(service);
  if (!existing) throw new Error(`service "${service}" not found`);
  if (existing.ownerAddress !== cc.ownerAddress) throw new Error('not the owner of this agent');

  await ensureFunded(userId, UPDATE_FUND_BASE_UNITS);

  const signature = await cc.updateAgent({
    service,
    pricePerCallBaseUnits:
      input.pricePerCallLamports !== undefined ? BigInt(input.pricePerCallLamports) : null,
    endpoint: input.endpoint ?? null,
    description: input.description ?? null,
  });

  return { signature, service };
}

export interface DeregisterResult {
  signature: string;
  service: string;
}

export async function deregisterAgent(userId: number, service: string): Promise<DeregisterResult> {
  const cc = await chainFor(userId);

  const existing = await cc.fetchAgent(service);
  if (!existing) throw new Error(`service "${service}" not found`);
  if (existing.ownerAddress !== cc.ownerAddress) throw new Error('not the owner of this agent');

  await ensureFunded(userId, UPDATE_FUND_BASE_UNITS);

  const signature = await cc.deregisterAgent(service);
  db.prepare('DELETE FROM user_agents WHERE service = ? AND user_id = ?').run(service, userId);

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
  totalCalls: number;
  totalEarnedLamports: number;
  totalEarnedSol: number;
  createdAt: number;
}

export async function listMyAgents(userId: number): Promise<AgentSummary[]> {
  const cc = await chainFor(userId);
  const rows = db
    .prepare('SELECT service FROM user_agents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { service: string }[];

  const out: AgentSummary[] = [];
  for (const { service } of rows) {
    const a = await cc.fetchAgent(service);
    if (!a) {
      // Ya no existe on-chain → limpiar el tracking y omitir.
      db.prepare('DELETE FROM user_agents WHERE service = ? AND user_id = ?').run(service, userId);
      continue;
    }
    const price = Number(a.pricePerCallBaseUnits);
    const earned = a.totalEarnedBaseUnits != null ? Number(a.totalEarnedBaseUnits) : 0;
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
      totalCalls: a.totalCalls != null ? Number(a.totalCalls) : 0,
      totalEarnedLamports: earned,
      totalEarnedSol: earned / BASE_UNITS_PER_TOKEN,
      createdAt: a.createdAt != null ? Number(a.createdAt) : 0,
    });
  }
  return out;
}
