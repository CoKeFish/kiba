// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb, pool } from '../src/db';
import {
  callAndStore,
  failOrphanedResults,
  getResult,
  listResults,
  relatedResults,
} from '../src/results';
import type { callOnBehalf } from '../src/proxy';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

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

/** Stub de callOnBehalf que responde `result` tras `ms` (o falla con `fail`). */
function fakeCall(ms: number, result: unknown, fail?: string): typeof callOnBehalf {
  return (async () => {
    await new Promise((r) => setTimeout(r, ms));
    if (fail) throw new Error(fail);
    return {
      result,
      cost: { lamports: 1234, usd: 0.01 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: ms, steps: [] },
      explorerUrl: 'https://stellar.expert/tx/abc',
    };
  }) as unknown as typeof callOnBehalf;
}

test('callAndStore: llamada rápida devuelve el resultado y lo guarda', async () => {
  const userId = await createTestUser('fast@test.com');
  const out = await callAndStore(
    { userId, service: 'meshy', payload: { prompt: 'gato' }, waitMs: 1000 },
    fakeCall(10, { modelUrl: 'https://x/m.glb' }),
  );
  assert.equal(out.status, 'done');
  assert.match(out.resultId, /^res_[0-9a-f]{24}$/);
  assert.ok(out.resultUrl.endsWith(`/app/results/${out.resultId}`));
  const row = await getResult(userId, out.resultId);
  assert.equal(row?.status, 'done');
  assert.deepEqual(JSON.parse(row!.result!), { modelUrl: 'https://x/m.glb' });
  assert.deepEqual(JSON.parse(row!.payload), { prompt: 'gato' });
  assert.equal(row?.cost_lamports, 1234);
});

test('callAndStore: el link on-chain que llega después de responder queda en el resultado', async () => {
  const userId = await createTestUser('late-link@test.com');
  // Modo crédito: responde sin link y el fund per-call confirma más tarde.
  const call = (async (a: Parameters<typeof callOnBehalf>[0]) => {
    setTimeout(() => a.onExplorerUrl?.('https://stellar.expert/tx/late'), 80);
    return {
      result: { ok: true },
      cost: { lamports: 5000, usd: 0.0005 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
    };
  }) as unknown as typeof callOnBehalf;
  const out = await callAndStore({ userId, service: 'world-clock', payload: {}, waitMs: 1000 }, call);
  assert.equal(out.status, 'done');
  assert.equal(out.status === 'done' && out.explorerUrl, undefined);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await getResult(userId, out.resultId))?.explorer_url, 'https://stellar.expert/tx/late');
});

test('callAndStore: llamada lenta devuelve pending y el resultado se guarda después', async () => {
  const userId = await createTestUser('slow@test.com');
  const out = await callAndStore(
    { userId, service: 'lyria', payload: {}, waitMs: 50 },
    fakeCall(300, { audioUrl: 'https://x/a.mp3' }),
  );
  assert.equal(out.status, 'pending');
  assert.equal((await getResult(userId, out.resultId))?.status, 'pending');
  // Long-poll: espera a que la llamada en vuelo termine.
  const row = await getResult(userId, out.resultId, 5000);
  assert.equal(row?.status, 'done');
  assert.deepEqual(JSON.parse(row!.result!), { audioUrl: 'https://x/a.mp3' });
});

test('callAndStore: error del servicio se propaga y queda guardado', async () => {
  const userId = await createTestUser('err@test.com');
  await assert.rejects(
    callAndStore({ userId, service: 'x', payload: {}, waitMs: 1000 }, fakeCall(5, null, 'boom')),
    /boom/,
  );
  const [row] = await listResults(userId);
  assert.equal(row.status, 'error');
  assert.equal(row.error, 'boom');
});

test('getResult/listResults: solo ve los resultados de su cuenta', async () => {
  const a = await createTestUser('a@test.com');
  const b = await createTestUser('b@test.com');
  const out = await callAndStore({ userId: a, service: 'x', payload: {}, waitMs: 1000 }, fakeCall(1, 1));
  assert.equal(await getResult(b, out.resultId), null);
  assert.equal((await listResults(b)).length, 0);
  assert.equal((await listResults(a)).length, 1);
});

test('failOrphanedResults: marca como error lo que quedó pending de un proceso anterior', async () => {
  const userId = await createTestUser('orphan@test.com');
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`INSERT INTO call_results (id, user_id, service, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run('res_orphan', userId, 'x', '{}', now);
  await failOrphanedResults();
  const row = await getResult(userId, 'res_orphan');
  assert.equal(row?.status, 'error');
  assert.match(row!.error!, /reinici/);
});

test('relatedResults: crear → consultar con el mismo taskId quedan en el mismo pedido', async () => {
  const userId = await createTestUser('task@test.com');
  const created = await callAndStore(
    { userId, service: 'meshy', payload: { prompt: 'gato' }, waitMs: 1000 },
    fakeCall(1, { taskId: 't-1', status: 'IN_PROGRESS', progress: 10, done: false }),
  );
  const polled = await callAndStore(
    { userId, service: 'meshy', payload: { taskId: 't-1' }, waitMs: 1000 },
    fakeCall(1, { taskId: 't-1', status: 'SUCCEEDED', progress: 100, done: true }),
  );
  await callAndStore(
    { userId, service: 'meshy', payload: { prompt: 'perro' }, waitMs: 1000 },
    fakeCall(1, { taskId: 't-2', status: 'IN_PROGRESS', done: false }),
  );
  const row = await getResult(userId, created.resultId);
  const related = await relatedResults(row!);
  assert.deepEqual(related.map((r) => r.id), [polled.resultId]);
});
