/**
 * Helper SOLO para DEMO (testnet) del depósito USDC en Stellar.
 *
 *   tsx src/_demo_stellar.ts setup            → crea tesorería + emisor USDC (testnet),
 *                                               friendbot + trustline. Imprime las direcciones.
 *   tsx src/_demo_stellar.ts pay <memo> <amt> → el emisor envía <amt> USDC a la tesorería
 *                                               con ese memo (simula un depósito de usuario).
 *
 * Las llaves se persisten en /app/data/stellar-demo.json (volumen del gateway).
 * NO es código de producción: es un atajo para probar el flujo end-to-end sin un
 * faucet externo de USDC (usamos un emisor de testnet propio).
 */
import {
  Horizon,
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  Memo,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const HORIZON = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const FRIENDBOT = process.env.STELLAR_FRIENDBOT_URL || 'https://friendbot.stellar.org';
const KEYS_PATH = '/app/data/stellar-demo.json';
const server = new Horizon.Server(HORIZON);

interface Keys {
  issuerSecret: string;
  treasurySecret: string;
}

function loadOrCreate(): Keys {
  if (existsSync(KEYS_PATH)) return JSON.parse(readFileSync(KEYS_PATH, 'utf8')) as Keys;
  const keys: Keys = {
    issuerSecret: Keypair.random().secret(),
    treasurySecret: Keypair.random().secret(),
  };
  mkdirSync('/app/data', { recursive: true });
  writeFileSync(KEYS_PATH, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

async function friendbot(pub: string): Promise<void> {
  try {
    const r = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(pub)}`);
    if (r.ok) console.log(`  funded ${pub.slice(0, 6)}…`);
    else console.log(`  (friendbot ${r.status} — ya fondeada probablemente)`);
  } catch {
    console.log('  (friendbot error — ignorado)');
  }
}

async function setup(): Promise<void> {
  const keys = loadOrCreate();
  const issuer = Keypair.fromSecret(keys.issuerSecret);
  const treasury = Keypair.fromSecret(keys.treasurySecret);
  console.log('Fondeando cuentas (friendbot)…');
  await friendbot(issuer.publicKey());
  await friendbot(treasury.publicKey());
  await new Promise((r) => setTimeout(r, 3000));

  const usdc = new Asset('USDC', issuer.publicKey());
  // Trustline USDC en la tesorería (para poder recibir).
  try {
    const acct = await server.loadAccount(treasury.publicKey());
    const hasTrust = acct.balances.some(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === issuer.publicKey(),
    );
    if (!hasTrust) {
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.changeTrust({ asset: usdc }))
        .setTimeout(60)
        .build();
      tx.sign(treasury);
      await server.submitTransaction(tx);
      console.log('  trustline USDC agregada a la tesorería');
    } else {
      console.log('  trustline USDC ya existía');
    }
  } catch (e) {
    console.error('  error trustline:', (e as Error).message);
  }

  console.log('\n=== Configura el gateway con esto ===');
  console.log(`STELLAR_DEPOSIT_ADDRESS=${treasury.publicKey()}`);
  console.log(`TRUSTLESS_WORK_TRUSTLINE_ADDRESS=${issuer.publicKey()}`);
}

async function pay(memo: string, amount: string): Promise<void> {
  const keys = loadOrCreate();
  const issuer = Keypair.fromSecret(keys.issuerSecret);
  const treasury = Keypair.fromSecret(keys.treasurySecret);
  const usdc = new Asset('USDC', issuer.publicKey());
  const acct = await server.loadAccount(issuer.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: treasury.publicKey(), asset: usdc, amount }))
    .addMemo(Memo.text(memo))
    .setTimeout(60)
    .build();
  tx.sign(issuer);
  const res = await server.submitTransaction(tx);
  console.log(`Enviados ${amount} USDC a la tesorería con memo "${memo}". tx: ${res.hash}`);
}

const [cmd, a, b] = process.argv.slice(2);
(async () => {
  if (cmd === 'setup') await setup();
  else if (cmd === 'pay') await pay(a, b || '1');
  else console.log('uso: setup | pay <memo> <amount>');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
