/**
 * Translator Pro — agente DEMO mockeado.
 *
 * Traducción mock entre ES/EN/DE/FR/JA. Para hackathon usa un diccionario
 * pequeño de frases comunes; en producción sería DeepL o un LLM.
 */
import { AgentProvider, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/translator.json';
const wallet = loadOrCreateKeypair(KEYPAIR_PATH);

const agent = new AgentProvider({
  wallet,
  service: 'translator-pro',
  pricePerCall: 0.005,
  description:
    'Professional translation across English, Spanish, French, German, Japanese and Chinese',
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
  await agent.listen(5003);
})().catch((err) => {
  console.error('[translator] failed to start:', err);
  process.exit(1);
});
