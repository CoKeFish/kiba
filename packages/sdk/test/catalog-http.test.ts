import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { HttpCatalogSource } from '../src/catalog-http';
import { MediaCatalogProvider } from '../src/catalog';

// ─── API "existente" de una empresa, falsa y local ──────────────────────────
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 7)]);
const KEY = 'secret-api-key';

interface RawItem {
  sku: string;
  name: string;
  keywords: string[];
  category: 'photo' | 'music';
  price_cents: number;
  thumbnail_url?: string;
  file: string;
  checksum?: string;
}

const catalog: RawItem[] = [
  { sku: 'AS-1', name: 'Nevado del Ruiz al amanecer', keywords: ['montaña', 'nieve', 'andes'], category: 'photo', price_cents: 8, thumbnail_url: '/thumbs/AS-1.jpg', file: 'AS-1.jpg' },
  { sku: 'AS-2', name: 'Cumbia de bolsillo', keywords: ['cumbia', 'música'], category: 'music', price_cents: 30, file: 'AS-2.mp3' },
  {
    sku: 'AS-3',
    name: 'Calle de Cartagena',
    keywords: ['ciudad', 'colores'],
    category: 'photo',
    price_cents: 12,
    file: 'AS-3.jpg',
    checksum: createHash('sha256').update(JPG).digest('hex'),
  },
];

let company: Server;
let cdn: Server;
let api: string;
let cdnBase: string;
let failList = false;
const hits = { list: 0, link: 0, file: 0, unauth: 0, keyLeaked: 0 };
const FILES: Record<string, Buffer> = { 'AS-1.jpg': JPG, 'AS-2.mp3': MP3, 'AS-3.jpg': JPG };

function authed(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${KEY}`;
}

before(async () => {
  const handler = (req: IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL((req.url ?? '/').replace(/^\/v1\/(files|thumbs)\//, '/$1/'), 'http://x');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/files/') || url.pathname.startsWith('/thumbs/')) {
      if (req.headers.authorization) hits.keyLeaked++;
      const name = decodeURIComponent(url.pathname.split('/').pop()!);
      if (url.pathname.startsWith('/files/')) {
        hits.file++;
        if (url.searchParams.get('sig') !== 'ok') return json(403, { error: 'bad signature' });
      }
      const buf = FILES[name];
      if (!buf) return json(404, { error: 'not found' });
      res.writeHead(200, { 'content-type': name.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg' });
      return res.end(buf);
    }
    if (!url.pathname.startsWith('/v1/')) return json(404, { error: 'not found' });
    if (!authed(req)) {
      hits.unauth++;
      return json(401, { error: 'missing api key' });
    }
    const p = url.pathname.slice('/v1/'.length);
    if (p === 'items') {
      hits.list++;
      if (failList) return json(503, { error: 'maintenance' });
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 100);
      const data = catalog.slice((page - 1) * per, page * per);
      return json(200, { data, page, total_pages: Math.ceil(catalog.length / per) });
    }
    const m = /^items\/([^/]+)\/download-link$/.exec(p);
    if (m) {
      hits.link++;
      const item = catalog.find((i) => i.sku === m[1]);
      if (!item) return json(404, { error: 'unknown sku' });
      // Enlace firmado propio de la empresa, a OTRO host (un CDN): la clave no debe viajar allí.
      return json(200, {
        download_url: `${cdnBase}/files/${item.file}?sig=ok&n=${hits.link}`,
        expires_at: Date.now() + 3600_000,
        ...(item.checksum ? { sha256: item.checksum } : {}),
      });
    }
    return json(404, { error: 'not found' });
  };
  company = createServer(handler);
  cdn = createServer(handler);
  await new Promise<void>((r) => company.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => cdn.listen(0, '127.0.0.1', () => r()));
  api = `http://127.0.0.1:${(company.address() as AddressInfo).port}`;
  cdnBase = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;
});

after(() => {
  company?.close();
  cdn?.close();
});

