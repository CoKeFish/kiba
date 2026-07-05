/**
 * Cleanup E2E: da de baja el agente efímero del registro on-chain (contrato compartido
 * con prod — no dejar servicios de prueba en el catálogo).
 *
 *   docker compose exec -e SERVICE=e2e-fund-XXX demo-agents node --import tsx src/_e2e_deregister.ts
 */
import { createChainClient, loadOrCreateKeypair } from 'kiba-sdk';

const service = process.env.SERVICE;
if (!service) {
  console.error('Falta SERVICE');
  process.exit(1);
}
const wallet = loadOrCreateKeypair(process.env.E2E_KEYPAIR_PATH ?? '/app/data/e2e-agent.json');
const cc = createChainClient({ wallet, label: 'e2e-cleanup' });
if (!cc) {
  console.error('chain client no disponible (¿STELLAR_CONTRACT_ID?)');
  process.exit(1);
}
cc.deregisterAgent(service)
  .then((sig) => {
    console.log(`'${service}' dado de baja on-chain: ${sig}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('deregister falló:', (err as Error).message);
    process.exit(1);
  });
