/**
 * Helpers para codificar/decodificar accounts e instrucciones de Anchor sin depender del IDL.
 *
 * Anchor usa este formato:
 *   instruction data = [8-byte discriminator][borsh-encoded args]
 *   account data     = [8-byte discriminator][borsh-encoded fields]
 *
 *   discriminator = sha256("global:<instr>")[0..8]   para instrucciones
 *   discriminator = sha256("account:<Name>")[0..8]   para accounts
 */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export function discriminator(kind: 'global' | 'account', name: string): Buffer {
  return createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);
}

// ─── Borsh primitives ───────────────────────────────────────────

export function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

export function decodeString(buf: Buffer, offset: number): { value: string; nextOffset: number } {
  const len = buf.readUInt32LE(offset);
  const value = buf.subarray(offset + 4, offset + 4 + len).toString('utf8');
  return { value, nextOffset: offset + 4 + len };
}

export function encodeU64(n: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n), 0);
  return buf;
}

export function decodeU64(buf: Buffer, offset: number): { value: bigint; nextOffset: number } {
  return { value: buf.readBigUInt64LE(offset), nextOffset: offset + 8 };
}

export function encodeI64(n: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(n), 0);
  return buf;
}

export function decodeI64(buf: Buffer, offset: number): { value: bigint; nextOffset: number } {
  return { value: buf.readBigInt64LE(offset), nextOffset: offset + 8 };
}

export function decodePubkey(buf: Buffer, offset: number): { value: PublicKey; nextOffset: number } {
  return { value: new PublicKey(buf.subarray(offset, offset + 32)), nextOffset: offset + 32 };
}

export function encodeOptionU64(value: bigint | number | null | undefined): Buffer {
  if (value === null || value === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

export function encodeOptionString(value: string | null | undefined): Buffer {
  if (value === null || value === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeString(value)]);
}

// ─── PDA derivation ─────────────────────────────────────────────

export function getAgentPda(programId: PublicKey, service: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), Buffer.from(service, 'utf8')],
    programId,
  );
}

export function getEscrowPda(
  programId: PublicKey,
  client: PublicKey,
  agentOwner: PublicKey,
  nonce: bigint | number,
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), client.toBuffer(), agentOwner.toBuffer(), nonceBuf],
    programId,
  );
}

// ─── Account decoding ───────────────────────────────────────────

export interface AgentAccount {
  owner: PublicKey;
  service: string;
  pricePerCall: bigint;
  endpoint: string;
  description: string;
  totalCalls: bigint;
  totalEarned: bigint;
  createdAt: bigint;
  bump: number;
}

export function decodeAgent(data: Buffer): AgentAccount {
  // Skip 8-byte discriminator
  let offset = 8;

  const owner = decodePubkey(data, offset);
  offset = owner.nextOffset;

  const service = decodeString(data, offset);
  offset = service.nextOffset;

  const pricePerCall = decodeU64(data, offset);
  offset = pricePerCall.nextOffset;

  const endpoint = decodeString(data, offset);
  offset = endpoint.nextOffset;

  const description = decodeString(data, offset);
  offset = description.nextOffset;

  const totalCalls = decodeU64(data, offset);
  offset = totalCalls.nextOffset;

  const totalEarned = decodeU64(data, offset);
  offset = totalEarned.nextOffset;

  const createdAt = decodeI64(data, offset);
  offset = createdAt.nextOffset;

  const bump = data.readUInt8(offset);

  return {
    owner: owner.value,
    service: service.value,
    pricePerCall: pricePerCall.value,
    endpoint: endpoint.value,
    description: description.value,
    totalCalls: totalCalls.value,
    totalEarned: totalEarned.value,
    createdAt: createdAt.value,
    bump,
  };
}

export type EscrowState = 'Pending' | 'Completed' | 'Refunded';

export interface EscrowAccount {
  client: PublicKey;
  agentOwner: PublicKey;
  service: string;
  amount: bigint;
  nonce: bigint;
  createdAt: bigint;
  state: EscrowState;
  bump: number;
}

export function decodeEscrow(data: Buffer): EscrowAccount {
  let offset = 8;

  const client = decodePubkey(data, offset);
  offset = client.nextOffset;

  const agentOwner = decodePubkey(data, offset);
  offset = agentOwner.nextOffset;

  const service = decodeString(data, offset);
  offset = service.nextOffset;

  const amount = decodeU64(data, offset);
  offset = amount.nextOffset;

  const nonce = decodeU64(data, offset);
  offset = nonce.nextOffset;

  const createdAt = decodeI64(data, offset);
  offset = createdAt.nextOffset;

  const stateByte = data.readUInt8(offset);
  offset += 1;
  const state: EscrowState =
    stateByte === 0 ? 'Pending' : stateByte === 1 ? 'Completed' : 'Refunded';

  const bump = data.readUInt8(offset);

  return {
    client: client.value,
    agentOwner: agentOwner.value,
    service: service.value,
    amount: amount.value,
    nonce: nonce.value,
    createdAt: createdAt.value,
    state,
    bump,
  };
}

// ─── Discriminator constants (precomputed for clarity) ──────────

export const INSTR_DISCRIMINATORS = {
  registerAgent: () => discriminator('global', 'register_agent'),
  updateAgent: () => discriminator('global', 'update_agent'),
  deregisterAgent: () => discriminator('global', 'deregister_agent'),
  openEscrow: () => discriminator('global', 'open_escrow'),
  claimPayment: () => discriminator('global', 'claim_payment'),
  refundEscrow: () => discriminator('global', 'refund_escrow'),
};

export const ACCOUNT_DISCRIMINATORS = {
  agent: () => discriminator('account', 'Agent'),
  escrow: () => discriminator('account', 'Escrow'),
};

// ─── Platform fee constants ──────────────────────────────────────
// Deben coincidir con `PLATFORM_FEE_BPS` y `PLATFORM_TREASURY` en lib.rs.

/** Comisión que cobra la plataforma — 500 bps = 5%. */
export const PLATFORM_FEE_BPS = 500;
export const BPS_DENOMINATOR = 10_000;

/** Wallet de la plataforma que recibe el fee (master wallet del Gateway). */
export const PLATFORM_TREASURY = new PublicKey(
  '3JcShJD9boEZQhXb515MDfMwX34muLzyQj8QyysKXuEF',
);

/** Calcula el split (owner net + platform fee) para un amount dado. */
export function computeFeeSplit(amount: bigint | number): {
  ownerAmount: bigint;
  platformFee: bigint;
} {
  const a = BigInt(amount);
  const fee = (a * BigInt(PLATFORM_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  return { ownerAmount: a - fee, platformFee: fee };
}
