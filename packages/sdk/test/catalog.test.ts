import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { FolderSource, MediaCatalogProvider, parseCsv } from '../src/catalog';

let dir: string;
let source: FolderSource;
let provider: MediaCatalogProvider;
let server: Server;
let baseUrl: string;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001ffd7', 'hex');
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40, 1)]);

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiba-catalog-'));
  await fs.writeFile(path.join(dir, 'atardecer.png'), PNG);
  await fs.writeFile(path.join(dir, 'lofi-01.wav'), WAV);
  await fs.writeFile(path.join(dir, 'lofi-01.preview.wav'), WAV.subarray(0, 20));
  await fs.writeFile(
    path.join(dir, 'items.csv'),
    [
      'id,file,title,tags,price_usd,license,attribution,attribution_text,description,preview',
      ',atardecer.png,"Atardecer en Bogotá, Monserrate",bogota;atardecer;ciudad,0.5,commercial,,,"Foto, 2026",',
      'lofi-01,lofi-01.wav,Lo-fi 01,lofi|beat,,personal,true,"© Roy — kiba.tools",Beat de 3 s,lofi-01.preview.wav',
    ].join('\n'),
  );
  source = await FolderSource.open({ dir, publicBaseUrl: 'http://svc.test' });
  provider = new MediaCatalogProvider({
    secret: Keypair.random().secret(),
    service: 'fotos-test',
    pricePerCall: 0.05,
    description: 'catálogo de prueba',
    allowUnverified: true,
    source,
    license: { name: 'commercial', notes: 'del servicio' },
    publicBaseUrl: 'http://svc.test',
    downloadSecret: 'test-secret',
  });
  await new Promise<void>((resolve) => {
    server = provider.app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('parseCsv: comillas, comas y saltos dentro de comillas', () => {
  const rows = parseCsv('a,b,c\n1,"x, y","multi\nline"\n"q""uote",,\n');
  assert.deepEqual(rows, [
    { a: '1', b: 'x, y', c: 'multi\nline' },
    { a: 'q"uote', b: '', c: '' },
  ]);
});

test('FolderSource.open: ids, tipo por extensión, hash, precio, términos, preview', async () => {
  assert.equal(source.size, 2);
  const foto = await source.get('atardecer');
  assert.ok(foto);
  assert.equal(foto!.type, 'image');
  assert.equal(foto!.mimeType, 'image/png');
  assert.equal(foto!.bytes, PNG.length);
  assert.equal(foto!.sha256, createHash('sha256').update(PNG).digest('hex'));
  assert.equal(foto!.priceUsd, 0.5);
  assert.deepEqual(foto!.tags, ['bogota', 'atardecer', 'ciudad']);
  assert.deepEqual(foto!.terms, { name: 'commercial' });
  assert.equal(foto!.previewUrl, undefined);
  const beat = await source.get('lofi-01');
  assert.equal(beat!.type, 'audio');
  assert.equal(beat!.priceUsd, undefined);
  assert.deepEqual(beat!.terms, { name: 'personal', attribution: true });
  assert.equal(beat!.attributionText, '© Roy — kiba.tools');
  assert.equal(beat!.previewUrl, 'http://svc.test/catalog/preview/lofi-01');
});

test('FolderSource: rechaza archivos fuera de la carpeta o inexistentes', async () => {
  const bad = await fs.mkdtemp(path.join(os.tmpdir(), 'kiba-catalog-bad-'));
  await fs.writeFile(path.join(bad, 'items.json'), JSON.stringify([{ file: '../x.png' }, { file: 'nope.png' }]));
  await assert.rejects(FolderSource.open({ dir: bad }), /escapes the catalog folder.*file not found/s);
  await fs.rm(bad, { recursive: true, force: true });
});

test('FolderSource: una vista previa que no existe es un error al abrir', async () => {
  const bad = await fs.mkdtemp(path.join(os.tmpdir(), 'kiba-catalog-prev-'));
  await fs.writeFile(path.join(bad, 'a.png'), PNG);
  await fs.writeFile(path.join(bad, 'items.json'), JSON.stringify([{ file: 'a.png', preview: 'a.preview.png' }]));
  await assert.rejects(FolderSource.open({ dir: bad }), /preview not found: a.preview.png/);
  await fs.rm(bad, { recursive: true, force: true });
});

test('publicItem: el precio anunciado nunca baja del mínimo que se cobra (pricePerCall)', () => {
  const cheap = provider.publicItem({ id: 'x', title: 'x', type: 'image', priceUsd: 0.01 });
  assert.equal(cheap.priceUsd, 0.05);
  assert.equal(provider.publicItem({ id: 'y', title: 'y', type: 'image', priceUsd: 0.5 }).priceUsd, 0.5);
  assert.equal(provider.publicItem({ id: 'z', title: 'z', type: 'image' }).priceUsd, 0.05);
});

test('búsqueda: etiquetas y título puntúan, filtro por tipo, vacío lista todo', async () => {
  assert.deepEqual((await source.search('atardecer bogota')).map((i) => i.id), ['atardecer']);
  assert.deepEqual((await source.search('lofi')).map((i) => i.id), ['lofi-01']);
  // "lo-fi" se busca pegado y sus sílabas no cuentan como substring (antes "lo" traía la foto).
  assert.deepEqual((await source.search('a lo-fi track')).map((i) => i.id), ['lofi-01']);
  assert.deepEqual((await source.search('', { type: 'audio' })).map((i) => i.id), ['lofi-01']);
  assert.equal((await source.search('')).length, 2);
  assert.equal((await source.search('zzz')).length, 0);
});

test('GET /catalog/search y /catalog/items/:id son públicos y traen precio y términos efectivos', async () => {
  const r = await fetch(`${baseUrl}/catalog/search?q=lofi`);
  assert.equal(r.status, 200);
  const data = (await r.json()) as { items: { id: string; priceUsd: number; terms: { name: string; notes?: string; attribution?: boolean } }[] };
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].priceUsd, 0.05, 'precio base del servicio');
  assert.equal(data.items[0].terms.name, 'personal');
  assert.equal(data.items[0].terms.attribution, true);
  assert.equal(data.items[0].terms.notes, 'del servicio', 'términos del servicio completan los del ítem');
  const one = await fetch(`${baseUrl}/catalog/items/atardecer`);
  assert.equal(((await one.json()) as { priceUsd: number }).priceUsd, 0.5);
  assert.equal((await fetch(`${baseUrl}/catalog/items/nope`)).status, 404);
  const manifest = (await (await fetch(`${baseUrl}/manifest`)).json()) as { catalog?: boolean; license?: { name: string } };
  assert.equal(manifest.catalog, true);
  assert.equal(manifest.license?.name, 'commercial');
});

