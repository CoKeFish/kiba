/**
 * Lyria — agente REAL (no mockeado): generación de música con Google Lyria (Gemini API).
 * Se publica/invoca on-chain como **music-generator**.
 *
 * Qué resuelve para un asistente que no puede componer audio solo:
 *   - "hazme una canción pop en español sobre X"   → { prompt } (MP3 de hasta ~3 min + letra)
 *   - "un jingle de 30 segundos"                     → { prompt, format: 'clip' }
 *   - "sin voz" / "con esta letra"                   → { instrumental: true } / { lyrics }
 *
 * Lyria devuelve el MP3 entero (varios MB) en la misma respuesta; como eso no cabe en un
 * resultado MCP, el agente lo guarda en disco con caducidad y devuelve un enlace de descarga
 * servido aquí mismo (GET /audio/<id>.mp3). Ver lyria-core.ts.
 *
 * Igual que el resto de agentes: registra el servicio on-chain en bootstrap() y cobra vía
 * x402 / llamadas firmadas por la plataforma. La key (GEMINI_API_KEY) es REQUERIDA y el
 * proyecto de Google debe tener facturación (Lyria no tiene free tier); sin key no arranca.
 *
 * Este archivo es solo el "pegamento": la lógica vive en ./lyria-core (testeada).
 */
import path from 'node:path';
import type { Request, Response } from 'express';
import { AgentProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';
import {
  generate,
  priceFor,
  isSafeName,
  sweepExpired,
  PRICE_CLIP_USDC,
  PRICE_SONG_USDC,
  type LyriaConfig,
  type LyriaRequest,
  type LyriaResult,
} from './lyria-core';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/lyria.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const PUBLIC_ENDPOINT = process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5010';

const config: LyriaConfig = {
  apiKey: process.env.GEMINI_API_KEY || '',
  baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
  // Una canción tarda ~40-60 s; el gateway espera ≤120 s por llamada (escrow incluido).
  timeoutMs: Number(process.env.LYRIA_TIMEOUT_MS) || 100_000,
  audioDir: process.env.LYRIA_AUDIO_DIR || '/tmp/lyria-audio',
  publicBaseUrl: PUBLIC_ENDPOINT,
  ttlMs: Number(process.env.LYRIA_AUDIO_TTL_MS) || 24 * 60 * 60 * 1000,
};

const agent = new AgentProvider({
  wallet,
  service: 'music-generator',
  pricePerCall: PRICE_CLIP_USDC,
  pricingNote: `Clip de 30 s ${PRICE_CLIP_USDC} USDC · canción completa (hasta ~3 min) ${PRICE_SONG_USDC} USDC`,
  priceFn: (req: unknown) => priceFor(req),
  description:
    'Genera canciones y clips musicales con letra (o instrumentales) a partir de un texto con Google Lyria. ' +
    'Generate original music from a text prompt: { prompt } returns a full song (up to ~3 min) as an MP3 download ' +
    'link plus the lyrics; { prompt, format: "clip" } returns a 30-second clip; { instrumental: true } for no vocals; ' +
    '{ lyrics } to sing your own words. Any language. Music generation, text to music, songs, jingles, background ' +
    'music, soundtracks.',
  endpoint: PUBLIC_ENDPOINT,
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

agent.serve<LyriaRequest, LyriaResult>((req) => generate(config, req));

// Descarga del audio generado: GET /audio/<id>.mp3 (nombre validado; sin rutas). Caduca por TTL.
agent.app.get('/audio/:name', (req: Request, res: Response) => {
  const name = String(req.params.name ?? '');
  if (!isSafeName(name)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const file = path.join(config.audioDir, name);
  res.sendFile(file, { headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'expired or not found' });
  });
});

(async () => {
  if (!config.apiKey) {
    console.error('[lyria] GEMINI_API_KEY sin setear — este servicio no puede operar sin la key de Google.');
    process.exit(1);
  }
  setInterval(() => void sweepExpired(config), 10 * 60 * 1000).unref();
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[lyria] bootstrap failed:', (err as Error).message);
    console.error('[lyria] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5010);
})().catch((err) => {
  console.error('[lyria] failed to start:', err);
  process.exit(1);
});
