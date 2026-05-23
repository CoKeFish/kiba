/**
 * Agent management — register / update / deregister on-chain a nombre del user.
 *
 * Modelo: el "owner" del agente registrado on-chain ES la custodial wallet del user.
 * Eso significa que cuando alguien paga por usar ese agente, el SOL llega a la
 * custodial wallet del user (no a la master). El user ve esos ingresos en
 * /v1/wallet (balance on-chain real, no virtual USD).
 *
 * Para registrar/actualizar/borrar, el gateway:
 *   1. Carga la keypair custodial del user
 *   2. Asegura que esa wallet tiene SOL para el rent + tx fee (refill desde master si no)
 *   3. Construye la instrucción con el SDK low-level y firma con la wallet del user
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { AgentBazaarProgram } from '@agent-bazaar/sdk';
import { ensureFunded, getOnChainBalance, loadUserWallet } from './wallets';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID;

/**
 * Rent-exempt aproximado para una cuenta Agent (8 disc + 32 owner + ~32 service +
 * 8 price + ~256 endpoint + ~512 desc + 8 calls + 8 earned + 8 createdAt + 1 bump
 * = ~870 bytes → ~0.0067 SOL). Pedimos 0.01 para tener margen + tx fee.
 */
const REGISTER_FUND_LAMPORTS = 10_000_000; // 0.01 SOL

/** Sólo necesita cubrir el tx fee (~5000 lamports). */
const UPDATE_FUND_LAMPORTS = 100_000; // 0.0001 SOL

function getProgram(): AgentBazaarProgram {
  if (!PROGRAM_ID) throw new Error('PROGRAM_ID env not set');
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  return new AgentBazaarProgram(PROGRAM_ID, conn);
}

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
  if (input.pricePerCallLamports > 100_000_000_000) // 100 SOL cap
    return 'pricePerCallLamports unreasonably high';
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

export interface RegisterResult {
  signature: string;
  pda: string;
  owner: string;
  refill?: { signature: string; lamports: number };
}

export async function registerAgent(
  userId: number,
  input: RegisterAgentInput,
): Promise<RegisterResult> {
  const program = getProgram();
  const userWallet = loadUserWallet(userId);

  // Verifica que el service no exista ya
  const existing = await program.fetchAgent(input.service);
  if (existing) {
    throw new Error(`service "${input.service}" is already registered`);
  }

  // Refill on-demand (cubre rent + fee)
  const refillInfo = await ensureFunded(userId, REGISTER_FUND_LAMPORTS);

  const ix = program.registerAgentInstr({
    owner: userWallet.publicKey,
    service: input.service,
    pricePerCall: input.pricePerCallLamports,
    endpoint: input.endpoint,
    description: input.description,
  });

  const signature = await program.sendAndConfirm([ix], userWallet);
  const [pda] = await import('@agent-bazaar/sdk').then((m) =>
    m.getAgentPda(new PublicKey(PROGRAM_ID!), input.service),
  );

  return {
    signature,
    pda: pda.toBase58(),
    owner: userWallet.publicKey.toBase58(),
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
  pda: string;
}

export async function updateAgent(
  userId: number,
  service: string,
  input: UpdateAgentInput,
): Promise<UpdateResult> {
  const program = getProgram();
  const userWallet = loadUserWallet(userId);

  // Verifica que el agente exista y que el user sea el owner
  const existing = await program.fetchAgent(service);
  if (!existing) throw new Error(`service "${service}" not found`);
  if (!existing.owner.equals(userWallet.publicKey)) {
    throw new Error('not the owner of this agent');
  }

  await ensureFunded(userId, UPDATE_FUND_LAMPORTS);

  const ix = program.updateAgentInstr({
    owner: userWallet.publicKey,
    service,
    pricePerCall: input.pricePerCallLamports ?? null,
    endpoint: input.endpoint ?? null,
    description: input.description ?? null,
  });

  const signature = await program.sendAndConfirm([ix], userWallet);
  const [pda] = await import('@agent-bazaar/sdk').then((m) =>
    m.getAgentPda(new PublicKey(PROGRAM_ID!), service),
  );

  return { signature, pda: pda.toBase58() };
}

export interface DeregisterResult {
  signature: string;
  service: string;
  /** Lamports recovered from the closed PDA (rent refund). */
  rentRecovered: number;
}

export async function deregisterAgent(
  userId: number,
  service: string,
): Promise<DeregisterResult> {
  const program = getProgram();
  const userWallet = loadUserWallet(userId);

  const existing = await program.fetchAgent(service);
  if (!existing) throw new Error(`service "${service}" not found`);
  if (!existing.owner.equals(userWallet.publicKey)) {
    throw new Error('not the owner of this agent');
  }

  await ensureFunded(userId, UPDATE_FUND_LAMPORTS);

  const balanceBefore = await getOnChainBalance(userWallet);

  const ix = program.deregisterAgentInstr({
    owner: userWallet.publicKey,
    service,
  });
  const signature = await program.sendAndConfirm([ix], userWallet);

  const balanceAfter = await getOnChainBalance(userWallet);
  const rentRecovered = Math.max(0, balanceAfter - balanceBefore);

  return { signature, service, rentRecovered };
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
  const program = getProgram();
  const userWallet = loadUserWallet(userId);
  const ownerPubkey = userWallet.publicKey;

  const all = await program.fetchAllAgents();
  return all
    .filter((a) => a.data.owner.equals(ownerPubkey))
    .map((a) => ({
      pda: a.pda.toBase58(),
      owner: a.data.owner.toBase58(),
      service: a.data.service,
      pricePerCallLamports: Number(a.data.pricePerCall),
      pricePerCallSol: Number(a.data.pricePerCall) / 1e9,
      endpoint: a.data.endpoint,
      description: a.data.description,
      totalCalls: Number(a.data.totalCalls),
      totalEarnedLamports: Number(a.data.totalEarned),
      totalEarnedSol: Number(a.data.totalEarned) / 1e9,
      createdAt: Number(a.data.createdAt),
    }));
}
