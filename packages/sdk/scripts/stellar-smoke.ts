/**
 * Smoke test de integración del StellarChainClient contra el contrato Agent
 * Bazaar desplegado en testnet de Stellar. Ejercita el flujo completo a través
 * del cliente TypeScript (no del CLI): registerAgent → openEscrow → claimPayment,
 * verificando la transición de estado del escrow Pending → Completed.
 *
 * Correr:  node --import tsx scripts/stellar-smoke.ts
 *
 * Genera dos cuentas nuevas y las fondea con friendbot, así que es autocontenido.
 */
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { StellarChainClient } from '../src/chain/stellar';

const CONTRACT_ID =
  process.env.STELLAR_CONTRACT_ID ?? 'CA5M54YV4KG3E75YDJEUXY2C4FYBIEHTQJVZQASYF2WPJUO4KHEIQ62M';
const RPC = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const FRIENDBOT = process.env.STELLAR_FRIENDBOT_URL ?? 'https://friendbot.stellar.org';

async function main() {
  const common = {
    contractId: CONTRACT_ID,
    rpcUrl: RPC,
    networkPassphrase: Networks.TESTNET,
    friendbotUrl: FRIENDBOT,
  };

  const agent = new StellarChainClient({ ...common, keypair: Keypair.random(), label: 'agent' });
  const client = new StellarChainClient({ ...common, keypair: Keypair.random(), label: 'client' });

  console.log('contract =', CONTRACT_ID);
  console.log('agent    =', agent.ownerAddress);
  console.log('client   =', client.ownerAddress);

  console.log('\n→ fondeando ambas cuentas (friendbot)…');
  await agent.ensureFunds(0, 0);
  await client.ensureFunds(0, 0);

  const service = `ts-smoke-${Date.now()}`;
  const nonce = BigInt(Date.now());
  const PRICE = 1_000_000n; // 0.1 XLM
  const AMOUNT = 10_000_000n; // 1.0 XLM → split 95/5 dentro del contrato

  console.log(`\n→ registerAgent(${service}, price=${PRICE})`);
  console.log('  tx:', await agent.registerAgent({
    service,
    pricePerCallBaseUnits: PRICE,
    endpoint: 'http://ts-smoke:5001',
    description: 'integration smoke',
  }));

  console.log('\n→ fetchAgent');
  const registered = await agent.fetchAgent(service);
  console.log('  ', registered);

  console.log(`\n→ openEscrow(nonce=${nonce}, amount=${AMOUNT})`);
  console.log('  tx:', await client.openEscrow({
    service,
    payToAddress: agent.ownerAddress,
    nonce,
    amountBaseUnits: AMOUNT,
  }));

  console.log('\n→ fetchEscrow (esperado Pending)');
  const before = await agent.fetchEscrow({ clientAddress: client.ownerAddress, nonce });
  console.log('  ', before);

  console.log('\n→ claimPayment');
  console.log('  tx:', await agent.claimPayment({
    clientAddress: client.ownerAddress,
    nonce,
    service,
  }));

  console.log('\n→ fetchEscrow (esperado Completed)');
  const after = await agent.fetchEscrow({ clientAddress: client.ownerAddress, nonce });
  console.log('  ', after);

  const ok =
    registered?.pricePerCallBaseUnits === PRICE &&
    before?.state === 'Pending' &&
    before?.amountBaseUnits === AMOUNT &&
    after?.state === 'Completed';

  console.log('\n════════════════════════════════════════════');
  if (ok) {
    console.log('✅ StellarChainClient OK: flujo register → escrow → claim a través');
    console.log('   del cliente TS; escrow Pending → Completed verificado on-chain.');
  } else {
    console.error('❌ FAIL: el flujo no terminó en el estado esperado.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
