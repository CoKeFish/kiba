/**
 * API de ejemplo que cobra con x402 estándar en Stellar.
 *
 * No sabe nada de Kiba: usa los paquetes oficiales de x402 (@x402/express + @x402/stellar)
 * y un facilitador público. Cualquier cliente x402 puede pagarle; Kiba lo hace con la tool
 * `call_url` desde Claude o ChatGPT, descontando del saldo del usuario.
 *
 * Variables (ver .env.example):
 *   STELLAR_RECIPIENT  cuenta G... que recibe el USDC (con trustline USDC; la crea setup.mjs)
 *   STELLAR_NETWORK    stellar:testnet (default) | stellar:pubnet
 *   FACILITATOR_URL    default https://x402.org/facilitator (testnet, sin clave)
 *   FACILITATOR_API_KEY  solo si el facilitador la exige (p. ej. OpenZeppelin Channels)
 *   PORT               default 3001
 */
import 'dotenv/config';
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { StrKey } from '@stellar/stellar-sdk';

const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const PORT = Number(process.env.PORT) || 3001;
const PAY_TO = (process.env.STELLAR_RECIPIENT || '').trim();
if (!StrKey.isValidEd25519PublicKey(PAY_TO)) {
  throw new Error('STELLAR_RECIPIENT debe ser una cuenta Stellar G... válida (corre `npm run setup`).');
}

const facilitatorUrl = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';
const apiKey = process.env.FACILITATOR_API_KEY;
const facilitator = new HTTPFacilitatorClient({
  url: facilitatorUrl,
  ...(apiKey
    ? {
        createAuthHeaders: async () => {
          const h = { Authorization: `Bearer ${apiKey}` };
          return { verify: h, settle: h, supported: h };
        },
      }
    : {}),
});

const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: 'x402 seller demo',
    network: NETWORK,
    payTo: PAY_TO,
    facilitator: facilitatorUrl,
    routes: { 'GET /weather?city=': '$0.01', 'POST /summarize': '$0.02', 'GET /free': 'gratis' },
  });
});

app.get('/free', (_req, res) => {
  res.json({ ok: true, message: 'esta ruta no cobra' });
});

app.use(
  paymentMiddleware(
    {
      'GET /weather': {
        accepts: { scheme: 'exact', price: '$0.01', network: NETWORK, payTo: PAY_TO },
        description: 'Clima actual (simulado) de una ciudad',
        mimeType: 'application/json',
      },
      'POST /summarize': {
        accepts: { scheme: 'exact', price: '$0.02', network: NETWORK, payTo: PAY_TO },
        description: 'Resumen (simulado) de un texto',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

const CONDITIONS = ['soleado', 'nublado', 'lluvia ligera', 'tormenta', 'niebla'];
app.get('/weather', (req, res) => {
  const city = String(req.query.city || 'Bogotá');
  const seed = [...city.toLowerCase()].reduce((a, c) => a + c.charCodeAt(0), 0);
  res.json({
    city,
    tempC: 8 + (seed % 22),
    conditions: CONDITIONS[seed % CONDITIONS.length],
    humidity: 40 + (seed % 50),
    source: 'x402 seller demo (datos simulados)',
    at: new Date().toISOString(),
  });
});

app.post('/summarize', (req, res) => {
  const text = String(req.body?.text ?? '');
  const words = text.split(/\s+/).filter(Boolean);
  res.json({
    words: words.length,
    summary: words.slice(0, 12).join(' ') + (words.length > 12 ? '…' : ''),
    source: 'x402 seller demo (resumen simulado)',
  });
});

app.listen(PORT, () => {
  console.log(`x402 seller en http://0.0.0.0:${PORT} (${NETWORK}) → paga a ${PAY_TO} vía ${facilitatorUrl}`);
});
