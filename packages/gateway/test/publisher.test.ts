// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de cargar los módulos del gateway.
// Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  netBaseUnits,
  getServiceLedgerStats,
  parseSettlementRefs,
  listUserSettlements,
  getDailySeries,
} from '../src/publisher';
import { servicesToAutoSettle } from '../src/settlement';
import { db, initDb, pool } from '../src/db';
import { lamportsToUsd } from '../src/billing';
import { BASE_UNITS_PER_TOKEN } from '../src/chain';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

// ─── seeds ──────────────────────────────────────────────────────────
async function createTestUser(email: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, 0, now);
  return Number(result.lastInsertRowid);
}

async function seedAgent(userId: number, service: string): Promise<void> {
  await db
    .prepare('INSERT INTO user_agents (service, user_id, created_at) VALUES (?, ?, ?)')
    .run(service, userId, Math.floor(Date.now() / 1000));
}

async function setAutoSettleFlag(userId: number, on: boolean): Promise<void> {
  await db.prepare('UPDATE users SET auto_settle = ? WHERE id = ?').run(on ? 1 : 0, userId);
}

async function seedEarning(
  service: string,
  amount: number,
  opts: { settlementId?: number | null; settledAt?: number | null; createdAt?: number } = {},
): Promise<void> {
  const now = opts.createdAt ?? Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO agent_earnings (service, pay_to, amount_lamports, settlement_id, settled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(service, `pay-${service}`, amount, opts.settlementId ?? null, opts.settledAt ?? null, now);
}

async function seedSettlement(
  service: string,
  amount: number,
  opts: { status?: string; signature?: string | null; createdAt?: number } = {},
): Promise<number> {
  const now = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const info = await db
    .prepare(
      `INSERT INTO settlements (service, pay_to, amount_lamports, signature, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(service, `pay-${service}`, amount, opts.signature ?? null, opts.status ?? 'settled', now);
  return Number(info.lastInsertRowid);
}

// ─── netBaseUnits ───────────────────────────────────────────────────
test('netBaseUnits: 5% de fee con floor', () => {
  assert.equal(netBaseUnits(100000), 95000);
  assert.equal(netBaseUnits(0), 0);
  assert.equal(netBaseUnits(3), 3); // 3 - floor(0.15) = 3
  assert.equal(netBaseUnits(20), 19); // 20 - floor(1) = 19
});

// ─── getServiceLedgerStats ──────────────────────────────────────────
test('getServiceLedgerStats: array vacío → Map vacío (sin query)', async () => {
  const m = await getServiceLedgerStats([]);
  assert.equal(m.size, 0);
});

test('getServiceLedgerStats: 3 estados de earning + aislamiento por servicio', async () => {
  // svc-a: pendiente (10000), en vuelo (20000: settlement_id set, settled_at NULL), settled (30000)
  await seedEarning('svc-a', 10000);
  await seedEarning('svc-a', 20000, { settlementId: 7 });
  await seedEarning('svc-a', 30000, { settlementId: 8, settledAt: 1 });
  // svc-b: no debe contaminar svc-a
  await seedEarning('svc-b', 99999);

  const m = await getServiceLedgerStats(['svc-a', 'svc-b']);
  const a = m.get('svc-a');
  assert.ok(a);
  assert.equal(a.calls, 3);
  assert.equal(a.grossLifetime, 60000);
  assert.equal(a.grossSettled, 30000); // solo settled_at NOT NULL
  assert.equal(a.grossPending, 30000); // pendiente + en vuelo
  // settled + pending = lifetime
  assert.equal(a.grossSettled + a.grossPending, a.grossLifetime);

  const b = m.get('svc-b');
  assert.ok(b);
  assert.equal(b.calls, 1);
  assert.equal(b.grossLifetime, 99999);

  // Un servicio sin earnings no aparece en el Map.
  const none = await getServiceLedgerStats(['svc-c']);
  assert.equal(none.size, 0);
});

// ─── parseSettlementRefs ────────────────────────────────────────────
test('parseSettlementRefs: null/vacío → []', () => {
  assert.deepEqual(parseSettlementRefs(null), []);
  assert.deepEqual(parseSettlementRefs(''), []);
});

test('parseSettlementRefs: tx (64 hex), contract (C+55), opaque', () => {
  const hash = '5cd7e1088ebbfdae0b4663cc538e24dd12eac584e78a196a8a369ea1782b9d1a';
  const contract = 'CAZENAWYQTQJBADHR6PGQWE5S2DWZTYLAWGBY6RY7VVXZSJLYZLJEJJM';
  assert.deepEqual(parseSettlementRefs(hash), [{ ref: hash, kind: 'tx' }]);
  assert.deepEqual(parseSettlementRefs(contract), [{ ref: contract, kind: 'contract' }]);
  assert.deepEqual(parseSettlementRefs('settle-1'), [{ ref: 'settle-1', kind: 'opaque' }]);
});

test('parseSettlementRefs: CSV mixto con espacios/vacíos filtrados', () => {
  const hash = '5cd7e1088ebbfdae0b4663cc538e24dd12eac584e78a196a8a369ea1782b9d1a';
  const contract = 'CAZENAWYQTQJBADHR6PGQWE5S2DWZTYLAWGBY6RY7VVXZSJLYZLJEJJM';
  assert.deepEqual(parseSettlementRefs(`${hash}, ,${contract}`), [
    { ref: hash, kind: 'tx' },
    { ref: contract, kind: 'contract' },
  ]);
});

// ─── listUserSettlements ────────────────────────────────────────────
test('listUserSettlements: solo los servicios del user, orden DESC, limit, refs y net', async () => {
  const hash = '5cd7e1088ebbfdae0b4663cc538e24dd12eac584e78a196a8a369ea1782b9d1a';
  const userA = await createTestUser('a@kiba.test');
  const userB = await createTestUser('b@kiba.test');
  await seedAgent(userA, 'svc-a');
  await seedAgent(userB, 'svc-b');

  await seedSettlement('svc-a', 100000, { createdAt: 1000, signature: hash });
  await seedSettlement('svc-a', 50000, { createdAt: 2000, status: 'pending', signature: null });
  await seedSettlement('svc-b', 77777, { createdAt: 3000, signature: hash });

  const rows = await listUserSettlements(userA, 50);
  // Solo svc-a (2), no svc-b.
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.service === 'svc-a'));
  // Orden DESC por created_at.
  assert.equal(rows[0].created_at, 2000);
  assert.equal(rows[1].created_at, 1000);
  // net = gross * 0.95 (floor); usd chain-aware.
  const settled = rows[1];
  assert.equal(settled.amount_base_units, 100000);
  assert.equal(settled.net_base_units, 95000);
  assert.equal(settled.net_asset, 95000 / BASE_UNITS_PER_TOKEN);
  assert.equal(settled.net_usd, lamportsToUsd(95000));
  assert.deepEqual(settled.refs, [{ ref: hash, kind: 'tx' }]);
  // La 'pending' sin signature → refs vacío.
  assert.deepEqual(rows[0].refs, []);
  assert.equal(rows[0].status, 'pending');

  // limit respeta.
  const one = await listUserSettlements(userA, 1);
  assert.equal(one.length, 1);
  assert.equal(one[0].created_at, 2000);
});

// ─── servicesToAutoSettle (gate del cron por opt-in) ────────────────
test('servicesToAutoSettle: solo servicios de owners con auto_settle=1 y acumulado pendiente', async () => {
  const userOn = await createTestUser('on@kiba.test');
  const userOff = await createTestUser('off@kiba.test');
  await setAutoSettleFlag(userOn, true);
  await setAutoSettleFlag(userOff, false);
  await seedAgent(userOn, 'svc-on');
  await seedAgent(userOff, 'svc-off');
  // Pendiente en ambos, pero solo el opt-in debe salir.
  await seedEarning('svc-on', 50000);
  await seedEarning('svc-off', 50000);
  // Servicio del opt-in pero ya liquidado (sin pendiente) → excluido.
  await seedAgent(userOn, 'svc-on-settled');
  await seedEarning('svc-on-settled', 50000, { settlementId: 1, settledAt: 1 });

  const services = await servicesToAutoSettle();
  assert.deepEqual(services.sort(), ['svc-on']);
});

// ─── getDailySeries ─────────────────────────────────────────────────
test('getDailySeries: zero-fill, cutoff, formato UTC', async () => {
  const userA = await createTestUser('d@kiba.test');
  await seedAgent(userA, 'svc-a');
  const now = Math.floor(Date.now() / 1000);
  // Hoy: 2 earnings; hace 40 días: 1 earning (fuera de la ventana de 30).
  await seedEarning('svc-a', 10000, { createdAt: now });
  await seedEarning('svc-a', 20000, { createdAt: now });
  await seedEarning('svc-a', 99999, { createdAt: now - 40 * 86400 });

  const series = await getDailySeries(userA, 30);
  assert.equal(series.length, 30);
  // Orden ascendente + formato YYYY-MM-DD.
  for (const p of series) assert.match(p.day, /^\d{4}-\d{2}-\d{2}$/);
  for (let i = 1; i < series.length; i++) assert.ok(series[i].day > series[i - 1].day);

  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const todayPoint = series[series.length - 1];
  assert.equal(todayPoint.day, today);
  assert.equal(todayPoint.calls, 2);
  assert.equal(todayPoint.earnedBaseUnits, netBaseUnits(30000)); // 28500

  // El total de calls de la serie NO incluye el earning de hace 40 días.
  const totalCalls = series.reduce((s, p) => s + p.calls, 0);
  assert.equal(totalCalls, 2);
});
