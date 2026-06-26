import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeeSplit, PLATFORM_FEE_BPS, BPS_DENOMINATOR } from '../src/fees';

test('PLATFORM_FEE_BPS y BPS_DENOMINATOR están alineados con el contrato (5%)', () => {
  assert.equal(PLATFORM_FEE_BPS, 500);
  assert.equal(BPS_DENOMINATOR, 10_000);
  assert.equal(PLATFORM_FEE_BPS / BPS_DENOMINATOR, 0.05);
});

test('computeFeeSplit: 100_000_000 → 5M fee + 95M owner', () => {
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
  // 19 * 500 / 10000 = 0.95 → trunca a 0
  const { ownerAmount, platformFee } = computeFeeSplit(19);
  assert.equal(platformFee, 0n);
  assert.equal(ownerAmount, 19n);
});