test('la cotización usa el precio del ítem; licenciar devuelve enlace firmado y bloque license', async () => {
  const quote = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId: 'atardecer' }),
  });
  assert.equal(quote.status, 402);
  assert.equal(((await quote.json()) as { amount: string }).amount, String(0.5 * 1e7));

  const paid = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-PAYMENT': Buffer.from(JSON.stringify({ escrowId: 'e1', nonce: '1' })).toString('base64'),
    },
    body: JSON.stringify({ assetId: 'atardecer' }),
  });
  assert.equal(paid.status, 200);
  const body = (await paid.json()) as {
    op: string;
    downloadUrl: string;
    license: { assetSha256: string; assetId: string; filename: string; mimeType: string; terms: { name: string; notes?: string; exclusive?: boolean } };
  };
  assert.equal(body.op, 'license');
  assert.equal(body.license.assetId, 'atardecer');
  assert.equal(body.license.assetSha256, createHash('sha256').update(PNG).digest('hex'));
  assert.equal(body.license.filename, 'atardecer.png');
  assert.equal(body.license.mimeType, 'image/png');
  assert.equal(body.license.terms.name, 'commercial');
  assert.equal(body.license.terms.notes, 'del servicio');
  assert.equal(body.license.terms.exclusive, false, 'la plantilla completa lo que falta');
  assert.match(body.downloadUrl, /^http:\/\/svc\.test\/catalog\/download\/atardecer\?exp=\d+&sig=[a-f0-9]{64}$/);

  // El enlace firmado sirve el archivo; alterado → 403; caducado → 410.
  const url = new URL(body.downloadUrl);
  const ok = await fetch(`${baseUrl}${url.pathname}${url.search}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.compare(Buffer.from(await ok.arrayBuffer()), PNG), 0);
  const bad = await fetch(`${baseUrl}${url.pathname}?exp=${url.searchParams.get('exp')}&sig=${'0'.repeat(64)}`);
  assert.equal(bad.status, 403);
  const expiredUrl = new URL(provider.signedDownloadUrl('atardecer', 1));
  assert.equal((await fetch(`${baseUrl}${expiredUrl.pathname}${expiredUrl.search}`)).status, 410);
  assert.equal((await fetch(`${baseUrl}/catalog/preview/lofi-01`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/catalog/preview/atardecer`)).status, 404);
});

