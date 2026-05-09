import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInMemoryDb,
  upsertAgent,
  setAgentEmbedding,
  markDeleted,
  getAgentByService,
  listAgents,
  listAgentsWithEmbeddings,
  countAgents,
  searchKeywordRaw,
  type AgentRecord,
} from '../src/db';

const now = Math.floor(Date.now() / 1000);

function fixture(over: Partial<AgentRecord>): AgentRecord {
  return {
    pda: 'pda1',
    service: 'service1',
    owner_wallet: 'wallet1',
    price_per_call: 1_000_000,
    endpoint: 'http://test:5000',
    description: 'sample agent',
    total_calls: 0,
    total_earned: 0,
    created_at: now,
    updated_at: now,
    source: 'chain',
    deleted: 0,
    ...over,
  };
}

test('upsertAgent inserta una nueva fila', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'p1', service: 'translator' }));
  assert.equal(countAgents(db), 1);
  const got = getAgentByService(db, 'translator');
  assert.ok(got);
  assert.equal(got?.service, 'translator');
});

test('upsertAgent actualiza si el service ya existe', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator', description: 'v1' }));
  upsertAgent(db, fixture({ service: 'translator', description: 'v2', total_calls: 5 }));
  const got = getAgentByService(db, 'translator');
  assert.equal(got?.description, 'v2');
  assert.equal(got?.total_calls, 5);
  assert.equal(countAgents(db), 1, 'no debe duplicar');
});

test('markDeleted oculta el agente de los queries normales', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator' }));
  markDeleted(db, 'translator');
  assert.equal(getAgentByService(db, 'translator'), null);
  assert.equal(countAgents(db), 0);
});

test('upsert tras markDeleted lo resucita', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator' }));
  markDeleted(db, 'translator');
  upsertAgent(db, fixture({ service: 'translator', description: 'back' }));
  const got = getAgentByService(db, 'translator');
  assert.equal(got?.deleted, 0);
  assert.equal(got?.description, 'back');
});

test('listAgents ordena por total_calls DESC', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'low', total_calls: 1 }));
  upsertAgent(db, fixture({ pda: 'b', service: 'high', total_calls: 100 }));
  upsertAgent(db, fixture({ pda: 'c', service: 'mid', total_calls: 10 }));
  const list = listAgents(db);
  assert.deepEqual(
    list.map((a) => a.service),
    ['high', 'mid', 'low'],
  );
});

test('setAgentEmbedding guarda el blob y listAgentsWithEmbeddings lo recupera', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator' }));
  const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  setAgentEmbedding(db, 'translator', vec);
  const got = listAgentsWithEmbeddings(db);
  assert.equal(got.length, 1);
  assert.equal(got[0].service, 'translator');
  assert.equal(got[0].embedding.length, 4);
  // Float32 introduce ruido en la 7ª cifra; comparar con tolerancia
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(got[0].embedding[i] - vec[i]) < 1e-6);
  }
});

test('FTS5 encuentra match exacto', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'yield-hunter', description: 'finds best APY in DeFi' }));
  upsertAgent(db, fixture({ pda: 'b', service: 'risk-auditor', description: 'analyzes smart contracts' }));
  const hits = searchKeywordRaw(db, 'APY', 10);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].service, 'yield-hunter');
});

test('FTS5 rankea mejor el match más relevante', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'translator', description: 'translates text from many languages' }));
  upsertAgent(db, fixture({ pda: 'b', service: 'image-gen', description: 'generates images, sometimes with text overlay' }));
  const hits = searchKeywordRaw(db, 'translates languages', 10);
  assert.equal(hits[0].service, 'translator');
});

test('FTS5 sanitiza caracteres raros sin throw', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator', description: 'agente de traducciones' }));
  // Ningún query debería tirar excepción
  assert.doesNotThrow(() => searchKeywordRaw(db, '!!!"@#"', 5));
  assert.doesNotThrow(() => searchKeywordRaw(db, '', 5));
  assert.doesNotThrow(() => searchKeywordRaw(db, 'á é í ñ', 5));
});

test('FTS5 es case-insensitive y maneja diacríticos', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'traduccion', description: 'Traduce documentos del inglés al español' }));
  const hits1 = searchKeywordRaw(db, 'INGLES', 10);
  const hits2 = searchKeywordRaw(db, 'ingles', 10);
  assert.ok(hits1.length > 0, 'mayúsculas debería matchear');
  assert.ok(hits2.length > 0, 'sin diacrítico debería matchear (remove_diacritics=2)');
});

test('FTS5 query vacío devuelve []', () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'a' }));
  assert.deepEqual(searchKeywordRaw(db, '', 10), []);
});
