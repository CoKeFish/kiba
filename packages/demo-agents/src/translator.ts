/**
 * Translator Pro — agente DEMO mockeado.
 *
 * Traducción mock entre ES/EN/DE/FR/JA. Para hackathon usa un diccionario
 * pequeño de frases comunes; en producción sería DeepL o un LLM.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@agent-bazaar/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/translator.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por longitud del texto a traducir.
// Floor 0.001 SOL (cubre traducciones cortas, header on-chain price_per_call),
// + 0.000005 SOL por cada char. Una frase de 200 chars ≈ 0.002 SOL,
// un párrafo de 1000 chars ≈ 0.006 SOL.
const PRICE_FLOOR_SOL = 0.001;
const PRICE_PER_CHAR_SOL = 0.000005;

const agent = new AgentProvider({
  wallet,
  service: 'translator-pro',
  pricePerCall: PRICE_FLOOR_SOL,
  pricingNote: `Floor ${PRICE_FLOOR_SOL} SOL + ${PRICE_PER_CHAR_SOL} SOL per character translated`,
  priceFn: (req: unknown) => {
    const text = (req as { text?: string })?.text ?? '';
    return PRICE_FLOOR_SOL + text.length * PRICE_PER_CHAR_SOL;
  },
  description:
    'Professional translation across English, Spanish, French, German, Japanese and Chinese. Charges by character count.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5003',
});

interface TranslateRequest {
  text: string;
  from?: string;
  to: string;
}

interface TranslateResponse {
  original: string;
  translated: string;
  from: string;
  to: string;
  confidence: number;
}

// Diccionario tiny de frases comunes — suficiente para demo
const PHRASES: Record<string, Record<string, string>> = {
  'hello world': { es: 'hola mundo', fr: 'bonjour le monde', de: 'hallo welt', ja: 'こんにちは世界', zh: '你好世界' },
  'hola mundo': { en: 'hello world', fr: 'bonjour le monde', de: 'hallo welt', ja: 'こんにちは世界', zh: '你好世界' },
  'good morning': { es: 'buenos días', fr: 'bonjour', de: 'guten morgen', ja: 'おはようございます', zh: '早上好' },
  'thank you': { es: 'gracias', fr: 'merci', de: 'danke', ja: 'ありがとう', zh: '谢谢' },
  'gracias': { en: 'thank you', fr: 'merci', de: 'danke', ja: 'ありがとう', zh: '谢谢' },
};

agent.serve<TranslateRequest, TranslateResponse>(async (req) => {
  const lower = (req.text || '').toLowerCase().trim();
  const target = (req.to || 'en').toLowerCase().slice(0, 2);
  const dict = PHRASES[lower];
  const translated = dict?.[target] ?? `[${target.toUpperCase()}] ${req.text}`;
  return {
    original: req.text,
    translated,
    from: req.from ?? 'auto',
    to: target,
    confidence: dict ? 0.97 : 0.42,
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[translator] bootstrap failed:', (err as Error).message);
    console.error('[translator] Continuing without on-chain registration. Make sure PROGRAM_ID is set in .env after deploying the contract.');
  }
  await agent.listen(Number(process.env.PORT) || 5003);
})().catch((err) => {
  console.error('[translator] failed to start:', err);
  process.exit(1);
});
