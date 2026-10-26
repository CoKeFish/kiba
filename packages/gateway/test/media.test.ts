import './_setup-env';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMediaSearchCache, searchMedia, type MediaSearchDeps } from '../src/media';

const item = (id: string, priceUsd: number, type = 'audio') => ({
  id,
  title: `Título ${id}`,
  type,
  tags: ['lofi'],
  priceUsd,
  previewUrl: `http://x/p/${id}`,
  terms: { name: 'commercial', attribution: false, user: ['commercial'] },
});

function deps(responses: Record<string, { status: number; data?: unknown } | Error>): MediaSearchDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listAgents: async () => [
      { service: 'cat-a', endpoint: 'http://a/' },
      { service: 'cat-b', endpoint: 'http://b' },
      { service: 'world-clock', endpoint: 'http://clock' },
      { service: 'sin-endpoint' },
    ],
    fetchJson: async (url) => {
      calls.push(url);
      const r = responses[url];
      if (!r) return { status: 404, data: null };
      if (r instanceof Error) throw r;
      return { status: r.status, data: r.data };
    },
  };
}

beforeEach(() => resetMediaSearchCache());

test('searchMedia: intercala catálogos, normaliza, filtra por precio y limita', async () => {
  const d = deps({
    'http://a/catalog/search': { status: 200, data: { service: 'cat-a', items: [item('a1', 0.05), item('a2', 0.5), { basura: true }] } },
    'http://b/catalog/search': { status: 200, data: { items: [item('b1', 0.1, 'image')] } },
    'http://clock/catalog/search': { status: 404 },
  });
  const r = await searchMedia({ query: 'lofi', maxPriceUsd: 0.2, limit: 10 }, d);
  assert.equal(r.catalogsQueried, 3);
  assert.deepEqual(
    r.items.map((h) => [h.service, h.assetId, h.priceUsd]),
    [
      ['cat-a', 'a1', 0.05],
      ['cat-b', 'b1', 0.1],
    ],
  );
  assert.equal(r.items[0].title, 'Título a1');
  assert.deepEqual(r.items[0].license, { name: 'commercial', attribution: false, user: ['commercial'] });
  assert.equal(r.items[1].type, 'image');
  assert.match(r.hint, /call_agent/);

  // El 404 se recuerda: la segunda búsqueda no vuelve a consultar al reloj.
  d.calls.length = 0;
  await searchMedia({ query: 'lofi' }, d);
  assert.deepEqual(d.calls.sort(), ['http://a/catalog/search', 'http://b/catalog/search']);
});

test('searchMedia: errores y respuestas raras no rompen la búsqueda', async () => {
  const d = deps({
    'http://a/catalog/search': new Error('timeout'),
    'http://b/catalog/search': { status: 200, data: { items: 'no-array' } },
    'http://clock/catalog/search': { status: 500, data: {} },
  });
  const r = await searchMedia({ query: 'x' }, d);
  assert.equal(r.count, 0);
  assert.match(r.hint, /No licensed media/);
});
