/**
 * tipos-del-sur — fundición tipográfica SIMULADA que vende sus fuentes por Kiba.
 * Se publica/invoca on-chain como **tipos-del-sur**.
 *
 * Una IA no puede generar una fuente lista para usar, y su licencia depende de dónde se use
 * (escritorio, web, apps): es un caso claro de activo con licencia. Mismo SDK que media-catalog
 * (MediaCatalogProvider + FolderSource), con dos diferencias:
 *   - cada fuente trae su propia licencia de fuente (font-desktop | font-web | font-full) en items.json;
 *   - la vista previa es la fuente con solo las letras básicas, para probarla sin entregarla completa.
 *
 * Contenido: FONTS_DIR (por defecto la carpeta fonts-sample del paquete: tres familias generadas
 * por código, propias del equipo; ver fonts-sample/README.md).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FolderSource, MediaCatalogProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/tipos-del-sur.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const PUBLIC_ENDPOINT = process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5013';
// En Docker el cwd es packages/demo-agents (WORKDIR); en local también se arranca desde ahí.
const FONTS_DIR = process.env.FONTS_DIR || path.resolve(process.cwd(), 'fonts-sample');
// MÍNIMO que cobra el servicio (el SDK nunca cobra menos): <= que la fuente más barata (0.06).
const PRICE_MIN_USDC = Number(process.env.FONTS_PRICE_MIN_USDC) || 0.05;
// Secreto de los enlaces de descarga firmados: derivado de la wallet (o FONTS_DOWNLOAD_SECRET) para
// que los enlaces ya entregados sigan valiendo tras un reinicio o un redeploy.
const DOWNLOAD_SECRET =
  process.env.FONTS_DOWNLOAD_SECRET || createHash('sha256').update(`fonts-links:${wallet.secret()}`).digest('hex');

const DESCRIPTION =
  'Tipos del Sur: fundición tipográfica que vende sus fuentes por Kiba. Licensed fonts for logos, ' +
  'menus, websites and games. Find them for free with search_media (type "font", e.g. "rounded logo ' +
  'font" or "pixel"); each font has a price and a font license: desktop, desktop + web, or full ' +
  '(apps, ebooks). Buy with { assetId }: you get the .otf file plus a license whose fingerprint ' +
  'travels in the Stellar payment.';
// El contrato de registro on-chain rechaza descripciones de más de 512 BYTES (UTF-8): mejor fallar al arrancar.
if (Buffer.byteLength(DESCRIPTION, 'utf8') > 512) throw new Error(`description too long: ${Buffer.byteLength(DESCRIPTION, 'utf8')} bytes (max 512)`);

(async () => {
  const source = await FolderSource.open({ dir: FONTS_DIR, publicBaseUrl: PUBLIC_ENDPOINT });
  console.log(`[tipos-del-sur] ${source.size} fuentes cargadas de ${FONTS_DIR}`);

  const agent = new MediaCatalogProvider({
    wallet,
    service: 'tipos-del-sur',
    pricePerCall: PRICE_MIN_USDC,
    pricingNote: `Precio por fuente (ver priceUsd en cada resultado de búsqueda); mínimo ${PRICE_MIN_USDC} USDC`,
    description: DESCRIPTION,
    endpoint: PUBLIC_ENDPOINT,
    publicBaseUrl: PUBLIC_ENDPOINT,
    downloadSecret: DOWNLOAD_SECRET,
    source,
    // Base de las licencias de la fundición; cada fuente indica en items.json cuál le toca.
    license: {
      name: 'font-desktop',
      termsUrl: 'https://docs.kiba.tools/licencias',
      notes: 'Font license per download through Kiba. Non-exclusive. Reselling or sharing the font file itself is not allowed.',
    },
    platform: process.env.KIBA_PLATFORM_PUBLIC_KEY ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY } : undefined,
  });

  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[tipos-del-sur] bootstrap failed:', (err as Error).message);
    console.error('[tipos-del-sur] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5013);
})().catch((err) => {
  console.error('[tipos-del-sur] failed to start:', err);
  process.exit(1);
});
