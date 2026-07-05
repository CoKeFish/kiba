/**
 * Agente EFÍMERO para el E2E del fund per-call (NO es un demo agent del catálogo).
 *
 * Es el standalone de examples/standalone-agent adaptado para correr dentro del
 * contenedor demo-agents con un SERVICE único por corrida (no pisa nada de prod:
 * keypair propio random + nombre irrepetible; se da de baja al terminar el E2E).
 *
 *   docker compose exec -e SERVICE=e2e-fund-XXX -e PORT=5099 \
 *     -e PUBLIC_ENDPOINT=http://demo-agents:5099 \
 *     -e KIBA_PLATFORM_PUBLIC_KEY=<pubkey del gateway local> \
 *     demo-agents node --import tsx src/_e2e_agent.ts
 */
import { AgentProvider, loadOrCreateKeypair } from 'kiba-sdk';

const wallet = loadOrCreateKeypair(process.env.E2E_KEYPAIR_PATH ?? '/app/data/e2e-agent.json');

const agent = new AgentProvider({
  wallet,
  service: process.env.SERVICE ?? 'e2e-fund-test',
  description: 'Agente efímero E2E (word count) — ignorar, se elimina tras la prueba.',
  endpoint: process.env.PUBLIC_ENDPOINT ?? 'http://demo-agents:5099',
  pricePerCall: 0.01,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  // Vía de confianza asimétrica: acepta llamadas firmadas por el gateway local.
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY },
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.TRUSTLESS_WORK_PLATFORM_ADDRESS ?? wallet.publicKey(),
  },
});

agent.serve(async (req: { text?: string }) => {
  const text = String(req?.text ?? '');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, characters: text.length, readingTimeSeconds: Math.ceil(words / 3) };
});

const port = Number(process.env.PORT ?? 5099);
agent
  .bootstrap()
  .then(() => agent.listen(port))
  .then(() => console.log(`[e2e-agent] '${agent.config.service}' vivo en :${port}`))
  .catch((err: Error) => {
    console.error('[e2e-agent] startup failed:', err.message);
    process.exit(1);
  });
