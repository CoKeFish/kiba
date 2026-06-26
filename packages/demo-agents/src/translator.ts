/**
 * Translator Pro — agente DEMO mockeado.
 *
 * Traducción mock entre ES/EN/DE/FR/JA. Para hackathon usa un diccionario
 * pequeño de frases comunes; en producción sería DeepL o un LLM.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/translator.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por longitud del texto a traducir.
// Floor 0.001 XLM (cubre traducciones cortas, header on-chain price_per_call),
// + 0.000005 XLM por cada char. Una frase de 200 chars ≈ 0.002 XLM,
// un párrafo de 1000 chars ≈ 0.006 XLM.
const PRICE_FLOOR_XLM = 0.001;
const PRICE_PER_CHAR_XLM = 0.000005;

const agent = new AgentProvider({
  wallet,
  service: 'translator-pro',
  pricePerCall: PRICE_FLOOR_XLM,
  pricingNote: `Floor ${PRICE_FLOOR_XLM} XLM + ${PRICE_PER_CHAR_XLM} XLM per character translated`,
  priceFn: (req: unknown) => {
    const text = (req as { text?: string })?.text ?? '';
    return PRICE_FLOOR_XLM + text.length * PRICE_PER_CHAR_XLM;
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

// Los LLMs (ChatGPT/Claude) adivinan los nombres de campo del payload. Aceptamos
// sinónimos comunes para no traducir al idioma equivocado, y normalizamos nombres
// de idioma ("spanish" → "es") además de los códigos ISO.
const LANG_ALIASES: Record<string, string> = {
  spanish: 'es', español: 'es', espanol: 'es',
  english: 'en', inglés: 'en', ingles: 'en',
  french: 'fr', francés: 'fr', frances: 'fr',
  german: 'de', alemán: 'de', aleman: 'de',
  japanese: 'ja', japonés: 'ja', japones: 'ja',
  chinese: 'zh', chino: 'zh',
};

agent.serve<TranslateRequest, TranslateResponse>(async (req) => {
  const r = req as Record<string, unknown>;
  const text = String(r.text ?? r.q ?? r.input ?? r.content ?? '');
  const toRaw = String(
    r.to ?? r.target ?? r.target_language ?? r.targetLang ?? r.targetLanguage ?? r.lang ?? 'en',
  ).toLowerCase().trim();
  const fromRaw = String(r.from ?? r.source ?? r.source_language ?? r.sourceLang ?? 'auto');
  const target = (LANG_ALIASES[toRaw] ?? toRaw).slice(0, 2);
  const lower = text.toLowerCase().trim();
  const dict = PHRASES[lower];
  const translated = dict?.[target] ?? `[${target.toUpperCase()}] ${text}`;
  return {
    original: text,
    translated,
    from: fromRaw,
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
