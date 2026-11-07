/**
 * Tests del agente Firecrawl. El agente es, en el fondo, un wrapper sobre la API v2
 * de Firecrawl más un control de calidad propio, así que probamos:
 *
 *   1. Construcción del request (buildScrapeBody): sinónimos, formats, json con guarda,
 *      defaults, espera por dominio.
 *   2. Control de calidad puro: detección de páginas vacías y contraste de lo extraído
 *      con el contenido descargado.
 *   3. El wrapper completo (scrape) contra un Firecrawl FALSO local → mapeo de la respuesta,
 *      auth, extracción en dos pasos, reintento con espera y errores claros. Determinista, sin red.
 *   4. Un smoke REAL contra api.firecrawl.dev (free tier, sin key). Se salta solo si
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
  defaultWaitFor,
  contentStats,
  isEmptyContent,
  verifyExtracted,
  describeFirecrawlError,
  PRICE_SCRAPE_USDC,
  PRICE_EXTRACT_USDC,
  NO_INVENT_GUARD,
  RETRY_WAIT_FOR_MS,
  DEFAULT_WAIT_FOR_MS,
  type ScrapeConfig,
} from '../src/firecrawl-core';

const TIMEOUT = 5_000;
const YT_SEARCH = 'https://www.youtube.com/results?search_query=Barenaked+Ladies+History+of+Everything';
/** Página con texto suficiente para no contar como vacía. */
const PAGE = 'Este artículo explica cómo funciona el producto, su precio y su disponibilidad en tienda. '.repeat(3);
/** Lo que Firecrawl devuelve de una búsqueda de YouTube sin esperar al JavaScript: solo menú y pie. */
const YT_NAV_MD =
  '[YouTube](https://www.youtube.com/ "YouTube")[YouTube](https://www.youtube.com/ "YouTube")\n\n' +
  '[About](https://www.youtube.com/about/) [Press](https://www.youtube.com/about/press/) [Copyright](https://www.youtube.com/about/copyright/) ' +
  '[Contact us](https://www.youtube.com/t/contact_us/) [Creators](https://www.youtube.com/creators/) [Advertise](https://www.youtube.com/ads/) ' +
  '[Developers](https://developers.google.com/youtube) [Terms](https://www.youtube.com/t/terms) [Privacy](https://www.youtube.com/t/privacy) ' +
  '[Policy & Safety](https://www.youtube.com/about/policies/) [How YouTube works](https://www.youtube.com/howyoutubeworks?utm_campaign=ytgen) ' +
  '[Test new features](https://www.youtube.com/new)\n\n© 2026 Google LLC';
/** Fragmento de ytInitialData tal como viene en el HTML crudo (escapes JSON incluidos). */
const YT_HTML =
  '<html><script>var ytInitialData = {"videoRenderer":{"videoId":"cHB0MlprWx8",' +
  '"title":{"runs":[{"text":"Barenaked Ladies - The History of Everything"}]},' +
  '"navigationEndpoint":{"commandMetadata":{"webCommandMetadata":{"url":"/watch?v=cHB0MlprWx8\\u0026pp=ygUsQmFyZW5ha2Vk"}}}}};</script></html>';

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
  const { body, extraction, waitForExplicit } = buildScrapeBody({ url: 'https://x.com' }, TIMEOUT);
  assert.deepEqual(body.formats, ['markdown']);
  assert.equal(body.onlyMainContent, true);
  assert.equal(body.timeout, TIMEOUT);
  assert.equal(body.url, 'https://x.com');
  assert.equal(body.proxy, 'stealth'); // default nuevo: el agente apunta a páginas con anti-bot
  assert.equal(body.waitFor, undefined, 'sin espera por defecto fuera de los dominios conocidos');
  assert.equal(extraction, false);
  assert.equal(waitForExplicit, false);
});

