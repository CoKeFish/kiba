import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  computeFeeSplit,
  PLATFORM_FEE_BPS,
  BPS_DENOMINATOR,
  PLATFORM_TREASURY,
  getAgentPda,
  getEscrowPda,
} from '../src/anchor-helpers';

// ─── computeFeeSplit ───────────────────────────────────────────

test('PLATFORM_FEE_BPS y BPS_DENOMINATOR están alineados con el contrato (5%)', () => {
  assert.equal(PLATFORM_FEE_BPS, 500);
  assert.equal(BPS_DENOMINATOR, 10_000);
  assert.equal(PLATFORM_FEE_BPS / BPS_DENOMINATOR, 0.05);
});

test('computeFeeSplit: 100_000_000 lamports → 5M fee + 95M owner', () => {
  const { ownerAmount, platformFee } = computeFeeSplit(100_000_000n);
  assert.equal(platformFee, 5_000_000n);
  assert.equal(ownerAmount, 95_000_000n);
});

test('computeFeeSplit: amount + fee siempre suman el total', () => {
  for (const amount of [1n, 1000n, 10_000n, 1_000_000n, 1_000_000_000n]) {
    const { ownerAmount, platformFee } = computeFeeSplit(amount);
    assert.equal(ownerAmount + platformFee, amount);
  }
});

test('computeFeeSplit acepta number además de bigint', () => {
  const { ownerAmount, platformFee } = computeFeeSplit(20_000);
  assert.equal(platformFee, 1_000n);
  assert.equal(ownerAmount, 19_000n);
});

test('computeFeeSplit: amount=0 → fee=0, owner=0', () => {
  const { ownerAmount, platformFee } = computeFeeSplit(0);
  assert.equal(ownerAmount, 0n);
  assert.equal(platformFee, 0n);
});

test('computeFeeSplit redondea hacia abajo (no overflow)', () => {
  // 19 lamports * 500 / 10000 = 0.95 → trunca a 0
  const { ownerAmount, platformFee } = computeFeeSplit(19);
  assert.equal(platformFee, 0n);
  assert.equal(ownerAmount, 19n);
});

// ─── PLATFORM_TREASURY ─────────────────────────────────────────

test('PLATFORM_TREASURY es una PublicKey válida', () => {
  assert.ok(PLATFORM_TREASURY instanceof PublicKey);
  // base58 válida — toBase58() no debe tirar
  assert.doesNotThrow(() => PLATFORM_TREASURY.toBase58());
});

// ─── PDA derivation ────────────────────────────────────────────

test('getAgentPda: PDA determinístico para mismo (programId, service)', () => {
  const programId = Keypair.generate().publicKey;
  const [pda1, bump1] = getAgentPda(programId, 'translator');
  const [pda2, bump2] = getAgentPda(programId, 'translator');
  assert.equal(pda1.toBase58(), pda2.toBase58());
  assert.equal(bump1, bump2);
});

test('getAgentPda: services distintos → PDAs distintos', () => {
  const programId = Keypair.generate().publicKey;
  const [pda1] = getAgentPda(programId, 'translator');
  const [pda2] = getAgentPda(programId, 'risk-auditor');
  assert.notEqual(pda1.toBase58(), pda2.toBase58());
});

test('getEscrowPda: cambiar nonce cambia el PDA', () => {
  const programId = Keypair.generate().publicKey;
  const client = Keypair.generate().publicKey;
  const agentOwner = Keypair.generate().publicKey;
  const [pda1] = getEscrowPda(programId, client, agentOwner, 1n);
  const [pda2] = getEscrowPda(programId, client, agentOwner, 2n);
  assert.notEqual(pda1.toBase58(), pda2.toBase58());
});

test('getEscrowPda: cambiar client cambia el PDA', () => {
  const programId = Keypair.generate().publicKey;
  const c1 = Keypair.generate().publicKey;
  const c2 = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const [pda1] = getEscrowPda(programId, c1, owner, 1n);
  const [pda2] = getEscrowPda(programId, c2, owner, 1n);
  assert.notEqual(pda1.toBase58(), pda2.toBase58());
});

test('getEscrowPda acepta number y bigint para nonce', () => {
  const programId = Keypair.generate().publicKey;
  const client = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const [a] = getEscrowPda(programId, client, owner, 42);
  const [b] = getEscrowPda(programId, client, owner, 42n);
  assert.equal(a.toBase58(), b.toBase58());
});
