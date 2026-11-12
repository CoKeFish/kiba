/**
 * E2E de MPP contra el DEMO OFICIAL de Stellar (github.com/stellar/stellar-mpp-sdk), en testnet y
 * con USDC real. Usa su servidor (examples/charge-server.ts) y su cliente (examples/charge-client.ts)
 * tal como vienen en el repositorio, corriendo en la imagen de test/mpp-demo/Dockerfile.
 * Los pasos completos están en test/mpp-demo/run.sh.
 *
 *   node --import tsx test/e2e-mpp-demo.mts prepare   crea las cuentas y escribe /out/demo.env
 *   node --import tsx test/e2e-mpp-demo.mts           corre la prueba
 *
 *   E2E_TREASURY_SECRET   clave S... de una cuenta de testnet con USDC de Circle (la tesorería)
 *   DATABASE_URL          un Postgres vacío
 *   MPP_DEMO_SERVER_URL   el servidor del demo (parte A)
 *   MPP_DEMO_RECIPIENT    la cuenta a la que cobra ese servidor
 *   MPP_DEMO_PAYER        la cuenta con la que paga el cliente del demo (parte B)
 */
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';
process.env.X402_ALLOW_HTTP = '1';
process.env.X402_ALLOW_PRIVATE = '1';

import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import express from 'express';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdc = new Asset('USDC', CIRCLE);
const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
async function classic(signer: Keypair, op: ReturnType<typeof Operation.payment>) {
  const tx = new TransactionBuilder(await hz.loadAccount(signer.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .setTimeout(60)
    .addOperation(op)
    .build();
  tx.sign(signer);
  await hz.submitTransaction(tx);
}
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};

if (process.argv[2] === 'prepare') {
  // Dos cuentas de un solo uso en testnet: a la que cobra el servidor del demo y con la que paga su cliente.
  const recipient = Keypair.random();
  const payer = Keypair.random();
  for (const k of [recipient, payer]) {
    const r = await fetch(`https://friendbot.stellar.org?addr=${k.publicKey()}`);
    if (!r.ok) throw new Error(`friendbot ${r.status}`);
  }
  await Promise.all([recipient, payer].map((k) => classic(k, Operation.changeTrust({ asset: usdc }))));
  await classic(
    payer,
    Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '100', destination: payer.publicKey(), destAsset: usdc, destAmount: '1', path: [] }),
  );
  writeFileSync(
    '/out/demo.env',
    [`MPP_DEMO_RECIPIENT=${recipient.publicKey()}`, `MPP_DEMO_PAYER=${payer.publicKey()}`, `MPP_DEMO_PAYER_SECRET=${payer.secret()}`, ''].join('\n'),
  );
  console.log('cuentas listas');
  process.exit(0);
}

const SECRET = process.env.E2E_TREASURY_SECRET!;
const DEMO_URL = process.env.MPP_DEMO_SERVER_URL!;
const DEMO_RECIPIENT = process.env.MPP_DEMO_RECIPIENT!;
const DEMO_PAYER = process.env.MPP_DEMO_PAYER!;
if (!SECRET || !DEMO_URL || !DEMO_RECIPIENT || !DEMO_PAYER) throw new Error('faltan variables: ver la cabecera');
const treasury = Keypair.fromSecret(SECRET);
process.env.MASTER_WALLET_SECRET = JSON.stringify([...treasury.rawSecretKey(), ...treasury.rawPublicKey()]);

const { db, initDb, pool } = await import('../src/db');
const { callX402Url } = await import('../src/x402');
const { handleMppSell, setMppSellDeps } = await import('../src/mpp-sell');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.00001;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await initDb();
await db.exec('TRUNCATE mpp_store, mpp_payments, agent_earnings, transactions, call_results, users RESTART IDENTITY CASCADE');

// ─── A. Kiba le compra al servidor del demo ─────────────────────────────────
const user = Number(
  (
    await db
      .prepare(
        `INSERT INTO users (email, password_hash, balance_lamports, created_at)
         VALUES ('comprador@kiba.test', 'x', 5000000, ?) RETURNING id`,
      )
      .run(Math.floor(Date.now() / 1000))
  ).lastInsertRowid,
);
const recipientBefore = await usdcOf(DEMO_RECIPIENT);
let t = Date.now();
let bought: Awaited<ReturnType<typeof callX402Url>> | undefined;
try {
  bought = await callX402Url({ userId: user, url: `${DEMO_URL}/` });
} catch (err) {
  console.log('error al comprar:', (err as Error).message);
}
check(
  'A. Kiba le paga al servidor del demo oficial (examples/charge-server.ts)',
  bought?.paid === true && bought.protocol === 'mpp' && bought.cost.lamports === 100_000 && /^[0-9a-f]{64}$/.test(bought.txHash ?? ''),
  `${((Date.now() - t) / 1000).toFixed(0)} s; tx ${bought?.txHash?.slice(0, 12)}…; respuesta ${JSON.stringify(bought?.result).slice(0, 80)}`,
);
check('   la cuenta del demo recibe 0,01 USDC', near((await usdcOf(DEMO_RECIPIENT)) - recipientBefore, 0.01));
const credits = Number(((await db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(user)) as { balance_lamports: number }).balance_lamports);
check('   al usuario se le descuentan 0,01 USDC de sus créditos', credits === 4_900_000);

// ─── B. El cliente del demo le compra a Kiba ────────────────────────────────
const publisher = Keypair.random().publicKey();
setMppSellDeps({
  quote: async (service) => {
    if (service !== 'traductor') throw new Error('service not found');
    return { lamports: 200_000, payTo: publisher }; // 0,02 USDC
  },
  serve: async (_service, payload) => ({ translated: 'hola', echo: payload }),
});
const app = express();
app.use(express.json());
app.all('/mpp/:service', (req, res) => void handleMppSell(req, res));
const server = createServer(app);
await new Promise<void>((r) => server.listen(Number(process.env.PORT) || 8055, '0.0.0.0', r));
const treasuryBefore = await usdcOf(treasury.publicKey());
const payerBefore = await usdcOf(DEMO_PAYER);
console.log('LISTO: la ruta /mpp/traductor espera al cliente del demo');
let payment: Record<string, unknown> | undefined;
for (let i = 0; i < 90 && !payment; i++) {
  await sleep(2000);
  payment = (await db.prepare(`SELECT * FROM mpp_payments WHERE status = 'served' LIMIT 1`).get()) as Record<string, unknown> | undefined;
}
await sleep(3000);
check(
  'B. el cliente del demo oficial (examples/charge-client.ts) paga la ruta pública de Kiba',
  payment?.status === 'served' && payment.payer === DEMO_PAYER && /^[0-9a-f]{64}$/.test(String(payment.reference)),
  payment ? `tx ${String(payment.reference).slice(0, 12)}…; pagador ${String(payment.payer).slice(0, 8)}…` : 'no llegó ningún pago',
);
check(
  '   el USDC sale del cliente y llega a la tesorería de Kiba',
  near((await usdcOf(treasury.publicKey())) - treasuryBefore, 0.02) && near(payerBefore - (await usdcOf(DEMO_PAYER)), 0.02),
);
const earning = (await db.prepare('SELECT pay_to, amount_lamports FROM agent_earnings').get()) as Record<string, unknown> | undefined;
check('   la ganancia queda anotada a nombre del publicador', earning?.pay_to === publisher && Number(earning?.amount_lamports) === 200_000);

server.close();
console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
