/**
 * Tests del agente Firecrawl. El agente es, en el fondo, un wrapper sobre la API v2
 * de Firecrawl, así que probamos las tres cosas que pueden romperse:
 *
 *   1. Construcción del request (buildScrapeBody): sinónimos, formats, json, defaults.
 *   2. El wrapper completo (scrape) contra un Firecrawl FALSO local → verifica el
 *      mapeo de la respuesta, el header de auth (con/sin key) y el camino de error.
 *      Determinista, sin red.
 *   3. Un smoke REAL contra api.firecrawl.dev (free tier, sin key). Se salta solo si
 *      Firecrawl no está alcanzable, para no romper CI por red.
 *
 * Correr:  npm test            (dentro de packages/demo-agents)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildScrapeBody,
  normalizeFormats,
  wantsExtraction,
  priceFor,
  scrape,
  PRICE_SCRAPE_USDC,
  PRICE_EXTRACT_USDC,
  type ScrapeConfig,
} from '../src/firecrawl-core';

const TIMEOUT = 5_000;

// ─── 1. buildScrapeBody / normalizeFormats / pricing (puro) ───────────────────

test('buildScrapeBody: exige url y acepta sinónimos', () => {
  assert.throws(() => buildScrapeBody({}, TIMEOUT), /missing 'url'/);
  for (const key of ['url', 'link', 'page', 'website', 'target']) {
    const { url } = buildScrapeBody({ [key]: 'https://x.com' } as never, TIMEOUT);
    assert.equal(url, 'https://x.com', `sinónimo ${key}`);
  }
  // recorta espacios
  assert.equal(buildScrapeBody({ url: '  https://x.com  ' }, TIMEOUT).url, 'https://x.com');
});

test('buildScrapeBody: garantiza markdown y pasa defaults', () => {
  const { body } = buildScrapeBody({ url: 'https://x.com' }, TIMEOUT);
  assert.deepEqual(body.formats, ['markdown']);
  assert.equal(body.onlyMainContent, true);
  assert.equal(body.timeout, TIMEOUT);
  assert.equal(body.url, 'https://x.com');
  assert.equal(body.proxy, 'stealth'); // default nuevo: el agente apunta a páginas con anti-bot
});

test('buildScrapeBody: prompt sin formats → SOLO json (sin markdown, respuesta compacta)', () => {
  const { body } = buildScrapeBody({ url: 'https://x.com', prompt: 'extrae el precio' }, TIMEOUT);
  const formats = body.formats as Array<unknown>;
  assert.ok(!formats.includes('markdown'), 'no trae markdown en extracción (evita respuestas gigantes)');
  assert.equal(formats.length, 1, 'solo el bloque json');
  const json = formats.find((f) => typeof f === 'object' && (f as { type?: string }).type === 'json');
  assert.deepEqual(json, { type: 'json', prompt: 'extrae el precio' });
});

test('buildScrapeBody: prompt + markdown explícito → trae ambos', () => {
  const { body } = buildScrapeBody(
    { url: 'https://x.com', prompt: 'precio', formats: ['markdown'] } as never,
    TIMEOUT,
  );
  const formats = body.formats as Array<unknown>;
  assert.ok(formats.includes('markdown'), 'markdown explícito se respeta');
  assert.ok(formats.some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json'));
});

test('buildScrapeBody: schema y sinónimos de prompt entran al bloque json', () => {
  const schema = { type: 'object', properties: { price: { type: 'number' } } };
  const { body } = buildScrapeBody({ url: 'https://x.com', query: 'precio', schema }, TIMEOUT);
  const formats = body.formats as Array<unknown>;
  const json = formats.find((f) => typeof f === 'object') as { type: string; prompt: string; schema: unknown };
  assert.equal(json.type, 'json');
  assert.equal(json.prompt, 'precio'); // 'query' es sinónimo de prompt
  assert.deepEqual(json.schema, schema);
});

test('buildScrapeBody: formats como string CSV y normalización de rawhtml', () => {
  const { body } = buildScrapeBody({ url: 'https://x.com', formats: 'links, RawHtml' } as never, TIMEOUT);
  const formats = body.formats as string[];
  assert.ok(formats.includes('links'));
  assert.ok(formats.includes('rawHtml'), 'rawhtml → rawHtml (camelCase de Firecrawl)');
  assert.ok(formats.includes('markdown'), 'markdown se antepone siempre');
});

test('buildScrapeBody: passthrough de proxy/waitFor/location y validación', () => {
  const ok = buildScrapeBody(
    { url: 'https://x.com', proxy: 'stealth', waitFor: 3000, country: 'co' },
    TIMEOUT,
  ).body;
  assert.equal(ok.proxy, 'stealth');
  assert.equal(ok.waitFor, 3000);
  assert.deepEqual(ok.location, { country: 'CO' }); // se normaliza a mayúsculas

  // waitFor inválido se descarta; proxy inválido cae al default 'stealth'
  const bad = buildScrapeBody(
    { url: 'https://x.com', proxy: 'hacker' as never, waitFor: -5 },
    TIMEOUT,
  ).body;
  assert.equal(bad.proxy, 'stealth');
  assert.equal(bad.waitFor, undefined);
});

test('normalizeFormats: array, csv y basura', () => {
  assert.deepEqual(normalizeFormats(['JSON', ' Links ']), ['json', 'links']);
  assert.deepEqual(normalizeFormats('markdown, json'), ['markdown', 'json']);
  assert.deepEqual(normalizeFormats(undefined), []);
  assert.deepEqual(normalizeFormats(42), []);
});

test('wantsExtraction / priceFor: scrape plano vs extracción', () => {
  assert.equal(wantsExtraction({ url: 'https://x.com' }), false);
  assert.equal(priceFor({ url: 'https://x.com' }), PRICE_SCRAPE_USDC);

  for (const req of [
    { url: 'https://x.com', prompt: 'precio' },
    { url: 'https://x.com', schema: {} },
    { url: 'https://x.com', formats: ['json'] },
    { url: 'https://x.com', formats: 'product' },
  ]) {
    assert.equal(wantsExtraction(req as never), true, JSON.stringify(req));
    assert.equal(priceFor(req as never), PRICE_EXTRACT_USDC);
  }
});

// ─── 2. scrape() contra un Firecrawl FALSO (determinista, sin red) ────────────

/** Levanta un stub HTTP que imita /v2/scrape; captura el último request recibido. */
async function withFakeFirecrawl(
  respond: (body: Record<string, unknown>) => { status: number; json: unknown },
  run: (config: ScrapeConfig, seen: { body?: Record<string, unknown>; auth?: string }) => Promise<void>,
): Promise<void> {
  const seen: { body?: Record<string, unknown>; auth?: string } = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.body = JSON.parse(raw || '{}');
      seen.auth = req.headers.authorization;
      assert.equal(req.url, '/v2/scrape', 'el wrapper debe pegarle a /v2/scrape');
      const { status, json } = respond(seen.body!);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await run({ apiKey: '', baseUrl: `http://127.0.0.1:${port}`, timeoutMs: TIMEOUT }, seen);
  } finally {
    server.close();
  }
}

