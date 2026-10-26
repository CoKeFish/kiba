/**
 * media-catalog — catálogo de medios con licencia (fotos y música de un creador).
 * Se publica/invoca on-chain como **media-catalog**.
 *
 * Es la referencia de "cualquiera con derechos publica su catálogo en 10 minutos": una carpeta
 * con los archivos y un items.csv (id, título, etiquetas, precio, plantilla de licencia…).
 * El SDK (MediaCatalogProvider + FolderSource) hace el resto:
 *   - GET /catalog/search?q=…   búsqueda pública y gratis (la usa la búsqueda federada de Kiba)
 *   - POST /service { assetId }  compra: cobra el precio del ítem, devuelve el enlace firmado de
 *                                descarga y el bloque `license`; Kiba escribe el documento de licencia y el pago lleva su huella.
 *
 * Contenido: CATALOG_DIR (por defecto la carpeta catalog-sample del paquete: imágenes generadas
 * con IA y música compuesta por síntesis, todo propio del equipo; ver catalog-sample/README.md).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FolderSource, MediaCatalogProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/media-catalog.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const PUBLIC_ENDPOINT = process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5011';
// En Docker el cwd es packages/demo-agents (WORKDIR); en local también se arranca desde ahí.
const CATALOG_DIR = process.env.CATALOG_DIR || path.resolve(process.cwd(), 'catalog-sample');
// Es el MÍNIMO que cobra el servicio (el SDK nunca cobra menos), así que debe ser <= que el ítem más
// barato del CSV (0.02 en catalog-sample); si no, esos ítems se cobrarían a este precio.
const PRICE_DEFAULT_USDC = Number(process.env.CATALOG_PRICE_USDC) || 0.02;
// Secreto de los enlaces de descarga firmados: derivado de la wallet (o CATALOG_DOWNLOAD_SECRET) para
// que los enlaces ya entregados sigan valiendo tras un reinicio o un redeploy.
const DOWNLOAD_SECRET =
  process.env.CATALOG_DOWNLOAD_SECRET || createHash('sha256').update(`catalog-links:${wallet.secret()}`).digest('hex');

const DESCRIPTION =
  'Catálogo de imágenes y clips de música con licencia, de un creador independiente. ' +
  'Licensed stock photos, backgrounds and short music clips for videos, posts and apps. ' +
  'Find items for free with the search_media tool (e.g. query "lofi beat", or "sunset background" with type "image"); ' +
  'each item has a price and license terms. Buy with { assetId }: you get a download link plus a license ' +
  'whose fingerprint travels in the Stellar payment. Stock images, royalty-free music, backgrounds, jingles, licensed media.';
// El contrato de registro on-chain rechaza descripciones de más de 512 BYTES (UTF-8): mejor fallar al arrancar.
if (Buffer.byteLength(DESCRIPTION, 'utf8') > 512) throw new Error(`description too long: ${Buffer.byteLength(DESCRIPTION, 'utf8')} bytes (max 512)`);

(async () => {
  const source = await FolderSource.open({ dir: CATALOG_DIR, publicBaseUrl: PUBLIC_ENDPOINT });
  console.log(`[media-catalog] ${source.size} ítems cargados de ${CATALOG_DIR}`);

  const agent = new MediaCatalogProvider({
    wallet,
    service: 'media-catalog',
    pricePerCall: PRICE_DEFAULT_USDC,
    pricingNote: `Precio por ítem (ver priceUsd en cada resultado de búsqueda); por defecto ${PRICE_DEFAULT_USDC} USDC`,
    description: DESCRIPTION,
    endpoint: PUBLIC_ENDPOINT,
    publicBaseUrl: PUBLIC_ENDPOINT,
    downloadSecret: DOWNLOAD_SECRET,
    source,
    license: {
      name: 'commercial',
      termsUrl: 'https://docs.kiba.tools/licencias',
      notes: 'Licensed per download by the creator through Kiba. Non-exclusive. Resale of the file itself is not allowed.',
    },
    platform: process.env.KIBA_PLATFORM_PUBLIC_KEY ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY } : undefined,
  });

  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[media-catalog] bootstrap failed:', (err as Error).message);
    console.error('[media-catalog] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5011);
})().catch((err) => {
  console.error('[media-catalog] failed to start:', err);
  process.exit(1);
});
