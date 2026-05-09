import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryDb, upsertAgent, type AgentRecord } from '../src/db';
import { searchKeyword, searchHybrid, search } from '../src/search';
import { _resetForTests } from '../src/embeddings';

const now = Math.floor(Date.now() / 1000);

function fixture(over: Partial<AgentRecord>): AgentRecord {
  return {
    pda: 'pda',
    service: 'svc',
    owner_wallet: 'w',
    price_per_call: 1_000_000,
    endpoint: 'http://x',
    description: '',
    total_calls: 0,
    total_earned: 0,
    created_at: now,
    updated_at: now,
    source: 'chain',
    deleted: 0,
    ...over,
  };
}

before(() => {
  // Embeddings desactivado para que no intente cargar el modelo en tests
  _resetForTests({ enabled: false, ready: false });
});

test('searchKeyword devuelve scores normalizados [0,1]', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'translator', description: 'translate text in many languages' }));
  upsertAgent(db, fixture({ pda: 'b', service: 'image-gen', description: 'image generation' }));
  upsertAgent(db, fixture({ pda: 'c', service: 'risk-auditor', description: 'audit smart contracts' }));

  const hits = await searchKeyword(db, 'translate languages', 10);
  assert.ok(hits.length >= 1);
  for (const h of hits) {
    assert.ok(h.score >= 0 && h.score <= 1, `score ${h.score} fuera de rango`);
    assert.equal(h.matchType, 'keyword');
  }
  // El más relevante debería ser translator
  assert.equal(hits[0].agent.service, 'translator');
});

test('searchKeyword sin matches devuelve []', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator', description: 'translate text' }));
  const hits = await searchKeyword(db, 'xyz123nomatch', 10);
  assert.deepEqual(hits, []);
});

test('searchHybrid sin embeddings cae a keyword puro', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'translator', description: 'translates text and documents' }));
  upsertAgent(db, fixture({ pda: 'b', service: 'risk-auditor', description: 'audits smart contracts' }));

  const hits = await searchHybrid(db, 'translates documents', 10);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].agent.service, 'translator');
  // matchType debe ser keyword (no hybrid) cuando no hay semántico
  assert.equal(hits[0].matchType, 'keyword');
});

test('search sin query devuelve listado por reputación', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'low', total_calls: 1 }));
  upsertAgent(db, fixture({ pda: 'b', service: 'high', total_calls: 100 }));
  const hits = await search(db, {});
  assert.equal(hits.length, 2);
  assert.equal(hits[0].agent.service, 'high');
});

test('search respeta limit', async () => {
  const db = createInMemoryDb();
  for (let i = 0; i < 10; i++) {
    upsertAgent(db, fixture({ pda: `p${i}`, service: `svc${i}`, description: 'common keyword' }));
  }
  const hits = await search(db, { q: 'common', mode: 'keyword', limit: 3 });
  assert.equal(hits.length, 3);
});

test('search clampa limit a [1, 100]', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'a' }));
  const tooMany = await search(db, { q: 'a', mode: 'keyword', limit: 9999 });
  // No throws — el clamp asegura que no rompa
  assert.ok(tooMany.length <= 100);
  const tooFew = await search(db, { q: 'a', mode: 'keyword', limit: 0 });
  assert.ok(tooFew.length <= 1);
});

test('search results vienen ordenados por score descendente', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ pda: 'a', service: 'a', description: 'translation only' }));
  upsertAgent(db, fixture({ pda: 'b', service: 'b', description: 'translation translation translation' }));
  upsertAgent(db, fixture({ pda: 'c', service: 'c', description: 'unrelated' }));
  const hits = await search(db, { q: 'translation', mode: 'keyword', limit: 10 });
  for (let i = 1; i < hits.length; i++) {
    assert.ok(
      hits[i - 1].score >= hits[i].score,
      `orden roto en posición ${i}: ${hits[i - 1].score} < ${hits[i].score}`,
    );
  }
});

test('search mode semantic sin embeddings devuelve []', async () => {
  const db = createInMemoryDb();
  upsertAgent(db, fixture({ service: 'translator', description: 'translates' }));
  const hits = await search(db, { q: 'translates', mode: 'semantic', limit: 5 });
  assert.deepEqual(hits, [], 'sin embeddings, semantic puro no retorna nada');
});