test('buildScrapeBody: prompt sin formats → SOLO json (sin markdown) con la guarda anti-invento', () => {
  const { body, extraction } = buildScrapeBody({ url: 'https://x.com', prompt: 'extrae el precio' }, TIMEOUT);
  const formats = body.formats as Array<unknown>;
  assert.ok(!formats.includes('markdown'), 'no trae markdown en extracción (evita respuestas gigantes)');
  assert.equal(formats.length, 1, 'solo el bloque json');
  const json = formats.find((f) => typeof f === 'object' && (f as { type?: string }).type === 'json') as {
    type: string;
    prompt: string;
  };
  assert.equal(json.type, 'json');
  assert.ok(json.prompt.startsWith('extrae el precio'), 'el prompt del usuario va primero');
  assert.ok(json.prompt.endsWith(NO_INVENT_GUARD), 'la guarda permite devolver vacío y prohíbe inventar');
  assert.equal(extraction, true);
});

test('buildScrapeBody: prompt + markdown → extracción gana, se quita markdown (respuesta compacta)', () => {
  const { body } = buildScrapeBody(
    { url: 'https://x.com', prompt: 'precio', formats: ['markdown'] } as never,
    TIMEOUT,
  );
  const formats = body.formats as Array<unknown>;
  assert.ok(!formats.includes('markdown'), 'en extracción se quita markdown aunque lo pidan');
  assert.ok(formats.some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json'));
});

test('buildScrapeBody: schema y sinónimos de prompt entran al bloque json', () => {
  const schema = { type: 'object', properties: { price: { type: 'number' } } };
  const { body } = buildScrapeBody({ url: 'https://x.com', query: 'precio', schema } as never, TIMEOUT);
  const formats = body.formats as Array<unknown>;
  const json = formats.find((f) => typeof f === 'object') as { type: string; prompt: string; schema: unknown };
  assert.equal(json.type, 'json');
  assert.ok(json.prompt.startsWith('precio')); // 'query' es sinónimo de prompt
  assert.deepEqual(json.schema, schema);

  // solo schema → el prompt es la guarda
  const onlySchema = buildScrapeBody({ url: 'https://x.com', schema }, TIMEOUT).body.formats as Array<{ prompt?: string }>;
  assert.equal(onlySchema[0].prompt, NO_INVENT_GUARD);
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
  );
  assert.equal(ok.body.proxy, 'stealth');
  assert.equal(ok.body.waitFor, 3000);
  assert.equal(ok.waitForExplicit, true);
  assert.deepEqual(ok.body.location, { country: 'CO' }); // se normaliza a mayúsculas

  // waitFor inválido se descarta; proxy inválido cae al default 'stealth'
  const bad = buildScrapeBody(
    { url: 'https://x.com', proxy: 'hacker' as never, waitFor: -5 },
    TIMEOUT,
  );
  assert.equal(bad.body.proxy, 'stealth');
  assert.equal(bad.body.waitFor, undefined);
  assert.equal(bad.waitForExplicit, false);
});

