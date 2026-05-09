/**
 * Script manual (no parte del suite). Prueba el stack completo con embeddings REALES
 * para decidir si dejamos semántico habilitado o lo quitamos.
 *
 * Ejecutar:  npx tsx test/manual-semantic.ts
 *
 * Decisión: si las queries en español encuentran agentes descritos en inglés
 * (y viceversa) razonablemente, dejamos semantic+hybrid.
 * Si los rankings son absurdos o tarda > 2s por query (post-warmup), lo quitamos.
 */
import { createInMemoryDb, upsertAgent, setAgentEmbedding, type AgentRecord } from '../src/db';
import { embed, isReady, status as embStatus } from '../src/embeddings';
import { search } from '../src/search';

const SAMPLE_AGENTS: Array<Pick<AgentRecord, 'service' | 'description'>> = [
  { service: 'yield-hunter', description: 'Finds the best APY across DeFi protocols on Solana' },
  { service: 'risk-auditor', description: 'Analyzes the risk of smart contracts and DeFi protocols' },
  { service: 'translator-pro', description: 'Translates documents between English, Spanish, French, German' },
  { service: 'code-reviewer', description: 'Reviews TypeScript and Rust code for bugs and style issues' },
  { service: 'image-generator', description: 'Generates images from text prompts using diffusion models' },
  { service: 'price-oracle', description: 'Real-time crypto prices aggregated from multiple exchanges' },
  { service: 'tweet-summarizer', description: 'Summarizes long Twitter threads into bullet points' },
  { service: 'doc-qa', description: 'Answers questions about uploaded PDFs and documentation' },
  { service: 'sentiment-analyzer', description: 'Detects sentiment of customer reviews in any language' },
  { service: 'meme-coin-screener', description: 'Screens new memecoins on Solana for rug-pull risk' },
];

const QUERIES: Array<{ q: string; expected?: string }> = [
  // Inglés exacto
  { q: 'best APY DeFi', expected: 'yield-hunter' },
  // Inglés sinónimo
  { q: 'find me the highest returns in crypto', expected: 'yield-hunter' },
  // Español → inglés (semántico real)
  { q: 'mejores rendimientos en defi', expected: 'yield-hunter' },
  { q: 'auditar contrato inteligente', expected: 'risk-auditor' },
  { q: 'traducir documentos al alemán', expected: 'translator-pro' },
  { q: 'revisar código rust', expected: 'code-reviewer' },
  { q: 'precios de criptos en tiempo real', expected: 'price-oracle' },
  // Frases naturales
  { q: 'something to detect rugpulls', expected: 'meme-coin-screener' },
  { q: 'turn long threads into bullets', expected: 'tweet-summarizer' },
  // Negativo/raro
  { q: 'cocinar paella', expected: undefined }, // no debería matchear nada relevante
];

function fmtMs(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function recordFor(p: Pick<AgentRecord, 'service' | 'description'>, i: number): AgentRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    pda: `pda-${i}`,
    service: p.service,
    owner_wallet: 'wallet',
    price_per_call: 1_000_000,
    endpoint: `http://test:${5000 + i}`,
    description: p.description,
    total_calls: 0,
    total_earned: 0,
    created_at: now,
    updated_at: now,
    source: 'chain',
    deleted: 0,
  };
}

async function main() {
  console.log('=== manual-semantic ===\n');

  const db = createInMemoryDb();

  // Sembrar agentes
  for (let i = 0; i < SAMPLE_AGENTS.length; i++) {
    upsertAgent(db, recordFor(SAMPLE_AGENTS[i], i));
  }

  // Warmup
  console.log('Cargando modelo (primera vez puede tardar 10-30s)...');
  const t0 = Date.now();
  const warmupVec = await embed('warmup');
  const t1 = Date.now();
  console.log(`Warmup: ${fmtMs(t1 - t0)}, ready=${isReady()}, status=${JSON.stringify(embStatus())}`);
  if (!warmupVec) {
    console.error('❌ Embedding NO disponible — no se puede probar semántico.');
    process.exit(1);
  }
  console.log(`Embedding dims: ${warmupVec.length}\n`);

  // Indexar embeddings
  console.log('Indexando embeddings...');
  const tIdx0 = Date.now();
  for (const a of SAMPLE_AGENTS) {
    const vec = await embed(`${a.service}\n${a.description}`);
    if (vec) setAgentEmbedding(db, a.service, vec);
  }
  const tIdx1 = Date.now();
  console.log(`Indexados ${SAMPLE_AGENTS.length} en ${fmtMs(tIdx1 - tIdx0)} (${fmtMs((tIdx1 - tIdx0) / SAMPLE_AGENTS.length)}/agente)\n`);

  // Probar queries en 3 modos
  let passed = 0;
  let failed = 0;
  const latencies: number[] = [];

  for (const { q, expected } of QUERIES) {
    console.log(`\n── "${q}" ──`);
    for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
      const ts = Date.now();
      const hits = await search(db, { q, mode, limit: 3 });
      const ms = Date.now() - ts;
      latencies.push(ms);
      const top = hits.map((h) => `${h.agent.service}(${h.score.toFixed(2)})`).join(', ');
      const ok = expected
        ? hits[0]?.agent.service === expected
          ? '✓'
          : '✗'
        : hits.length === 0
        ? '✓'
        : '?';
      console.log(`  [${mode.padEnd(8)}] ${fmtMs(ms).padStart(6)} ${ok} ${top || '(sin resultados)'}`);
      if (mode === 'hybrid') {
        if (expected && hits[0]?.agent.service === expected) passed++;
        else if (expected) failed++;
      }
    }
  }

  console.log('\n=== Resumen (modo hybrid sobre queries con expected) ===');
  console.log(`Aciertos top-1: ${passed}/${passed + failed}`);
  const sumLat = latencies.reduce((a, b) => a + b, 0);
  console.log(`Latencia media (todos los modos): ${fmtMs(sumLat / latencies.length)}`);
  console.log(`Latencia max: ${fmtMs(Math.max(...latencies))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
