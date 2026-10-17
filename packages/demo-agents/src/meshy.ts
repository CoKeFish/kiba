/**
 * Meshy — agente REAL (no mockeado): generación de modelos 3D con la API de Meshy
 * (https://www.meshy.ai). Se publica/invoca on-chain como **3d-generator**.
 *
 * Qué resuelve para un asistente que no puede generar 3D solo:
 *   - "hazme un modelo 3D de un robot"        → { prompt } (malla; luego { refine: true, taskId } para texturas)
 *   - "convierte esta foto en un modelo 3D"   → { imageUrl } (modelo texturizado)
 *   - "¿ya está listo?"                       → { taskId } (progreso o URLs GLB/FBX/OBJ + miniatura)
 *
 * Meshy es asíncrono (1-3 min por modelo), así que las llamadas devuelven un taskId y el
 * asistente vuelve a llamar hasta que status = SUCCEEDED. Ver meshy-core.ts.
 *
 * Igual que el resto de agentes: registra el servicio on-chain en bootstrap() y cobra vía
 * x402 / llamadas firmadas por la plataforma. La key (MESHY_API_KEY) es REQUERIDA: Meshy
 * cobra créditos por tarea (plan Pro o superior); sin key el agente no arranca (falla rápido).
 *
 * Este archivo es solo el "pegamento": la lógica vive en ./meshy-core (testeada).
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';
import {
  generate,
  priceFor,
  PRICE_STATUS_USDC,
  PRICE_TEXT_USDC,
  PRICE_TEXT_HIGH_USDC,
  PRICE_REFINE_USDC,
  PRICE_IMAGE_USDC,
  PRICE_IMAGE_HIGH_USDC,
  type MeshyConfig,
  type MeshyRequest,
  type MeshyResult,
} from './meshy-core';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/meshy.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const config: MeshyConfig = {
  apiKey: process.env.MESHY_API_KEY || '',
  baseUrl: process.env.MESHY_BASE_URL || 'https://api.meshy.ai',
  timeoutMs: Number(process.env.MESHY_TIMEOUT_MS) || 30_000,
  // El gateway espera ≤120 s por llamada (incluido el escrow, 6-20 s): esperas cortas.
  waitCreateMs: Number(process.env.MESHY_WAIT_CREATE_MS) || 15_000,
  waitStatusMs: Number(process.env.MESHY_WAIT_STATUS_MS) || 25_000,
  pollMs: Number(process.env.MESHY_POLL_MS) || 3_000,
};

const agent = new AgentProvider({
  wallet,
  service: '3d-generator',
  pricePerCall: PRICE_STATUS_USDC,
  pricingNote:
    `Consultar tarea ${PRICE_STATUS_USDC} USDC · texto→3D ${PRICE_TEXT_USDC} (quality high ${PRICE_TEXT_HIGH_USDC}) · ` +
    `texturas (refine) ${PRICE_REFINE_USDC} · imagen→3D ${PRICE_IMAGE_USDC} (high ${PRICE_IMAGE_HIGH_USDC})`,
  priceFn: (req: unknown) => priceFor(req),
  description:
    'Genera modelos 3D (GLB/FBX/OBJ) desde un texto o una imagen con Meshy AI. Generate 3D models from a text ' +
    'prompt or an image: { prompt } creates the mesh, { refine: true, taskId } adds textures, { imageUrl } turns a ' +
    'photo into a textured model, { taskId } checks progress and returns download links and a thumbnail. Async: ' +
    'generation takes 1-3 min, poll with taskId. 3D model generation, text to 3D, image to 3D, game assets, AR, 3D printing.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5009',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

agent.serve<MeshyRequest, MeshyResult>((req) => generate(config, req));

(async () => {
  if (!config.apiKey) {
    console.error('[meshy] MESHY_API_KEY sin setear — este servicio no puede operar sin la key de Meshy.');
    process.exit(1);
  }
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[meshy] bootstrap failed:', (err as Error).message);
    console.error('[meshy] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5009);
})().catch((err) => {
  console.error('[meshy] failed to start:', err);
  process.exit(1);
});
