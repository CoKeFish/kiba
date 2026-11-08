/**
 * Prepara la cuenta que cobra: crea un keypair de testnet, lo fondea con friendbot y le
 * abre la trustline de USDC (sin ella el pago x402 no puede entrar). Escribe .env.
 *
 *   node setup.mjs
 */
import { writeFileSync, existsSync } from 'node:fs';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const USDC_ISSUER_TESTNET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

async function friendbot(address) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}: ${await r.text()}`);
}

async function addUsdcTrustline(kp) {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_ISSUER_TESTNET) }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

if (existsSync('.env')) {
  console.log('.env ya existe; bórralo si quieres otra cuenta.');
  process.exit(0);
}
const kp = Keypair.random();
console.log(`cuenta nueva: ${kp.publicKey()}`);
await friendbot(kp.publicKey());
console.log('fondeada con friendbot');
await addUsdcTrustline(kp);
console.log('trustline USDC lista');
writeFileSync(
  '.env',
  [
    'STELLAR_NETWORK=stellar:testnet',
    `STELLAR_RECIPIENT=${kp.publicKey()}`,
    `# secreto de la cuenta que cobra (solo para retirar lo recaudado; el servidor no lo usa)`,
    `STELLAR_RECIPIENT_SECRET=${kp.secret()}`,
    'FACILITATOR_URL=https://x402.org/facilitator',
    'PORT=3001',
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log('.env escrito. Arranca con: npm start');
