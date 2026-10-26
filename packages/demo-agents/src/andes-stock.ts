/**
 * andes-stock — "Andes Stock", una empresa de fotos y música de stock que YA existe y ya tiene su
 * propia API, vende sus licencias a través de Kiba sin migrar su catálogo.
 * Se publica/invoca on-chain como **andes-stock**.
 *
 * Es la referencia de "servicio indexado": Kiba nunca toca la base de datos de la empresa. El
 * publisher (la empresa) corre este proceso con su propia clave de API y un `map` de su formato al
 * de Kiba; el SDK (MediaCatalogProvider + HttpCatalogSource) hace el resto:
 *   - GET /catalog/search?q=…   búsqueda pública y gratis (la usa la búsqueda federada de Kiba)
 *   - POST /service { assetId }  compra: cobra el precio del ítem y devuelve el enlace de descarga
 *                                FIRMADO POR LA EMPRESA + el bloque `license`; Kiba escribe el documento de
 *                                licencia y el pago lleva su huella.
 *
 * Para la demo, el mismo proceso simula también la "API existente" de la empresa bajo
 * /company-api/v1 (en la vida real sería https://api.andesstock.com/v1, en otro servidor):
 *   GET /company-api/v1/items?q=&category=&page=&per_page=   (clave de API)  lista paginada
 *   GET /company-api/v1/items/:sku                            (clave de API)  ficha
 *   GET /company-api/v1/items/:sku/download-link              (clave de API)  enlace firmado (HMAC + caducidad)
 *   GET /company-api/v1/files/:file?exp=&sig=                 (enlace firmado) el archivo
 *   GET /company-api/v1/thumbs/:file                          (público)       miniatura / preview de audio
 * Contenido: ANDES_CATALOG_DIR (por defecto la carpeta partner-sample del paquete: catalog.json + archivos).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import {
  HttpCatalogSource,
  MediaCatalogProvider,
  loadKeypairFromEnvOrFile,
  mimeTypeFor,
  type HttpCatalogEntry,
  type LicenseTerms,
} from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/andes-stock.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const PORT = Number(process.env.PORT) || 5012;
const PUBLIC_ENDPOINT = (process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5012').replace(/\/+$/, '');
// En Docker el cwd es packages/demo-agents (WORKDIR); en local también se arranca desde ahí.
const CATALOG_DIR = process.env.ANDES_CATALOG_DIR || path.resolve(process.cwd(), 'partner-sample');
// Mínimo que cobra el servicio (el SDK nunca cobra menos y anuncia max(precio, mínimo)).
const PRICE_MIN_USDC = Number(process.env.ANDES_PRICE_MIN_USDC) || 0.02;

// ─── La "API existente" de Andes Stock (simulada) ──────────────────────────
const COMPANY_PREFIX = '/company-api/v1';
/** URL pública de la API de la empresa: lo que verá el comprador en los enlaces de descarga. */
const COMPANY_PUBLIC_URL = (process.env.ANDES_PUBLIC_API_URL || `${PUBLIC_ENDPOINT}${COMPANY_PREFIX}`).replace(/\/+$/, '');
/** Por dónde la lee el conector de Kiba (aquí mismo por loopback; en la vida real, la URL de su API). */
const COMPANY_API_URL = (process.env.ANDES_API_URL || `http://127.0.0.1:${PORT}${COMPANY_PREFIX}`).replace(/\/+$/, '');
const COMPANY_API_KEY = process.env.ANDES_API_KEY || 'andes-demo-key';
const LINK_TTL_SEC = Number(process.env.ANDES_LINK_TTL_SEC) || 24 * 60 * 60;
// Secreto de los enlaces firmados de la empresa. Si no se da, se deriva de la wallet del agente:
// estable entre reinicios (los enlaces ya vendidos siguen valiendo tras un redeploy).
const LINK_SECRET = process.env.ANDES_SIGNING_SECRET || createHash('sha256').update(`andes-links:${wallet.secret()}`).digest('hex');

