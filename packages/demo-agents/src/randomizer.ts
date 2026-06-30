/**
 * Randomizer — generador de números aleatorios y sorteos. DEMO con
 * aleatoriedad REAL (node:crypto), no mock. Para cualquier usuario:
 * número al azar en un rango, lanzar dados, cara o cruz, elegir de una
 * lista o barajarla.
 *
 * Ejemplos de uso vía call_agent:
 *   { "min": 1, "max": 100 }
 *   { "type": "dice", "dice": "2d6" }
 *   { "type": "coin", "count": 3 }
 *   { "type": "pick", "choices": ["pizza", "sushi", "tacos"] }
 *   { "type": "shuffle", "choices": ["A", "B", "C", "D"] }
 */
import { randomInt } from 'node:crypto';
import { AgentProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/randomizer.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing flat: un sorteo por llamada, simple y barato.
const PRICE_PER_CALL_USDC = 0.0003;
const MAX_COUNT = 1000;

type Mode = 'int' | 'float' | 'coin' | 'dice' | 'pick' | 'shuffle';

interface RandomRequest {
  type?: Mode;
  min?: number;
  max?: number;
  count?: number;
  choices?: string[];
  /** Notación de dados, p.ej. "2d6" (2 dados de 6 caras). */
  dice?: string;
  /** Alternativa a la notación: caras por dado. */
  sides?: number;
  /** Alternativa a la notación: número de dados. */
  rolls?: number;
}

interface RandomResponse {
  type: Mode;
  results: Array<number | string>;
  total?: number;
  detail: string;
  randomness: string;
}

const CRYPTO_NOTE = 'crypto-secure (node:crypto.randomInt)';

function clampCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_COUNT, Math.max(1, Math.floor(value)));
}

function resolveMode(req: RandomRequest): Mode {
  if (req.type) return req.type;
  if (req.dice || typeof req.sides === 'number') return 'dice';
  if (Array.isArray(req.choices) && req.choices.length > 0) return 'pick';
  return 'int';
}

/** Fisher-Yates con sesgo nulo (randomInt es uniforme). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseDice(req: RandomRequest): { rolls: number; sides: number } {
  if (req.dice) {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(req.dice);
    if (m) return { rolls: Number(m[1]), sides: Number(m[2]) };
  }
  return {
    rolls: clampCount(req.rolls, 1),
    sides: Math.min(1_000_000, Math.max(2, Math.floor(req.sides ?? 6))),
  };
}

function run(req: RandomRequest): RandomResponse {
  const mode = resolveMode(req);

  switch (mode) {
    case 'float': {
      const count = clampCount(req.count, 1);
      const min = typeof req.min === 'number' ? req.min : 0;
      const max = typeof req.max === 'number' ? req.max : 1;
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      const results = Array.from({ length: count }, () =>
        Math.round((lo + Math.random() * (hi - lo)) * 10000) / 10000,
      );
      return { type: mode, results, detail: `${count}× float en [${lo}, ${hi}]`, randomness: 'Math.random' };
    }

    case 'coin': {
      const count = clampCount(req.count, 1);
      const results = Array.from({ length: count }, () => (randomInt(0, 2) === 0 ? 'Heads' : 'Tails'));
      return { type: mode, results, detail: count === 1 ? 'Lanzamiento de moneda' : `${count} lanzamientos`, randomness: CRYPTO_NOTE };
    }

    case 'dice': {
      const { rolls, sides } = parseDice(req);
      const results = Array.from({ length: rolls }, () => randomInt(1, sides + 1));
      const total = results.reduce((a, b) => a + b, 0);
      return { type: mode, results, total, detail: `${rolls}d${sides}`, randomness: CRYPTO_NOTE };
    }

    case 'pick': {
      const choices = Array.isArray(req.choices) ? req.choices : [];
      if (choices.length === 0) {
        return { type: mode, results: [], detail: 'Falta "choices": []  con al menos un elemento', randomness: CRYPTO_NOTE };
      }
      const count = Math.min(clampCount(req.count, 1), choices.length);
      const results = shuffle(choices).slice(0, count);
      return { type: mode, results, detail: `Elegidos ${count} de ${choices.length}`, randomness: CRYPTO_NOTE };
    }

    case 'shuffle': {
      const choices = Array.isArray(req.choices) ? req.choices : [];
      if (choices.length === 0) {
        return { type: mode, results: [], detail: 'Falta "choices": []  con al menos un elemento', randomness: CRYPTO_NOTE };
      }
      return { type: mode, results: shuffle(choices), detail: `Lista barajada (${choices.length})`, randomness: CRYPTO_NOTE };
    }

    case 'int':
    default: {
      const count = clampCount(req.count, 1);
      const min = Math.floor(typeof req.min === 'number' ? req.min : 1);
      const max = Math.floor(typeof req.max === 'number' ? req.max : 100);
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      const results = Array.from({ length: count }, () => randomInt(lo, hi + 1));
      return { type: 'int', results, detail: `${count}× entero en [${lo}, ${hi}]`, randomness: CRYPTO_NOTE };
    }
  }
}

const agent = new AgentProvider({
  wallet,
  service: 'randomizer',
  pricePerCall: PRICE_PER_CALL_USDC,
  pricingNote: `flat ${PRICE_PER_CALL_USDC} USDC por sorteo (hasta ${MAX_COUNT} resultados)`,
  description:
    'Números al azar y sorteos: elige un número en un rango, lanza dados, cara o cruz, escoge de una lista o barájala. Random numbers and draws: pick a number in a range, roll dice, flip a coin, pick from a list or shuffle it. Aleatoriedad crypto-segura, real (no mock).',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5008',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

agent.serve<RandomRequest, RandomResponse>(async (req) => run(req ?? {}));

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[randomizer] bootstrap failed:', (err as Error).message);
    console.error('[randomizer] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5008);
})().catch((err) => {
  console.error('[randomizer] failed to start:', err);
  process.exit(1);
});