test('buildScrapeBody / defaultWaitFor: los sitios que pintan con JavaScript esperan por defecto', () => {
  assert.equal(defaultWaitFor(YT_SEARCH), DEFAULT_WAIT_FOR_MS['youtube.com']);
  assert.equal(defaultWaitFor('https://m.youtube.com/watch?v=x'), DEFAULT_WAIT_FOR_MS['youtube.com'], 'subdominio');
  assert.equal(defaultWaitFor('https://notyoutube.com/'), undefined, 'solo sufijo de host real');
  assert.equal(defaultWaitFor('no es una url'), undefined);

  const yt = buildScrapeBody({ url: YT_SEARCH }, TIMEOUT);
  assert.equal(yt.body.waitFor, DEFAULT_WAIT_FOR_MS['youtube.com']);
  assert.equal(yt.waitForExplicit, false, 'la espera por dominio no cuenta como explícita');
  // el caller manda
  assert.equal(buildScrapeBody({ url: YT_SEARCH, waitFor: 2000 }, TIMEOUT).body.waitFor, 2000);
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

// ─── 2. Control de calidad (puro) ─────────────────────────────────────────────

test('contentStats / isEmptyContent: menú y pie = vacío; artículo = contenido; índice de enlaces no es vacío', () => {
  const nav = contentStats(YT_NAV_MD);
  assert.ok(nav.plainChars < 40, `el menú de YouTube casi no tiene texto plano (${nav.plainChars})`);
  assert.equal(isEmptyContent(nav), true);

  assert.equal(isEmptyContent(contentStats(PAGE)), false);
  assert.equal(isEmptyContent(contentStats('# Something went wrong\n\n[YouTube home](https://www.youtube.com/)\n\nSearch')), true);
  assert.equal(isEmptyContent(contentStats(undefined)), true, 'sin markdown = vacío');

  // una página que es solo una lista larga de enlaces es un índice, no una página vacía
  const index = Array.from({ length: 40 }, (_, i) => `[item ${i}](https://x.com/${i})`).join('\n');
  assert.equal(isEmptyContent(contentStats(index)), false);

  // consentimiento / captcha
  const consent = contentStats('Before you continue to YouTube\n\nAccept all cookies\n\nReject all');
  assert.equal(consent.blocked, true);
  assert.equal(isEmptyContent(consent), true);
  // una página larga que solo menciona cookies no está bloqueada
  assert.equal(contentStats(PAGE.repeat(30) + ' accept all cookies').blocked, false);
});

test('verifyExtracted: descarta URLs y títulos inventados, conserva los reales (ytInitialData con escapes)', () => {
  const extracted = {
    videos: [
      { title: 'History of Everything (Studio Version)', channel: 'Topic', watchURL: 'https://www.youtube.com/watch?v=example1' },
      {
        title: 'Barenaked Ladies - The History of Everything',
        channel: 'dtunchel',
        watchURL: 'https://www.youtube.com/watch?v=cHB0MlprWx8&pp=ygUsQmFyZW5ha2Vk',
      },
      // misma URL sin el parámetro de tracking: el id de vídeo basta
      { title: 'The History of Everything', watchURL: 'https://www.youtube.com/watch?v=cHB0MlprWx8' },
    ],
    songs: [{ title: 'Canción inventada por la IA' }, { title: 'The History of Everything' }],
    related: 'https://www.youtube.com/watch?v=fake9999999',
    home: 'https://www.youtube.com/',
    count: 3,
  };
  const { value, verification } = verifyExtracted(extracted, `${YT_NAV_MD}\n${YT_HTML}`);
  const v = value as typeof extracted & { related: unknown };
  assert.equal(v.videos.length, 2, 'cae el vídeo con URL inventada');
  assert.ok(v.videos.every((x) => x.watchURL.includes('cHB0MlprWx8')));
  assert.deepEqual(
    v.songs.map((s) => s.title),
    ['The History of Everything'],
    'sin URL, manda el título: el inventado cae, el real (con puntuación distinta) queda',
  );
  assert.equal(v.related, null, 'fuera de listas, la URL ajena se anula');
  assert.equal(v.home, 'https://www.youtube.com/', 'URL literal del menú');
  assert.equal(v.count, 3, 'lo que no es URL ni título no se toca');
  assert.equal(verification.checked, 10, '3 títulos + 3 URLs en videos, 2 títulos en songs, 2 URLs sueltas');
  assert.deepEqual(
    verification.dropped.map((d) => d.value),
    ['https://www.youtube.com/watch?v=example1', 'Canción inventada por la IA', 'https://www.youtube.com/watch?v=fake9999999'],
  );
});

test('verifyExtracted: sin URLs ni títulos no toca nada; extracción vacía sigue vacía', () => {
  const { value, verification } = verifyExtracted({ price: 9.99, currency: 'USD' }, PAGE);
  assert.deepEqual(value, { price: 9.99, currency: 'USD' });
  assert.deepEqual(verification, { checked: 0, dropped: [] });
  assert.deepEqual(verifyExtracted({ videos: [] }, YT_NAV_MD).value, { videos: [] });
  assert.equal(verifyExtracted(undefined, PAGE).value, undefined);
});

test('describeFirecrawlError: traduce los códigos conocidos y conserva el resto', () => {
  const u = 'https://html.duckduckgo.com/html/?q=x';
  assert.match(describeFirecrawlError(500, { code: 'SCRAPE_ALL_ENGINES_FAILED', error: 'All scraping engines failed' }, u), /sitio bloqueado o inaccesible/);
  assert.match(describeFirecrawlError(403, { error: 'We apologize for the inconvenience but we do not support this site' }, u), /sitio no soportado/);
  assert.match(describeFirecrawlError(408, { error: 'Request timed out' }, u), /tiempo de espera/);
  assert.match(describeFirecrawlError(429, {}, u), /límite de peticiones/);
  assert.match(describeFirecrawlError(402, {}, u), /créditos/);
  assert.equal(describeFirecrawlError(400, { error: 'Invalid URL' }, u), 'Firecrawl 400: Invalid URL');
});

// ─── 3. scrape() contra un Firecrawl FALSO (determinista, sin red) ────────────

type Seen = { body?: Record<string, unknown>; bodies: Record<string, unknown>[]; auth?: string };

/** Levanta un stub HTTP que imita /v2/scrape; captura todos los requests recibidos. */
async function withFakeFirecrawl(
  respond: (body: Record<string, unknown>) => { status: number; json: unknown },
  run: (config: ScrapeConfig, seen: Seen) => Promise<void>,
): Promise<void> {
  const seen: Seen = { bodies: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.body = JSON.parse(raw || '{}');
      seen.bodies.push(seen.body!);
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

const ok = (data: Record<string, unknown>) => ({ status: 200, json: { success: true, data } });
const hasJsonFormat = (body: Record<string, unknown>) =>
  (body.formats as unknown[]).some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json');

test('scrape: mapea data.json→extracted, product, links, markdown, metadata', async () => {
  await withFakeFirecrawl(
    () =>
      ok({
        markdown: PAGE,
        json: { price: 9.99, title: 'Auriculares' },
        product: { title: 'Auriculares', price: '9.99' },
        links: ['https://x.com/a'],
        metadata: { statusCode: 200 },
      }),
    async (config) => {
      const out = await scrape(config, { url: 'https://x.com' });
      assert.equal(out.url, 'https://x.com');
      assert.equal(out.markdown, PAGE);
      assert.deepEqual(out.extracted, { price: 9.99, title: 'Auriculares' });
      assert.deepEqual(out.product, { title: 'Auriculares', price: '9.99' });
      assert.deepEqual(out.links, ['https://x.com/a']);
      assert.deepEqual(out.metadata, { statusCode: 200 });
      assert.equal(typeof out.scrapedAt, 'number');
      assert.equal(out.verification, undefined, 'sin extracción no hay contraste');
    },
  );
});

test('scrape: trunca markdown enorme (protege al cliente MCP)', async () => {
  const big = 'x'.repeat(30_000);
  await withFakeFirecrawl(
    () => ok({ markdown: big }),
    async (config) => {
      const out = await scrape(config, { url: 'https://x.com' });
      assert.ok((out.markdown as string).length < big.length, 'se truncó');
      assert.match(String(out.markdown), /truncado/);
    },
  );
});

test('scrape: extracción en dos pasos (contenido → json) y lo extraído se contrasta con la página', async () => {
  await withFakeFirecrawl(
    (body) =>
      hasJsonFormat(body)
        ? ok({
            json: {
              items: [
                { name: 'Auriculares X200', url: 'https://tienda.com/p/auriculares-x200', price: 9.99 },
                { name: 'Producto inventado', url: 'https://tienda.com/p/example', price: 1 },
              ],
              source: 'https://tienda.com/catalogo?cat=audio',
            },
            metadata: { statusCode: 200, creditsUsed: 5 },
          })
        : ok({
            markdown: `${PAGE} Auriculares X200 cuestan 9.99`,
            rawHtml: '<html><a href="/p/auriculares-x200">Auriculares X200</a></html>',
            metadata: { statusCode: 200, creditsUsed: 1 },
          }),
    async (config, seen) => {
      const out = await scrape(config, { url: 'https://tienda.com/catalogo?cat=audio', prompt: 'lista los productos', formats: ['markdown'] } as never);
      assert.equal(seen.bodies.length, 2, 'primero el contenido, luego la extracción');
      assert.deepEqual(seen.bodies[0].formats, ['markdown', 'rawHtml'], 'paso 1: contenido para contrastar');
      assert.ok(hasJsonFormat(seen.bodies[1]), 'paso 2: la extracción');
      assert.ok(!(seen.bodies[1].formats as unknown[]).includes('markdown'));

      const extracted = out.extracted as { items: unknown[]; source: unknown };
      assert.equal(extracted.items.length, 1, 'cae el producto con URL que no está en la página');
      assert.equal(extracted.source, 'https://tienda.com/catalogo?cat=audio', 'la URL pedida cuenta como presente');
      assert.equal(out.verification?.dropped.length, 1);
      assert.match(String(out.note), /descartado/);
      assert.equal(out.markdown, undefined, 'no markdown en extracción');
      assert.equal(out.metadata.creditsUsed, 5, 'la metadata es la de la extracción');
    },
  );
});

test('scrape: extracción sobre página vacía → reintenta con espera y NO la pasa a la IA', async () => {
  await withFakeFirecrawl(
    () => ok({ markdown: YT_NAV_MD, rawHtml: '<html></html>', metadata: { statusCode: 200 } }),
    async (config, seen) => {
      await assert.rejects(
        () => scrape(config, { url: 'https://x.com/app', prompt: 'lista los vídeos' }),
        /página sin contenido/,
      );
      assert.equal(seen.bodies.length, 2, 'un solo reintento');
      assert.equal(seen.bodies[0].waitFor, undefined);
      assert.equal(seen.bodies[1].waitFor, RETRY_WAIT_FOR_MS, 'el reintento da tiempo al JavaScript');
      assert.equal(seen.bodies[1].maxAge, 0, 'y no acepta la carga cacheada');
      assert.ok(seen.bodies.every((b) => !hasJsonFormat(b)), 'nunca se pidió la extracción');
    },
  );
});

test('scrape: en YouTube la espera va de entrada; si aun así llega vacía, un reintento fresco (sin caché)', async () => {
  await withFakeFirecrawl(
    () => ok({ markdown: YT_NAV_MD, metadata: { statusCode: 200 } }),
    async (config, seen) => {
      await assert.rejects(() => scrape(config, { url: YT_SEARCH }), /página sin contenido/);
      assert.equal(seen.bodies.length, 2);
      assert.equal(seen.bodies[0].waitFor, DEFAULT_WAIT_FOR_MS['youtube.com']);
      assert.equal(seen.bodies[0].maxAge, undefined, 'la primera carga puede venir de la caché de Firecrawl');
      assert.equal(seen.bodies[1].waitFor, DEFAULT_WAIT_FOR_MS['youtube.com'], 'misma espera');
      assert.equal(seen.bodies[1].maxAge, 0, 'el reintento fuerza una carga fresca');
    },
  );
});

test('scrape: markdown vacío → el reintento con espera trae el contenido', async () => {
  await withFakeFirecrawl(
    (body) => ok({ markdown: body.waitFor ? PAGE : YT_NAV_MD, metadata: { statusCode: 200 } }),
    async (config, seen) => {
      const out = await scrape(config, { url: 'https://x.com/app' });
      assert.equal(out.markdown, PAGE);
      assert.equal(seen.bodies.length, 2);
      assert.equal(seen.bodies[1].waitFor, RETRY_WAIT_FOR_MS);
    },
  );
});

test('scrape: la espera que trajo el contenido se repite en la extracción', async () => {
  await withFakeFirecrawl(
    (body) =>
      hasJsonFormat(body)
        ? ok({ json: { items: [] } })
        : ok({ markdown: body.waitFor ? PAGE : YT_NAV_MD, rawHtml: '' }),
    async (config, seen) => {
      const out = await scrape(config, { url: 'https://x.com/app', prompt: 'lista' });
      assert.deepEqual(out.extracted, { items: [] }, 'la IA puede responder "sin resultados"');
      assert.equal(seen.bodies.length, 3);
      assert.equal(seen.bodies[2].waitFor, RETRY_WAIT_FOR_MS);
    },
  );
});

test('scrape: pantalla de consentimiento o captcha → error claro (con waitFor explícito no reintenta)', async () => {
  await withFakeFirecrawl(
    () => ok({ markdown: 'Before you continue to YouTube\n\nAccept all cookies', metadata: { statusCode: 200 } }),
    async (config, seen) => {
      await assert.rejects(() => scrape(config, { url: 'https://x.com', waitFor: 1000 }), /consentimiento o captcha/);
      assert.equal(seen.bodies.length, 1);
    },
  );
});

test('scrape: el sitio respondió 404 / 403 sin contenido → error con la causa', async () => {
  await withFakeFirecrawl(
    () => ok({ markdown: '', metadata: { statusCode: 404 } }),
    async (config) => {
      await assert.rejects(() => scrape(config, { url: 'https://x.com/nada', waitFor: 1000 }), /página no encontrada/);
    },
  );
  await withFakeFirecrawl(
    () => ok({ markdown: '', metadata: { statusCode: 403 } }),
    async (config) => {
      await assert.rejects(() => scrape(config, { url: 'https://x.com/privado', waitFor: 1000 }), /sitio bloqueado/);
    },
  );
});

test('scrape: quien pide links/html recibe lo que haya, sin control de vacío', async () => {
  await withFakeFirecrawl(
    () => ok({ markdown: '', links: ['https://x.com/a', 'https://x.com/b'] }),
    async (config, seen) => {
      const out = await scrape(config, { url: 'https://x.com', formats: ['links'] });
      assert.deepEqual(out.links, ['https://x.com/a', 'https://x.com/b']);
      assert.equal(seen.bodies.length, 1);
    },
  );
});

test('scrape: SIN key no manda Authorization; CON key manda Bearer', async () => {
  const okResp = () => ok({ markdown: PAGE });

  await withFakeFirecrawl(okResp, async (config, seen) => {
    await scrape(config, { url: 'https://x.com' });
    assert.equal(seen.auth, undefined, 'sin key → sin header de auth (free tier)');
  });

  await withFakeFirecrawl(okResp, async (config, seen) => {
    await scrape({ ...config, apiKey: 'fc-test-123' }, { url: 'https://x.com' });
    assert.equal(seen.auth, 'Bearer fc-test-123', 'con key → Bearer');
  });
});

test('scrape: traduce el error de Firecrawl a su causa (sitio bloqueado) y conserva los desconocidos', async () => {
  await withFakeFirecrawl(
    () => ({
      status: 500,
      json: { success: false, code: 'SCRAPE_ALL_ENGINES_FAILED', error: 'All scraping engines failed to retrieve content from this URL.' },
    }),
    async (config) => {
      await assert.rejects(
        () => scrape(config, { url: 'https://html.duckduckgo.com/html/?q=x' }),
        /sitio bloqueado o inaccesible: https:\/\/html\.duckduckgo\.com/,
      );
    },
  );
  await withFakeFirecrawl(
    () => ({ status: 400, json: { success: false, error: 'Invalid URL', details: { code: 'BAD' } } }),
    async (config) => {
      await assert.rejects(() => scrape(config, { url: 'https://x.com' }), /Firecrawl 400: Invalid URL/);
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

// ─── 4. Smoke REAL contra api.firecrawl.dev (free tier, sin key) ──────────────

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
  // IANA cambió el contenido de example.com (2026-10): ya no dice "Example Domain", solo el texto multilingüe y el link a iana.org
  assert.match(String(out.markdown), /Example Domain|documentation examples|example-domains/i);
  assert.equal((out.metadata as { statusCode?: number }).statusCode, 200);
});