/** Formato de partner-sample/catalog.json (la base de datos de la empresa, por así decirlo). */
interface AndesRecord {
  sku: string;
  name: string;
  keywords: string[];
  category: 'photo' | 'music';
  price_cents: number;
  file: string;
  thumb?: string;
  license_code: 'RF-STD' | 'RF-EXT';
  author?: string;
  description?: string;
}

/** Lo que devuelve la API de la empresa por ítem (su formato, no el de Kiba). */
interface AndesApiItem {
  sku: string;
  name: string;
  description?: string;
  keywords: string[];
  category: 'photo' | 'music';
  author?: string;
  license_code: string;
  price_cents: number;
  currency: 'USD';
  mime_type: string;
  bytes: number;
  thumbnail_url: string | null;
}

interface CompanyItem extends AndesRecord {
  bytes: number;
  absFile: string;
  absThumb?: string;
}

function inside(dir: string, rel: string): string | null {
  const abs = path.resolve(dir, rel);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

async function loadCompanyCatalog(dir: string): Promise<{ company: string; items: Map<string, CompanyItem> }> {
  const root = path.resolve(dir);
  const data = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8')) as { company?: string; items?: AndesRecord[] };
  if (!Array.isArray(data.items)) throw new Error(`${root}/catalog.json: expected { items: [] }`);
  const items = new Map<string, CompanyItem>();
  for (const r of data.items) {
    const absFile = r?.file ? inside(root, r.file) : null;
    const absThumb = r?.thumb ? inside(root, r.thumb) : undefined;
    try {
      if (!r?.sku || !absFile) throw new Error('missing sku/file');
      const stat = await fs.stat(absFile);
      if (absThumb) await fs.stat(absThumb);
      items.set(r.sku, { ...r, bytes: stat.size, absFile, ...(absThumb ? { absThumb } : {}) });
    } catch (err) {
      console.warn(`[andes-stock] company catalog: skipping ${r?.sku ?? '?'}: ${(err as Error).message}`);
    }
  }
  return { company: data.company || 'Andes Stock', items };
}

function signLink(file: string, exp: number): string {
  return createHmac('sha256', LINK_SECRET).update(`${file}.${exp}`).digest('hex');
}

function toApiItem(i: CompanyItem): AndesApiItem {
  return {
    sku: i.sku,
    name: i.name,
    ...(i.description ? { description: i.description } : {}),
    keywords: i.keywords ?? [],
    category: i.category,
    ...(i.author ? { author: i.author } : {}),
    license_code: i.license_code,
    price_cents: i.price_cents,
    currency: 'USD',
    mime_type: mimeTypeFor(i.file),
    bytes: i.bytes,
    thumbnail_url: i.thumb ? `${COMPANY_PUBLIC_URL}/thumbs/${encodeURIComponent(path.basename(i.thumb))}` : null,
  };
}

function sendFile(res: Response, file: string, disposition: 'inline' | 'attachment', cache: string): void {
  res.setHeader('Content-Type', mimeTypeFor(file));
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Disposition', `${disposition}; filename="${path.basename(file)}"`);
  createReadStream(file)
    .on('error', () => (res.headersSent ? res.end() : res.status(404).json({ error: 'not found' })))
    .pipe(res);
}

function mountCompanyApi(app: MediaCatalogProvider['app'], catalog: Map<string, CompanyItem>): void {
  const byFile = new Map([...catalog.values()].map((i) => [path.basename(i.file), i]));
  const byThumb = new Map([...catalog.values()].filter((i) => i.absThumb).map((i) => [path.basename(i.thumb!), i]));
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.headers['x-api-key'] ?? '');
    const a = Buffer.from(given);
    const b = Buffer.from(COMPANY_API_KEY);
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
    res.status(401).json({ error: 'invalid or missing API key' });
  };

  app.get(`${COMPANY_PREFIX}/items`, auth, (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').toLowerCase().trim();
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const all = [...catalog.values()].filter(
      (i) =>
        (!category || i.category === category) &&
        (!q || `${i.name} ${i.description ?? ''} ${(i.keywords ?? []).join(' ')} ${i.sku}`.toLowerCase().includes(q)),
    );
    res.json({
      data: all.slice((page - 1) * perPage, page * perPage).map(toApiItem),
      page,
      per_page: perPage,
      total: all.length,
      total_pages: Math.max(1, Math.ceil(all.length / perPage)),
    });
  });

  app.get(`${COMPANY_PREFIX}/items/:sku`, auth, (req: Request, res: Response) => {
    const i = catalog.get(String(req.params.sku));
    if (!i) return res.status(404).json({ error: 'unknown sku' });
    res.json(toApiItem(i));
  });

  app.get(`${COMPANY_PREFIX}/items/:sku/download-link`, auth, (req: Request, res: Response) => {
    const i = catalog.get(String(req.params.sku));
    if (!i) return res.status(404).json({ error: 'unknown sku' });
    const file = path.basename(i.file);
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
    res.json({
      sku: i.sku,
      download_url: `${COMPANY_PUBLIC_URL}/files/${encodeURIComponent(file)}?exp=${exp}&sig=${signLink(file, exp)}`,
      expires_at: new Date(exp * 1000).toISOString(),
      license_code: i.license_code,
      bytes: i.bytes,
    });
  });

  app.get(`${COMPANY_PREFIX}/files/:file`, (req: Request, res: Response) => {
    const file = String(req.params.file);
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? '');
    const item = byFile.get(file);
    if (!item || !Number.isFinite(exp) || !/^[a-f0-9]{64}$/.test(sig)) return res.status(403).json({ error: 'invalid download link' });
    const expected = Buffer.from(signLink(file, exp), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return res.status(403).json({ error: 'invalid download link' });
    if (exp < Math.floor(Date.now() / 1000)) return res.status(410).json({ error: 'download link expired' });
    sendFile(res, item.absFile, 'attachment', 'private, max-age=3600');
  });

  app.get(`${COMPANY_PREFIX}/thumbs/:file`, (req: Request, res: Response) => {
    const item = byThumb.get(String(req.params.file));
    if (!item?.absThumb) return res.status(404).json({ error: 'not found' });
    sendFile(res, item.absThumb, 'inline', 'public, max-age=86400');
  });
}

