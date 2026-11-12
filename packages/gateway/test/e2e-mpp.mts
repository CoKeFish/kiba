/**
 * E2E de MPP en TESTNET, con pagos reales en USDC (no corre en `npm test`).
 *
 * Del otro lado no hay nada de Kiba: se usan los paquetes oficiales de Stellar (`@stellar/mpp` y
 * `mppx`), que son los mismos con los que está hecho el demo oficial
 * (github.com/stellar/stellar-mpp-sdk, examples/charge-server.ts y charge-client.ts).
 *
 *   A. Kiba compra: un vendedor oficial cobra 0,01 USDC y Kiba lo paga desde la tesorería.
 *   B. Kiba vende: un comprador oficial paga la ruta pública de un servicio.
 *   C. Un pago ya usado no sirve otra vez.
 *   D. Si el servicio falla después del pago, se le devuelve a quien pagó.
 *
 *   E2E_TREASURY_SECRET   clave S... de una cuenta de testnet con USDC de Circle (la tesorería)
 *   DATABASE_URL          un Postgres vacío
 *
 * Para correrla contra el demo oficial en vez de los paquetes: levanta su servidor y pasa
 * MPP_DEMO_SERVER_URL=http://<host>:3000 (parte A).
 */
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';
process.env.X402_ALLOW_HTTP = '1';
process.env.X402_ALLOW_PRIVATE = '1';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { MppxClient, MppxServer, Store, stellarClientCharge as clientCharge, stellarServerCharge as serverCharge } from '@kiba/mpp';

const SECRET = process.env.E2E_TREASURY_SECRET!;
if (!SECRET) throw new Error('falta E2E_TREASURY_SECRET');
const treasury = Keypair.fromSecret(SECRET);
process.env.MASTER_WALLET_SECRET = JSON.stringify([...treasury.rawSecretKey(), ...treasury.rawPublicKey()]);

const { db, initDb, pool } = await import('../src/db');
const { callX402Url } = await import('../src/x402');
const { MPP_NETWORK, mppCurrency } = await import('../src/mpp');
const { handleMppSell, setMppSellDeps } = await import('../src/mpp-sell');