function makeSource(extra: Partial<ConstructorParameters<typeof HttpCatalogSource<RawItem>>[0]> = {}) {
  return new HttpCatalogSource<RawItem>({
    baseUrl: `${api}/v1`,
    headers: { Authorization: `Bearer ${KEY}` },
    map: (r) => ({
      id: r.sku,
      title: r.name,
      type: r.category === 'music' ? 'audio' : 'image',
      tags: r.keywords,
      priceUsd: r.price_cents / 100,
      ...(r.thumbnail_url ? { previewUrl: r.thumbnail_url } : {}),
      downloadPath: `items/${encodeURIComponent(r.sku)}/download-link`,
    }),
    ...extra,
  });
}

test('carga perezosa desde listPath ({ data: [] }), map, búsqueda, get y list paginado', async () => {
  const s = makeSource();
  assert.equal(s.size, 0, 'no llama a la API hasta que se usa');
  const found = await s.search('andes montaña');
  assert.deepEqual(found.map((i) => i.id), ['AS-1']);
  assert.equal(s.size, 3);
  assert.deepEqual((await s.search('', { type: 'audio' })).map((i) => i.id), ['AS-2']);
  const one = await s.get('AS-1');
  assert.equal(one?.priceUsd, 0.08);
  assert.equal(one?.previewUrl, `${api}/v1/thumbs/AS-1.jpg`, 'ruta relativa resuelta contra baseUrl');
  assert.equal((one as Record<string, unknown>).downloadPath, undefined, 'lo interno no se publica');
  assert.equal(await s.get('nope'), null);
  const p1 = await s.list({ limit: 2 });
  assert.deepEqual(p1.items.map((i) => i.id), ['AS-1', 'AS-2']);
  assert.equal(p1.next, '2');
  const p2 = await s.list({ cursor: p1.next, limit: 2 });
  assert.deepEqual(p2.items.map((i) => i.id), ['AS-3']);
  assert.equal(p2.next, undefined);
});

test('sin la clave de la API la carga falla (y se reintenta en la siguiente llamada)', async () => {
  const s = new HttpCatalogSource<RawItem>({ baseUrl: `${api}/v1`, map: (r) => ({ id: r.sku, title: r.name, type: 'image', downloadPath: 'x' }) });
  const before = hits.unauth;
  await assert.rejects(s.search('x'), /HTTP 401/);
  await assert.rejects(s.get('AS-1'), /HTTP 401/);
  assert.equal(hits.unauth, before + 2);
});

test('deliver: pide el enlace firmado a la empresa en cada compra y calcula el SHA-256 una sola vez', async () => {
  const s = makeSource();
  const files0 = hits.file;
  const links0 = hits.link;
  const d1 = await s.deliver('AS-1');
  assert.ok(d1);
  assert.match(d1!.url!, /\/files\/AS-1\.jpg\?sig=ok&n=\d+$/);
  assert.equal(d1!.sha256, createHash('sha256').update(JPG).digest('hex'));
  assert.equal(d1!.bytes, JPG.length);
  assert.equal(d1!.filename, 'AS-1.jpg');
  assert.equal(d1!.mimeType, 'image/jpeg');
  const d2 = await s.deliver('AS-1');
  assert.notEqual(d2!.url, d1!.url, 'enlace nuevo en cada compra');
  assert.equal(d2!.sha256, d1!.sha256);
  assert.equal(hits.link, links0 + 2);
  assert.equal(hits.file, files0 + 1, 'el archivo se descarga una vez para el hash');
  assert.equal(hits.keyLeaked, 0, 'la clave de la API no viaja al host de descarga');
  // Si la API da el hash, no se descarga nada.
  const d3 = await s.deliver('AS-3');
  assert.equal(d3!.sha256, catalog[2].checksum);
  assert.equal(hits.file, files0 + 1);
  assert.equal(await s.deliver('nope'), null);
});