// ─── El conector: de la API de Andes Stock al formato de Kiba ──────────────

/** Licencias de Andes Stock traducidas a términos de Kiba (vocabulario de usos de medios del SDK). */
const LICENSES: Record<string, LicenseTerms> = {
  'RF-STD': {
    name: 'commercial',
    // Sin `merchandise`: la licencia estándar no cubre productos para la venta.
    usage: ['advertising', 'social-media', 'broadcast', 'print', 'editorial', 'web'],
    notes:
      'Andes Stock RF-STD (royalty-free standard): perpetual, worldwide, non-exclusive; commercial and personal use ' +
      'in ads, social media, video, apps and web, and up to 500,000 printed copies. Not for products for resale.',
  },
  'RF-EXT': {
    name: 'commercial-extended',
    usage: ['advertising', 'social-media', 'broadcast', 'print', 'merchandise', 'editorial', 'web'],
    user: ['commercial', 'personal', 'education', 'non-commercial', 'government'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
    notes:
      'Andes Stock RF-EXT (royalty-free extended): everything in RF-STD plus unlimited print runs and use in ' +
      'products for resale (merchandise, templates, print-on-demand). Reselling the file itself is not allowed.',
  },
};

function mapAndesItem(raw: AndesApiItem): HttpCatalogEntry | null {
  const terms = LICENSES[raw.license_code];
  if (!terms) {
    console.warn(`[andes-stock] ${raw.sku}: unknown license_code ${raw.license_code}, skipped`);
    return null;
  }
  return {
    id: raw.sku,
    title: raw.name,
    type: raw.category === 'music' ? 'audio' : 'image',
    ...(raw.description ? { description: raw.description } : {}),
    tags: raw.keywords,
    mimeType: raw.mime_type,
    bytes: raw.bytes,
    priceUsd: raw.price_cents / 100,
    ...(raw.thumbnail_url ? { previewUrl: raw.thumbnail_url } : {}),
    terms,
    ...(raw.author ? { attributionText: `${raw.author} / Andes Stock` } : {}),
    // Enlace firmado de la empresa, pedido a SU API en el momento de cada compra.
    downloadPath: `items/${encodeURIComponent(raw.sku)}/download-link`,
  };
}

const DESCRIPTION =
  'Andes Stock: Latin American stock photos and royalty-free music, sold through Kiba from the company\'s own catalog API. ' +
  'Find items for free with the search_media tool (e.g. query "andes mountains", or "cumbia" with type "audio"); each item ' +
  'has a price and an RF standard or extended license. Buy one with { assetId }: you get Andes Stock\'s signed download ' +
  'link plus a license whose fingerprint travels in the Stellar payment.';
// El contrato de registro on-chain rechaza descripciones de más de 512 BYTES (UTF-8).
if (Buffer.byteLength(DESCRIPTION, 'utf8') > 450) throw new Error(`description too long: ${Buffer.byteLength(DESCRIPTION, 'utf8')} bytes`);

(async () => {
  const { company, items } = await loadCompanyCatalog(CATALOG_DIR);
  console.log(`[andes-stock] ${company}: ${items.size} ítems en su catálogo (${CATALOG_DIR})`);

  const source = new HttpCatalogSource<AndesApiItem>({
    baseUrl: COMPANY_API_URL,
    headers: { Authorization: `Bearer ${COMPANY_API_KEY}` },
    // La API de la empresa pagina a su manera: se recorren todas las páginas.
    fetchItems: async (api) => {
      const out: AndesApiItem[] = [];
      for (let page = 1; page <= 1000; page++) {
        const r = (await api.getJson('items', { page, per_page: 100 })) as { data: AndesApiItem[]; total_pages: number };
        out.push(...r.data);
        if (page >= r.total_pages) break;
      }
      return out;
    },
    map: mapAndesItem,
    publicBaseUrl: PUBLIC_ENDPOINT,
    // Para calcular el SHA-256 la primera vez, el archivo se descarga por loopback y no por el dominio
    // público (evita depender del proxy de entrada desde dentro del contenedor).
    fetch: (input, init) => fetch(String(input).replace(COMPANY_PUBLIC_URL, COMPANY_API_URL), init),
  });

  const agent = new MediaCatalogProvider({
    wallet,
    service: 'andes-stock',
    pricePerCall: PRICE_MIN_USDC,
    pricingNote: `Precio por ítem, fijado por Andes Stock (ver priceUsd en cada resultado de búsqueda); mínimo ${PRICE_MIN_USDC} USDC`,
    description: DESCRIPTION,
    endpoint: PUBLIC_ENDPOINT,
    publicBaseUrl: PUBLIC_ENDPOINT,
    source,
    license: {
      name: 'commercial',
      termsUrl: 'https://docs.kiba.tools/licencias',
      notes: 'Licensed by Andes Stock through Kiba. Non-exclusive. Resale of the file itself is not allowed.',
    },
    platform: process.env.KIBA_PLATFORM_PUBLIC_KEY ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY } : undefined,
  });
  mountCompanyApi(agent.app, items);

  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[andes-stock] bootstrap failed:', (err as Error).message);
    console.error('[andes-stock] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(PORT);

  // Calienta la caché del conector (catálogo + hashes) para que el primer comprador no espere.
  try {
    console.log(`[andes-stock] Kiba connector: ${await source.refresh()} ítems leídos de ${COMPANY_API_URL}`);
    const { ok, failed } = await source.prehash();
    console.log(`[andes-stock] hashes listos: ${ok}${failed.length ? `; fallaron: ${failed.join(', ')}` : ''}`);
  } catch (err) {
    console.error('[andes-stock] could not read the company API yet (will retry on demand):', (err as Error).message);
  }
})().catch((err) => {
  console.error('[andes-stock] failed to start:', err);
  process.exit(1);
});
