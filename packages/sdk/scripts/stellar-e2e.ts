/**
 * End-to-end del marketplace COMPLETO sobre Stellar: un AgentProvider real
 * (servidor HTTP Express) y un AgentClient real haciendo el handshake x402 por
 * HTTP, con liquidación en el contrato Soroban de testnet.
 *
 * Esto es lo que significa "el sistema completo funciona": no llamamos al
 * contrato directo, sino que un agente sirve por HTTP y cobra por Stellar.
 *
 * Correr:  node --import tsx scripts/stellar-e2e.ts
 */
import { Keypair } from '@solana/web3.js';
import { AgentProvider } from '../src/provider';
import { AgentClient } from '../src/client';

// Configura la cadena ANTES de construir provider/client (createChainClient lee env).
process.env.CHAIN = 'stellar';
process.env.STELLAR_CONTRACT_ID =
  process.env.STELLAR_CONTRACT_ID ?? 'CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF';

async function main() {
  const PORT = 5599;
  const service = `e2e-${Date.now()}`;

  // Wallets ed25519 (Solana). Con CHAIN=stellar, el SDK deriva la cuenta Stellar
  // del mismo seed → cada uno opera su propia cuenta G... en testnet.
  const agentWallet = Keypair.generate();
  const clientWallet = Keypair.generate();

  // ── Agente: servidor HTTP que cobra por Stellar ──
  const provider = new AgentProvider({
    wallet: agentWallet,
    service,
    pricePerCall: 0.1, // 0.1 XLM
    description: 'e2e echo agent',
    endpoint: `http://127.0.0.1:${PORT}`,
  });
  provider.serve(async (req) => ({ echoed: req }));

  console.log('contract     =', process.env.STELLAR_CONTRACT_ID);
  console.log('agent  addr  =', provider.chain?.ownerAddress);
  console.log('asset/units  =', provider.chain?.asset, provider.chain?.baseUnitsPerToken);

  console.log('\n→ bootstrap agente (friendbot + registro on-chain)…');
  await provider.bootstrap();
  await provider.listen(PORT);
  console.log(`→ agente sirviendo en :${PORT}`);

  // ── Cliente: descubre on-chain, paga vía x402, recibe la respuesta ──
  const client = new AgentClient({ wallet: clientWallet });
  console.log('\nclient addr  =', client.chain?.ownerAddress);
  console.log('→ bootstrap cliente (friendbot)…');
  await client.bootstrap();

  console.log('\n→ client.callWithTrace(service, payload) — handshake x402 completo…');
  const { result, trace } = await client.callWithTrace(
    service,
    { text: 'hola stellar' },
    { timeoutMs: 90_000 },
  );

  const escrowStep = trace.steps.find((s) => s.type === 'escrow_opened') as
    | { signature: string }
    | undefined;
  const respStep = trace.steps.find((s) => s.type === 'service_responded') as
    | { status: number; claimSignature?: string; claimedAmount?: string }
    | undefined;

  console.log('\nresultado     :', JSON.stringify(result));
  console.log('pasos x402    :', trace.steps.map((s) => s.type).join(' → '));
  console.log('escrow tx     :', escrowStep?.signature);
  console.log('claim  tx     :', respStep?.claimSignature);
  console.log('claimed amount:', respStep?.claimedAmount, '(stroops; 95% de 1000000)');

  const ok =
    (result as { echoed?: { text?: string } })?.echoed?.text === 'hola stellar' &&
    !!escrowStep?.signature &&
    escrowStep.signature !== 'NO_ONCHAIN_PROGRAM_ID' &&
    respStep?.status === 200 &&
    !!respStep?.claimSignature;

  console.log('\n════════════════════════════════════════════');
  if (ok) {
    console.log('✅ E2E OK: marketplace completo (agente HTTP + cliente x402)');
    console.log('   liquidando en Stellar testnet de punta a punta.');
    process.exit(0);
  } else {
    console.error('❌ FAIL: el flujo no completó como se esperaba.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
