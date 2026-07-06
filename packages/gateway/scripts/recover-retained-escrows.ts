/**
 * Recuperación ONE-OFF de saldos atrapados en escrows de ciclo ya cerrados.
 *
 * Antes del settle por sweep, la liquidación cerraba los escrows del ciclo SIN vaciarlos
 * (pagaba al agente con dinero nuevo de la treasury) → el balance fondeado per-call
 * quedaba retenido en el contrato. Como esas earnings YA se pagaron al agente por la vía
 * clásica, lo retenido es dinero de la TREASURY: este script lo barre de vuelta con
 * `withdraw_remaining_funds` (el escrow released ya cuenta como "procesado").
 *
 *   docker compose exec gateway node --import tsx scripts/recover-retained-escrows.ts
 *   railway ssh --service gateway "node --import tsx scripts/recover-retained-escrows.ts"
 *
 * DRY_RUN=1 solo lista lo recuperable. Idempotente: un escrow ya barrido tiene balance 0
 * y se salta. La distribución va a la treasury (menos ~0.3% de fee de TW; el platformFee
 * también vuelve a la treasury).
 */
import { db } from '../src/db';
import { chainClientFor } from '../src/chain';
import { getMasterWallet, masterWalletPubkey } from '../src/wallets';

const DRY_RUN = process.env.DRY_RUN === '1';

async function main(): Promise<void> {
  const cc = chainClientFor(getMasterWallet(), 'recover');
  if (!cc?.escrowChainBalance || !cc.withdrawEscrowRemaining) {
    throw new Error('chain client sin escrowChainBalance/withdrawEscrowRemaining');
  }
  const treasury = masterWalletPubkey();
  console.log(`treasury: ${treasury}${DRY_RUN ? '  (DRY RUN)' : ''}`);

  const rows = (await db
    .prepare(
      "SELECT id, service, escrow_id, funded_lamports FROM service_escrows WHERE status = 'released' ORDER BY id",
    )
    .all()) as Array<{ id: number; service: string; escrow_id: string; funded_lamports: number }>;

  let recovered = 0n;
  for (const r of rows) {
    const balance = await cc.escrowChainBalance(r.escrow_id);
    if (balance <= 0n) continue;
    console.log(`${r.service} ${r.escrow_id}: ${balance} base units retenidos`);
    if (DRY_RUN) {
      recovered += balance;
      continue;
    }
    try {
      // El withdraw exige el escrow "procesado" (released/resolved/disputed). Los ciclos
      // cerrados por el settle VIEJO nunca se liberaron on-chain → release primero (paga
      // el declarado —mínimo— al receiver; idempotente si ya estaba released) y barrer
      // el resto. Misma secuencia que el settle por sweep.
      await cc.claimPayment({ escrowId: r.escrow_id });
      const remaining = await cc.escrowChainBalance(r.escrow_id);
      if (remaining <= 0n) {
        console.log('  → el release drenó todo (declarado ≥ balance); nada que barrer');
        continue;
      }
      const hash = await cc.withdrawEscrowRemaining({
        escrowId: r.escrow_id,
        distributions: [{ address: treasury, amountBaseUnits: remaining }],
      });
      recovered += remaining;
      console.log(`  → recuperado ${remaining} (tx ${hash})`);
    } catch (err) {
      console.error(`  → falló: ${(err as Error).message}`);
    }
  }
  console.log(`\ntotal ${DRY_RUN ? 'recuperable' : 'recuperado'}: ${recovered} base units (${Number(recovered) / 1e7} USDC)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('recover falló:', err.message ?? err);
  process.exit(1);
});
