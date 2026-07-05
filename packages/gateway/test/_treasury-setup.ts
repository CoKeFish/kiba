/**
 * Helper E2E: fondea la treasury local (friendbot XLM + trustline USDC) e imprime
 * su dirección y balance USDC. El USDC en sí viene del faucet de Circle (manual).
 *
 *   docker compose exec gateway node --import tsx test/_treasury-setup.ts
 */
import { ensureTreasuryFunded, getMasterWallet } from '../src/wallets';
import { chainClientFor } from '../src/chain';

async function main(): Promise<void> {
  await ensureTreasuryFunded();
  const cc = chainClientFor(getMasterWallet(), 'treasury');
  if (!cc) throw new Error('chain client no disponible');
  console.log(`address: ${cc.ownerAddress}`);
  console.log(`USDC baseUnits: ${(await cc.getBalanceBaseUnits()).toString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