test('op search por la vía pagada y assetId desconocido', async () => {
  const headers = {
    'content-type': 'application/json',
    'X-PAYMENT': Buffer.from(JSON.stringify({ escrowId: 'e2', nonce: '2' })).toString('base64'),
  };
  const s = await fetch(`${baseUrl}/service`, { method: 'POST', headers, body: JSON.stringify({ op: 'search', query: 'bogota' }) });
  assert.equal(((await s.json()) as { items: { id: string }[] }).items[0].id, 'atardecer');
  const u = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { ...headers, 'X-PAYMENT': Buffer.from(JSON.stringify({ escrowId: 'e3', nonce: '3' })).toString('base64') },
    body: JSON.stringify({ assetId: 'nope' }),
  });
  assert.equal(u.status, 500);
  assert.match(((await u.json()) as { error: string }).error, /unknown asset/);
});

test('fuentes: .otf es tipo font, con licencia de fuente y vista previa cargable desde otro dominio', async () => {
  const fdir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiba-fonts-'));
  try {
    const OTF = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(60, 7)]);
    await fs.writeFile(path.join(fdir, 'redonda.otf'), OTF);
    await fs.writeFile(path.join(fdir, 'redonda.preview.otf'), OTF.subarray(0, 30));
    await fs.writeFile(
      path.join(fdir, 'items.json'),
      JSON.stringify([
        {
          file: 'redonda.otf',
          preview: 'redonda.preview.otf',
          title: 'Redonda',
          price_usd: 0.12,
          license: { name: 'font-web', notes: 'hasta 10.000 visitas al mes' },
        },
      ]),
    );
    const fonts = await FolderSource.open({ dir: fdir, publicBaseUrl: 'http://fonts.test' });
    const item = await fonts.get('redonda');
    assert.equal(item!.type, 'font');
    assert.equal(item!.mimeType, 'font/otf');
    assert.deepEqual((await fonts.search('', { type: 'font' })).map((i) => i.id), ['redonda']);

    const shop = new MediaCatalogProvider({
      secret: Keypair.random().secret(),
      service: 'fuentes-test',
      pricePerCall: 0.05,
      description: 'fundición de prueba',
      allowUnverified: true,
      source: fonts,
      license: { name: 'font-desktop', notes: 'del servicio' },
      publicBaseUrl: 'http://fonts.test',
      downloadSecret: 'test-secret',
    });
    // La plantilla de la fuente manda sobre la del servicio; la nota del ítem también.
    const terms = shop.publicItem(item!).terms;
    assert.equal(terms.name, 'font-web');
    assert.ok(terms.usage!.includes('webfont') && terms.usage!.includes('desktop'));
    assert.ok(!terms.usage!.includes('app'), 'la licencia web no cubre apps');
    assert.equal(terms.notes, 'hasta 10.000 visitas al mes');

    const srv = await new Promise<Server>((resolve) => {
      const s = shop.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const r = await fetch(`${url}/catalog/preview/redonda`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'font/otf');
      // Sin este permiso el navegador no carga la fuente de otro dominio (@font-face / FontFace).
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      assert.equal((await r.arrayBuffer()).byteLength, 30);
    } finally {
      srv.close();
    }
  } finally {
    await fs.rm(fdir, { recursive: true, force: true });
  }
});
