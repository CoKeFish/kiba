// Servicios que pagan servicios: una llamada que un servicio hace a otro mientras sirve la
// llamada de un usuario queda ligada a ella (parent_id) y el usuario la ve como subCall.
//
// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los módulos del gateway.
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb, pool } from '../src/db';
import { callAndStore, getResult, resolveParentCall, subCallsDto, subCallsField } from '../src/results';
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
      `INSERT INTO users (email, password_hash, balance_lamports, created_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', 0, now);
  return Number(result.lastInsertRowid);
}

type CallArgs = Parameters<typeof callOnBehalf>[0];

/** Stub de callOnBehalf: responde `result` tras `ms` y guarda los args recibidos. */
function fakeCall(ms: number, result: unknown, seen: CallArgs[] = [], lamports = 1234): typeof callOnBehalf {
  return (async (a: CallArgs) => {
    seen.push(a);
    await new Promise((r) => setTimeout(r, ms));
    return {
      result,
      cost: { lamports, usd: lamports / 1e7 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: ms, steps: [] },
      explorerUrl: `https://stellar.expert/tx/${lamports}`,
    };
  }) as unknown as typeof callOnBehalf;
}

test('callAndStore entrega al servicio el id de la llamada (callId)', async () => {
  const userId = await createTestUser('callid@test.com');
  const seen: CallArgs[] = [];
  const out = await callAndStore({ userId, service: 'web-brief', payload: { url: 'x' }, waitMs: 1000 }, fakeCall(5, { ok: 1 }, seen));
  assert.equal(out.status, 'done');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].callId, out.resultId);
});

test('resolveParentCall: solo acepta una llamada existente y en curso', async () => {
  const userId = await createTestUser('parent@test.com');
  assert.equal(await resolveParentCall(undefined), null);
  assert.equal(await resolveParentCall('res_nope'), null);
  assert.equal(await resolveParentCall('res_000000000000000000000000'), null);

  // Padre lento: la respuesta vuelve 'pending' y la fila sigue en curso.
  const pending = await callAndStore({ userId, service: 'web-brief', payload: {}, waitMs: 20 }, fakeCall(300, { ok: 1 }));
  assert.equal(pending.status, 'pending');
  assert.equal(await resolveParentCall(pending.resultId), pending.resultId);

  // Cuando termina, ya no admite hijas.
  const done = await getResult(userId, pending.resultId, 2000);
  assert.equal(done?.status, 'done');
  assert.equal(await resolveParentCall(pending.resultId), null);
});

test('la llamada hija queda ligada a la padre y el usuario la ve como subCall', async () => {
  const user = await createTestUser('user@test.com');
  const publisher = await createTestUser('publisher@test.com');

  const parent = await callAndStore({ userId: user, service: 'web-brief', payload: { url: 'x' }, waitMs: 20 }, fakeCall(400, { brief: '…' }));
  assert.equal(parent.status, 'pending');

  // El servicio (cuenta del publicador) paga a dos proveedores mientras sirve la llamada.
  const parentId = await resolveParentCall(parent.resultId);
  const a = await callAndStore(
    { userId: publisher, service: 'web-scraper', payload: { url: 'x' }, waitMs: 1000, parentId },
    fakeCall(5, { markdown: '# hola' }, [], 100_000),
  );
  const b = await callAndStore(
    { userId: publisher, service: 'translator-pro', payload: { text: 'hola' }, waitMs: 1000, parentId },
    fakeCall(5, { translated: 'hello' }, [], 20_000),
  );
  assert.equal(a.status, 'done');
  assert.equal(b.status, 'done');

  const rowA = await getResult(publisher, a.resultId);
  assert.equal(rowA?.parent_id, parent.resultId);

  const subs = await subCallsDto(parent.resultId);
  assert.equal(subs.length, 2);
  // Las dos hijas nacen en el mismo segundo: el orden entre ellas no importa aquí.
  const byService = [...subs].sort((x, y) => x.service.localeCompare(y.service));
  assert.deepEqual(
    byService.map((s) => [s.service, s.costBaseUnits, s.explorerUrl]),
    [
      ['translator-pro', 20_000, 'https://stellar.expert/tx/20000'],
      ['web-scraper', 100_000, 'https://stellar.expert/tx/100000'],
    ],
  );
  assert.equal(byService[1].costUsd, 0.01);
  // Sin cuerpos: los payloads y resultados son de la cuenta del servicio, no del usuario.
  assert.equal('payload' in subs[0], false);
  assert.equal('result' in subs[0], false);

  // Una llamada sin hijas no lleva el campo.
  assert.deepEqual(await subCallsField(a.resultId), {});

  // El padre termina antes de cerrar la suite (su tarea sigue en vuelo).
  const finished = await getResult(user, parent.resultId, 2000);
  assert.equal(finished?.status, 'done');
});

test('la respuesta done del padre trae subCalls cuando el servicio pagó a otros', async () => {
  const user = await createTestUser('user2@test.com');
  const publisher = await createTestUser('publisher2@test.com');

  // El "servicio": mientras sirve, llama a otro servicio con su propia cuenta y el callId recibido.
  const serviceCall = (async (a: CallArgs) => {
    const parentId = await resolveParentCall(a.callId);
    assert.equal(parentId, a.callId);
    await callAndStore(
      { userId: publisher, service: 'world-clock', payload: { zone: 'Bogotá' }, waitMs: 1000, parentId },
      fakeCall(5, { now: [] }, [], 5_000),
    );
    return {
      result: { brief: 'listo' },
      cost: { lamports: 300_000, usd: 0.03 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
    };
  }) as unknown as typeof callOnBehalf;

  const out = await callAndStore({ userId: user, service: 'web-brief', payload: { url: 'x' }, waitMs: 2000 }, serviceCall);
  assert.equal(out.status, 'done');
  if (out.status !== 'done') return;
  assert.equal(out.subCalls?.length, 1);
  assert.equal(out.subCalls?.[0].service, 'world-clock');
  assert.equal(out.subCalls?.[0].costBaseUnits, 5_000);
});
