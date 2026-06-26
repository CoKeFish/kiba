/**
 * Code Reviewer — agente DEMO mockeado.
 *
 * Hace "review" de un snippet de código devolviendo issues canned.
 * En producción sería un LLM con contexto del lenguaje específico.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/code-reviewer.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por líneas de código analizadas.
// Floor 0.005 XLM (cubre snippets cortos), + 0.0002 XLM por línea.
// Una función de 30 líneas ≈ 0.011 XLM, un módulo de 200 líneas ≈ 0.045 XLM.
const PRICE_FLOOR_XLM = 0.005;
const PRICE_PER_LINE_XLM = 0.0002;

const agent = new AgentProvider({
  wallet,
  service: 'code-reviewer',
  pricePerCall: PRICE_FLOOR_XLM,
  pricingNote: `Floor ${PRICE_FLOOR_XLM} XLM + ${PRICE_PER_LINE_XLM} XLM per line of code reviewed`,
  priceFn: (req: unknown) => {
    const code = (req as { code?: string })?.code ?? '';
    const lines = code.split('\n').length;
    return PRICE_FLOOR_XLM + lines * PRICE_PER_LINE_XLM;
  },
  description:
    'Reviews TypeScript, Rust and Solidity code for bugs, style issues, and common security vulnerabilities. Charges by line count.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5005',
});

interface ReviewRequest {
  code: string;
  language?: string;
}

interface Issue {
  severity: 'info' | 'warning' | 'error';
  line?: number;
  rule: string;
  message: string;
}

interface ReviewResponse {
  language: string;
  lines_analyzed: number;
  issues: Issue[];
  summary: string;
}

const HEURISTICS: Array<{ pattern: RegExp; issue: Omit<Issue, 'line'> }> = [
  {
    pattern: /console\.log/,
    issue: { severity: 'info', rule: 'no-console', message: 'console.log detected — quitar antes de prod' },
  },
  {
    pattern: /any/,
    issue: { severity: 'warning', rule: 'no-explicit-any', message: 'Tipo `any` debilita la type safety' },
  },
  {
    pattern: /eval\(/,
    issue: { severity: 'error', rule: 'no-eval', message: 'eval() es inseguro y prácticamente nunca necesario' },
  },
  {
    pattern: /TODO|FIXME/i,
    issue: { severity: 'info', rule: 'no-todo', message: 'TODO/FIXME pendiente sin issue tracker link' },
  },
  {
    pattern: /unwrap\(\)/,
    issue: { severity: 'warning', rule: 'no-unwrap', message: 'unwrap() puede panicar en runtime — preferir match o ?' },
  },
  {
    pattern: /\.clone\(\)/,
    issue: { severity: 'info', rule: 'unnecessary-clone', message: 'Verificar si el clone es necesario o si se puede usar referencia' },
  },
];

agent.serve<ReviewRequest, ReviewResponse>(async (req) => {
  const code = req.code || '';
  const lines = code.split('\n');
  const issues: Issue[] = [];

  lines.forEach((lineText, idx) => {
    for (const h of HEURISTICS) {
      if (h.pattern.test(lineText)) {
        issues.push({ ...h.issue, line: idx + 1 });
      }
    }
  });

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return {
    language: req.language ?? 'auto-detected',
    lines_analyzed: lines.length,
    issues,
    summary:
      errors > 0
        ? `${errors} error${errors > 1 ? 's' : ''} crítico${errors > 1 ? 's' : ''} + ${warnings} warning${warnings !== 1 ? 's' : ''}`
        : warnings > 0
          ? `${warnings} warning${warnings > 1 ? 's' : ''} de estilo / seguridad`
          : `Sin issues detectados en ${lines.length} líneas`,
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[code-reviewer] bootstrap failed:', (err as Error).message);
    console.error('[code-reviewer] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5005);
})().catch((err) => {
  console.error('[code-reviewer] failed to start:', err);
  process.exit(1);
});