const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdc = new Asset('USDC', CIRCLE);
const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
const seller = Keypair.random(); // el vendedor externo de la parte A
const payer = Keypair.random(); // el agente externo que le compra a Kiba
const publisher = Keypair.random().publicKey(); // a quién se le anota la ganancia

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.00001;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fund = async (a: string) => {
  const r = await fetch(`https://friendbot.stellar.org?addr=${a}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
};
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
const listen = (handler: Parameters<typeof createServer>[1]) =>
  new Promise<{ base: string; close: () => void }>((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });

await initDb();
await db.exec('TRUNCATE mpp_store, mpp_payments, treasury_payments, agent_earnings, transactions, call_results, users RESTART IDENTITY CASCADE');
console.log(`Tesorería: ${treasury.publicKey()}`);
await Promise.all([seller, payer].map((k) => fund(k.publicKey())));
await Promise.all([seller, payer].map((k) => classic(k, Operation.changeTrust({ asset: usdc }))));
// El agente externo consigue 1 USDC cambiando XLM en el mercado de testnet.
await classic(
  payer,
  Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '100', destination: payer.publicKey(), destAsset: usdc, destAmount: '1', path: [] }),
);
if ((await usdcOf(treasury.publicKey())) < 1) {
  await classic(
    treasury,
    Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '200', destination: treasury.publicKey(), destAsset: usdc, destAmount: '5', path: [] }),
  );
}

// ─── A. Kiba compra ─────────────────────────────────────────────────────────
let sellerUrl = process.env.MPP_DEMO_SERVER_URL ?? '';
let closeSeller = () => {};
if (!sellerUrl) {
  const official = MppxServer.create({
    secretKey: 'vendedor-oficial-de-prueba-0123456789abcdef',
    methods: [serverCharge({ recipient: seller.publicKey(), currency: mppCurrency(), network: MPP_NETWORK, store: Store.memory() })],
  }) as any;
  const s = await listen((req, res) => {
    void (async () => {
      const headers = new Headers();
      if (req.headers.authorization) headers.set('authorization', req.headers.authorization);
      const result = await official.charge({ amount: '0.01', description: 'Premium API access' })(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }));
      const out: Response = result.status === 402 ? result.challenge : result.withReceipt(Response.json({ message: 'Payment verified — here is your premium content.' }));
      res.statusCode = out.status;
      out.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await out.text());
    })();
  });
  sellerUrl = s.base;
  closeSeller = s.close;
}
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
const sellerBefore = process.env.MPP_DEMO_SERVER_URL ? 0 : await usdcOf(seller.publicKey());
const treasuryBeforeA = await usdcOf(treasury.publicKey());
let t = Date.now();
let bought: Awaited<ReturnType<typeof callX402Url>> | undefined;
try {
  bought = await callX402Url({ userId: user, url: `${sellerUrl}/` });
} catch (err) {
  console.log('error al comprar:', (err as Error).message);
}
check(
  'A. Kiba le compra a un vendedor de MPP: reconoce el reto y paga desde la tesorería',
  bought?.paid === true && bought.protocol === 'mpp' && bought.cost.lamports === 100_000 && /^[0-9a-f]{64}$/.test(bought.txHash ?? ''),
  `${((Date.now() - t) / 1000).toFixed(0)} s; tx ${bought?.txHash?.slice(0, 12)}…; respuesta ${JSON.stringify(bought?.result).slice(0, 70)}`,
);
const credits = Number(((await db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(user)) as { balance_lamports: number }).balance_lamports);
check('   al usuario se le descuentan 0,01 USDC de sus créditos', credits === 4_900_000);
check('   la tesorería paga 0,01 USDC en la red', near(treasuryBeforeA - (await usdcOf(treasury.publicKey())), 0.01));
if (!process.env.MPP_DEMO_SERVER_URL) {
  check('   y el vendedor los recibe', near((await usdcOf(seller.publicKey())) - sellerBefore, 0.01));
}
closeSeller();

// ─── B. Kiba vende ──────────────────────────────────────────────────────────
let failNext = false;
setMppSellDeps({
  quote: async (service) => {
    if (service !== 'traductor') throw new Error('service not found');
    return { lamports: 200_000, payTo: publisher }; // 0,02 USDC
  },
  serve: async (_service, payload) => {
    if (failNext) throw new Error('el servicio no responde');
    return { translated: 'hola', echo: payload };
  },
});
const app = express();
app.use(express.json());
app.all('/mpp/:service', (req, res) => void handleMppSell(req, res));
const kiba = await listen(app);
const url = `${kiba.base}/mpp/traductor`;
const buyer = MppxClient.create({ polyfill: false, methods: [clientCharge({ keypair: payer, mode: 'pull' })] });
const body = JSON.stringify({ text: 'hello' });
const post = (authorization?: string) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body });

const treasuryBeforeB = await usdcOf(treasury.publicKey());
const payerBeforeB = await usdcOf(payer.publicKey());
const first = await post();
check('B. Kiba vende: sin pago, la ruta pública responde 402 con el reto de MPP', first.status === 402 && /^Payment /.test(first.headers.get('www-authenticate') ?? ''));
t = Date.now();
let credential = '';
let paid: Response | undefined;
try {
  credential = await buyer.createCredential(first);
  paid = await post(credential);
} catch (err) {
  console.log('error al pagar:', (err as Error).message);
}
const paidBody = paid ? ((await paid.json()) as any) : null;
check(
  '   un agente externo paga con el cliente oficial y recibe el resultado',
  paid?.status === 200 && paidBody?.result?.translated === 'hola' && /^[0-9a-f]{64}$/.test(paidBody?.payment?.reference ?? ''),
  `${((Date.now() - t) / 1000).toFixed(0)} s; tx ${String(paidBody?.payment?.reference).slice(0, 12)}…${paid && paid.status !== 200 ? ' ' + JSON.stringify(paidBody).slice(0, 200) : ''}`,
);
await sleep(3000);
check('   el USDC llega a la tesorería de Kiba', near((await usdcOf(treasury.publicKey())) - treasuryBeforeB, 0.02) && near(payerBeforeB - (await usdcOf(payer.publicKey())), 0.02));
const earning = (await db.prepare('SELECT service, pay_to, amount_lamports FROM agent_earnings').get()) as Record<string, unknown> | undefined;
const payment = (await db.prepare('SELECT status, payer, amount, reference FROM mpp_payments').get()) as Record<string, unknown> | undefined;
check(
  '   la ganancia queda anotada a nombre del publicador y el pago registrado',
  earning?.pay_to === publisher && Number(earning?.amount_lamports) === 200_000 && payment?.status === 'served' && payment?.payer === payer.publicKey(),
  `pagador ${String(payment?.payer).slice(0, 8)}…`,
);

// ─── C. Un pago ya usado no sirve otra vez ──────────────────────────────────
const again = credential ? await post(credential) : undefined;
const earnings = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
check('C. repetir la misma prueba de pago no sirve la llamada otra vez', again !== undefined && again.status !== 200 && earnings.n === 1, `respondió ${again?.status}`);

// ─── D. El servicio falla después del pago ──────────────────────────────────
failNext = true;
const payerBeforeD = await usdcOf(payer.publicKey());
t = Date.now();
let failed: Response | undefined;
try {
  failed = await post(await buyer.createCredential(await post()));
} catch (err) {
  console.log('error:', (err as Error).message);
}
const failedBody = failed ? ((await failed.json()) as any) : null;
await sleep(4000);
check(
  'D. si el servicio falla después del pago, Kiba le devuelve el dinero a quien pagó',
  failed?.status === 502 && failedBody?.refund?.status === 'refunded' && near(await usdcOf(payer.publicKey()), payerBeforeD),
  `${((Date.now() - t) / 1000).toFixed(0)} s; devolución ${String(failedBody?.refund?.transaction).slice(0, 12)}…${failedBody?.refund?.status !== 'refunded' ? ' ' + JSON.stringify(failedBody).slice(0, 200) : ''}`,
);
// La devolución pasó por treasury-pay.ts: su hash quedó guardado y la red lo reconoce.
const { getSpendChain } = await import('../src/spend');
const refundRow = (await db.prepare(`SELECT hash, tx_hash, status FROM treasury_payments WHERE kind = 'mpp-refund'`).get()) as Record<string, string> | undefined;
const seen = refundRow?.hash ? await getSpendChain().txStatus(refundRow.hash) : undefined;
const unknown = await getSpendChain().txStatus('0'.repeat(64));
check(
  '   la red reconoce la devolución por el hash que Kiba guardó antes de enviarla',
  refundRow?.status === 'done' && seen?.status === 'success' && seen.hash === refundRow.tx_hash && unknown.status === 'not_found',
  `guardado ${String(refundRow?.hash).slice(0, 12)}…; en la red ${String(seen?.hash).slice(0, 12)}…`,
);
const afterD = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
check('   y el publicador no gana nada por esa llamada', afterD.n === 1);

kiba.close();
console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