test('downloadUrl estático y sha256 en el map; ítems inválidos se omiten sin tumbar el catálogo', async () => {
  const sha = createHash('sha256').update(MP3).digest('hex');
  const s = makeSource({
    map: (r) =>
      r.sku === 'AS-3'
        ? { id: r.sku, title: r.name, type: 'image', priceUsd: -1, downloadUrl: '/files/x' } // precio inválido
        : r.sku === 'AS-2'
          ? { id: r.sku, title: r.name, type: 'audio', sha256: sha.toUpperCase(), downloadUrl: `files/${r.file}?sig=ok` }
          : { id: r.sku, title: r.name, type: 'image' }, // sin descarga
  });
  assert.equal(await s.refresh(), 1);
  const d = await s.deliver('AS-2');
  assert.equal(d!.url, `${api}/v1/files/AS-2.mp3?sig=ok`);
  assert.equal(d!.sha256, sha);
  assert.equal(d!.mimeType, 'audio/mpeg');
});

test('fetchItems a medida (paginación propia) y vista previa vía el servicio con publicBaseUrl', async () => {
  const s = makeSource({
    publicBaseUrl: 'http://svc.test/',
    fetchItems: async (a) => {
      const out: RawItem[] = [];
      for (let page = 1; ; page++) {
        const r = (await a.getJson('items', { page, per_page: 2 })) as { data: RawItem[]; total_pages: number };
        out.push(...r.data);
        if (page >= r.total_pages) return out;
      }
    },
  });
  assert.equal(await s.refresh(), 3);
  const item = await s.get('AS-1');
  assert.equal(item?.previewUrl, 'http://svc.test/catalog/preview/AS-1');
  const pv = await s.preview('AS-1');
  assert.equal(pv?.url, `${api}/v1/thumbs/AS-1.jpg`);
  assert.equal(pv?.mimeType, 'image/jpeg');
  assert.equal(await s.preview('AS-2'), null, 'sin miniatura');
});

test('refresco: pasado refreshMs recarga en segundo plano y, si la API falla, conserva la última copia', async () => {
  const s = makeSource({ refreshMs: 1 });
  await s.refresh();
  const list0 = hits.list;
  failList = true;
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await s.search('cumbia')).length, 1, 'sirve la copia anterior');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(hits.list > list0, 'intentó recargar');
    assert.equal(s.size, 3, 'la copia buena sigue ahí');
  } finally {
    failList = false;
    console.warn = origWarn;
  }
});

test('con MediaCatalogProvider: cotiza el precio del ítem y licenciar entrega el enlace de la empresa', async () => {
  const provider = new MediaCatalogProvider({
    secret: Keypair.random().secret(),
    service: 'stock-test',
    pricePerCall: 0.02,
    description: 'catálogo de una empresa',
    allowUnverified: true,
    source: makeSource(),
    license: { name: 'commercial' },
    publicBaseUrl: 'http://svc.test',
  });
  const srv = await new Promise<Server>((r) => {
    const s = provider.app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const search = (await (await fetch(`${base}/catalog/search?q=cumbia`)).json()) as { items: { id: string; priceUsd: number }[] };
    assert.deepEqual(search.items.map((i) => [i.id, i.priceUsd]), [['AS-2', 0.3]]);
    const quote = await fetch(`${base}/service`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'AS-1' }),
    });
    assert.equal(quote.status, 402);
    assert.equal(((await quote.json()) as { amount: string }).amount, String(0.08 * 1e7));
    const paid = await fetch(`${base}/service`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-PAYMENT': Buffer.from(JSON.stringify({ escrowId: 'h1', nonce: 'h1' })).toString('base64'),
      },
      body: JSON.stringify({ assetId: 'AS-1' }),
    });
    assert.equal(paid.status, 200);
    const body = (await paid.json()) as { downloadUrl: string; license: { assetSha256: string; filename: string; assetUrl: string } };
    assert.ok(body.downloadUrl.startsWith(`${cdnBase}/files/AS-1.jpg?sig=ok`));
    assert.equal(body.license.assetUrl, body.downloadUrl);
    assert.equal(body.license.assetSha256, createHash('sha256').update(JPG).digest('hex'));
    assert.equal(body.license.filename, 'AS-1.jpg');
  } finally {
    srv.close();
  }
});