test('scrape: mapea data.json→extracted, product, links, markdown, metadata', async () => {
  await withFakeFirecrawl(
    () => ({
      status: 200,
      json: {
        success: true,
        data: {
          markdown: '# Hola',
          json: { price: 9.99, title: 'Auriculares' },
          product: { title: 'Auriculares', price: '9.99' },
          links: ['https://x.com/a'],
          metadata: { statusCode: 200 },
        },
      },
    }),
    async (config) => {
      const out = await scrape(config, { url: 'https://x.com', prompt: 'precio' });
      assert.equal(out.url, 'https://x.com');
      assert.equal(out.markdown, '# Hola');
      assert.deepEqual(out.extracted, { price: 9.99, title: 'Auriculares' });
      assert.deepEqual(out.product, { title: 'Auriculares', price: '9.99' });
      assert.deepEqual(out.links, ['https://x.com/a']);
      assert.deepEqual(out.metadata, { statusCode: 200 });
      assert.equal(typeof out.scrapedAt, 'number');
    },
  );
});

test('scrape: trunca markdown enorme (protege al cliente MCP)', async () => {
  const big = 'x'.repeat(30_000);
  await withFakeFirecrawl(
    () => ({ status: 200, json: { success: true, data: { markdown: big } } }),
    async (config) => {
      const out = await scrape(config, { url: 'https://x.com' });
      assert.ok((out.markdown as string).length < big.length, 'se truncó');
      assert.match(String(out.markdown), /truncado/);
    },
  );
});

test('scrape: SIN key no manda Authorization; CON key manda Bearer', async () => {
  const okResp = () => ({ status: 200, json: { success: true, data: { markdown: 'x' } } });

  await withFakeFirecrawl(okResp, async (config, seen) => {
    await scrape(config, { url: 'https://x.com' });
    assert.equal(seen.auth, undefined, 'sin key → sin header de auth (free tier)');
  });

  await withFakeFirecrawl(okResp, async (config, seen) => {
    await scrape({ ...config, apiKey: 'fc-test-123' }, { url: 'https://x.com' });
    assert.equal(seen.auth, 'Bearer fc-test-123', 'con key → Bearer');
  });
});

test('scrape: propaga el error de Firecrawl (success:false)', async () => {
  await withFakeFirecrawl(
    () => ({ status: 400, json: { success: false, error: 'Invalid URL', details: { code: 'BAD' } } }),
    async (config) => {
      await assert.rejects(
        () => scrape(config, { url: 'https://x.com' }),
        /Firecrawl 400: Invalid URL/,
      );
    },
  );
});

test('scrape: respuesta 200 sin data → error claro', async () => {
  await withFakeFirecrawl(
    () => ({ status: 200, json: { success: true } }),
    async (config) => {
      await assert.rejects(() => scrape(config, { url: 'https://x.com' }), /sin data/);
    },
  );
});

// ─── 3. Smoke REAL contra api.firecrawl.dev (free tier, sin key) ──────────────

test('live: scrape real de example.com (free tier, se salta si no hay red)', async (t) => {
  const config: ScrapeConfig = { apiKey: '', baseUrl: 'https://api.firecrawl.dev', timeoutMs: 45_000 };
  let out;
  try {
    out = await scrape(config, { url: 'https://example.com', formats: ['markdown'], proxy: 'basic' });
  } catch (err) {
    t.skip(`Firecrawl no alcanzable / rate-limited: ${(err as Error).message}`);
    return;
  }
  assert.equal(out.url, 'https://example.com');
  assert.match(String(out.markdown), /Example Domain/i);
  assert.equal((out.metadata as { statusCode?: number }).statusCode, 200);
});
