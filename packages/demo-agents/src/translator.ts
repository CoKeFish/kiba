/**
 * Translator Pro — traducción con un LLM (Gemini) cuando hay GEMINI_API_KEY.
 *
 * Sin clave, cae a un diccionario pequeño de frases comunes (demo). Lo contrata, por ejemplo,
 * el servicio `web-brief` para entregar informes en el idioma del usuario.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';

// Gemini (misma clave que usa music-generator). Modelo configurable; sin clave → diccionario.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_TRANSLATE_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_API_URL = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const MAX_CHARS = 20_000;

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/translator.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por longitud del texto a traducir.
// Floor 0.001 USDC (cubre traducciones cortas, header on-chain price_per_call),
// + 0.000005 USDC por cada char. Una frase de 200 chars ≈ 0.002 USDC,
// un párrafo de 1000 chars ≈ 0.006 USDC.
const PRICE_FLOOR_USDC = 0.001;
const PRICE_PER_CHAR_USDC = 0.000005;

const agent = new AgentProvider({
  wallet,
  service: 'translator-pro',
  pricePerCall: PRICE_FLOOR_USDC,
  pricingNote: `Floor ${PRICE_FLOOR_USDC} USDC + ${PRICE_PER_CHAR_USDC} USDC per character translated`,
  priceFn: (req: unknown) => {
    const text = (req as { text?: string })?.text ?? '';
    return PRICE_FLOOR_USDC + text.length * PRICE_PER_CHAR_USDC;
  },
  description:
    'Professional translation across English, Spanish, Portuguese, French, German, Japanese and Chinese, powered by an LLM. Keeps names, numbers and line breaks. Charges by character count.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5003',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
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
  /** Con qué se tradujo: el LLM, el diccionario de frases, o nada (texto tal cual, marcado). */
  engine: 'gemini' | 'dictionary' | 'passthrough';
}

const LANG_NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', zh: 'Chinese',
};

/** Traduce con Gemini; null si no hay clave o la API falla (el llamador cae al diccionario). */
async function translateWithGemini(text: string, target: string, from: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const to = LANG_NAMES[target] ?? target;
  const src = from && from !== 'auto' ? ` from ${LANG_NAMES[from] ?? from}` : '';
  const prompt =
    `Translate the following text${src} into ${to}. Keep line breaks, names, numbers and formatting. ` +
    `Reply with the translation only, without preamble or notes.

${text}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${GEMINI_API_URL}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      console.warn(`[translator] Gemini respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    return out || null;
  } catch (err) {
    console.warn('[translator] Gemini falló:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  const r = req as unknown as Record<string, unknown>;
  const text = String(r.text ?? r.q ?? r.input ?? r.content ?? '');
  const toRaw = String(
    r.to ?? r.target ?? r.target_language ?? r.targetLang ?? r.targetLanguage ?? r.lang ?? 'en',
  ).toLowerCase().trim();
  const fromRaw = String(r.from ?? r.source ?? r.source_language ?? r.sourceLang ?? 'auto');
  const target = (LANG_ALIASES[toRaw] ?? toRaw).slice(0, 2);
  if (text.length > MAX_CHARS) throw new Error(`texto demasiado largo (máximo ${MAX_CHARS} caracteres)`);
  const lower = text.toLowerCase().trim();
  const dict = PHRASES[lower];
  let translated = dict?.[target];
  let engine: TranslateResponse['engine'] = translated ? 'dictionary' : 'passthrough';
  if (!translated && text.trim()) {
    const llm = await translateWithGemini(text, target, fromRaw);
    if (llm) {
      translated = llm;
      engine = 'gemini';
    }
  }
  translated ??= `[${target.toUpperCase()}] ${text}`;
  return {
    original: text,
    translated,
    from: fromRaw,
    to: target,
    confidence: engine === 'passthrough' ? 0.42 : 0.95,
    engine,
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[translator] bootstrap failed:', (err as Error).message);
    console.error('[translator] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5003);
})().catch((err) => {
  console.error('[translator] failed to start:', err);
  process.exit(1);
});
