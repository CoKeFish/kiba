/**
 * E2E de MPP por sesión en TESTNET, con USDC real (no corre en `npm test`).
 *
 * Un agente externo abre un canal de pago hacia Kiba con la fábrica de canales, lo registra y
 * hace varias llamadas pagando con el cliente oficial de Stellar (`@stellar/mpp/channel/client`):
 * cada llamada es solo una firma. Después Kiba le cobra al canal en una sola transacción.
 *
 *   E2E_TREASURY_SECRET      clave S... de una cuenta de testnet con USDC de Circle (la tesorería)
 *   KIBA_CHANNEL_FACTORY_ID  la fábrica de canales desplegada en testnet
 *   DATABASE_URL             un Postgres vacío
 */
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { MppxClient, stellarClientChannel } from '@kiba/mpp';

const SECRET = process.env.E2E_TREASURY_SECRET!;
if (!SECRET || !process.env.KIBA_CHANNEL_FACTORY_ID) throw new Error('faltan E2E_TREASURY_SECRET / KIBA_CHANNEL_FACTORY_ID');
const treasury = Keypair.fromSecret(SECRET);
process.env.MASTER_WALLET_SECRET = JSON.stringify([...treasury.rawSecretKey(), ...treasury.rawPublicKey()]);

const { db, initDb, pool } = await import('../src/db');
const { getSpendChain } = await import('../src/spend');
const { getChannelChain } = await import('../src/channel');
const { handleMppSell, mppRefund, setMppSellDeps } = await import('../src/mpp-sell');
const { getSession, prepareSessionOpen, registerSession, runMppSessionJob, sessionInfo } = await import('../src/mpp-session');

const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdc = new Asset('USDC', CIRCLE);
const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
const agent = Keypair.random(); // la cuenta del agente externo: pone el dinero
const signer = Keypair.random(); // su clave de firmas: no mueve fondos, solo firma lo que debe
const publisher = Keypair.random().publicKey();

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.00001;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function classic(k: Keypair, op: ReturnType<typeof Operation.payment>) {
  const tx = new TransactionBuilder(await hz.loadAccount(k.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .setTimeout(60)
    .addOperation(op)
    .build();
  tx.sign(k);
  await hz.submitTransaction(tx);
}
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};
/** El agente firma con su cuenta una transacción que Kiba le armó y la envía a la red. */
async function signAndSend(xdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(agent);
  return getSpendChain().submitSponsored(tx.toXDR());
}

await initDb();
await db.exec('TRUNCATE mpp_store, mpp_payments, mpp_sessions, agent_earnings RESTART IDENTITY CASCADE');
const fb = await fetch(`https://friendbot.stellar.org?addr=${agent.publicKey()}`);
if (!fb.ok) throw new Error(`friendbot ${fb.status}`);
await classic(agent, Operation.changeTrust({ asset: usdc }));
await classic(
  agent,
  Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '300', destination: agent.publicKey(), destAsset: usdc, destAmount: '2', path: [] }),
);
console.log(`Agente ${agent.publicKey().slice(0, 8)}…; datos para abrir el canal: ${JSON.stringify(sessionInfo())}`);

// 1. El agente abre su canal hacia Kiba con 1 USDC y lo registra.
let t = Date.now();
const prepared = await prepareSessionOpen({ owner: agent.publicKey(), commitmentKey: signer.publicKey(), amount: 10_000_000 });
const openTx = await signAndSend(prepared.xdr);
const session = await registerSession({ openTx });
const channel = session.channel;
check(
  '1. el agente abre un canal hacia Kiba con 1 USDC y Kiba lo acepta tras comprobarlo en la red',
  session.status === 'open' && session.funder === agent.publicKey() && near(await usdcOf(agent.publicKey()), 1),
  `${((Date.now() - t) / 1000).toFixed(0)} s; canal ${channel.slice(0, 8)}…`,
);
// Un contrato cualquiera que no es un canal no se acepta.
let rejected = '';
try {
  await registerSession({ channel: process.env.KIBA_CHANNEL_FACTORY_ID });
} catch (err) {
  rejected = (err as Error).message;
}
check('   un contrato que no es un canal de pago no se puede registrar', /no es un canal de pago/.test(rejected), rejected);

// 2. Tres llamadas pagadas con el cliente oficial: solo firmas.
let price = 300_000; // 0,03 USDC
let failNext = false;
setMppSellDeps({
  quote: async () => ({ lamports: price, payTo: publisher }),
  serve: async (_s, payload) => {
    if (failNext) throw new Error('el servicio no responde');
    return { translated: 'hola', echo: payload };
  },
});
const app = express();
app.use(express.json());
app.all('/mpp/:service', (req, res) => void handleMppSell(req, res));
const server = createServer(app);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mpp/traductor`;
const client = MppxClient.create({ polyfill: false, methods: [stellarClientChannel({ commitmentKey: signer, allowedChannels: [channel] })] });
const post = (authorization?: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mpp-channel': channel, ...(authorization ? { authorization } : {}) },
    body: '{"text":"hello"}',
  });
async function paidCall(): Promise<{ status: number; body: any; ms: number }> {
  const t0 = Date.now();
  const first = await post();
  if (first.status !== 402) return { status: first.status, body: await first.json().catch(() => null), ms: Date.now() - t0 };
  try {
    const r = await post(await client.createCredential(first));
    return { status: r.status, body: await r.json().catch(() => null), ms: Date.now() - t0 };
  } catch (err) {
    return { status: 0, body: { error: (err as Error).message }, ms: Date.now() - t0 };
  }
}
const agentBefore = await usdcOf(agent.publicKey());
const treasuryBefore = await usdcOf(treasury.publicKey());
const calls = [await paidCall(), await paidCall(), await paidCall()];
check(
  '2. tres llamadas pagadas por sesión con el cliente oficial de Stellar',
  calls.every((c) => c.status === 200 && c.body?.result?.translated === 'hola') && calls[2].body?.payment?.cumulativeBaseUnits === 900_000,
  `${calls.map((c) => `${(c.ms / 1000).toFixed(1)} s`).join(', ')}${calls.some((c) => c.status !== 200) ? ' ' + JSON.stringify(calls.find((c) => c.status !== 200)?.body).slice(0, 200) : ''}`,
);
check(
  '   ninguna movió dinero en la red: son solo firmas',
  near(await usdcOf(agent.publicKey()), agentBefore) && near(await usdcOf(treasury.publicKey()), treasuryBefore),
);
const earned = (await db.prepare('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_lamports), 0)::bigint AS total FROM agent_earnings').get()) as { n: number; total: number };
check('   la ganancia del publicador queda anotada por cada llamada', earned.n === 3 && Number(earned.total) === 900_000);

// 3. Una llamada que no cabe en lo depositado no se sirve.
price = 20_000_000; // 2 USDC: más que el canal
const tooMuch = await paidCall();
price = 300_000;
const afterTooMuch = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
check('3. una llamada que cuesta más de lo que queda en el canal no se sirve', tooMuch.status !== 200 && afterTooMuch.n === 3, `respondió ${tooMuch.status}: ${JSON.stringify(tooMuch.body).slice(0, 140)}`);

// 4. Kiba le cobra al canal todo lo firmado, en una sola transacción.
t = Date.now();
const settled = await runMppSessionJob(mppRefund, { force: true });
await sleep(3000);
check(
  '4. Kiba le cobra al canal las tres llamadas en una sola transacción',
  settled === 1 && near((await usdcOf(treasury.publicKey())) - treasuryBefore, 0.09) && (await getSession(channel))?.settledBaseUnits === 900_000,
  `${((Date.now() - t) / 1000).toFixed(0)} s; tesorería +${((await usdcOf(treasury.publicKey())) - treasuryBefore).toFixed(4)} USDC`,
);

// 5. El servicio falla en una llamada: se devuelve después de cobrarle al canal.
failNext = true;
const failed = await paidCall();
failNext = false;
const agentBeforeRefund = await usdcOf(agent.publicKey());
await runMppSessionJob(mppRefund, { force: true });
await sleep(4000);
const refunded = (await db.prepare(`SELECT status, refund_tx FROM mpp_payments WHERE status IN ('refunded', 'refund_pending', 'refunding')`).get()) as Record<string, unknown> | undefined;
check(
  '5. si el servicio falla, Kiba cobra esa firma y le devuelve el dinero al agente',
  failed.status === 502 && refunded?.status === 'refunded' && near((await usdcOf(agent.publicKey())) - agentBeforeRefund, 0.03),
  `agente +${((await usdcOf(agent.publicKey())) - agentBeforeRefund).toFixed(4)} USDC; devolución ${String(refunded?.refund_tx).slice(0, 12)}…`,
);

// 6. El agente pide cerrar el canal por su cuenta con una llamada sin cobrar: Kiba cobra antes.
const last = await paidCall();
const treasuryBeforeClose = await usdcOf(treasury.publicKey());
await signAndSend(await getChannelChain().buildCloseStart(agent.publicKey(), channel));
await sleep(5000);
await runMppSessionJob(mppRefund);
await sleep(3000);
const closed = await getSession(channel);
check(
  '6. si el agente pide cerrar el canal, Kiba cobra lo pendiente de inmediato y lo da por cerrado',
  last.status === 200 && closed?.status === 'closed' && closed.settledBaseUnits === closed.cumulativeBaseUnits && near((await usdcOf(treasury.publicKey())) - treasuryBeforeClose, 0.03),
  `estado ${closed?.status}; cobrado ${closed ? closed.settledBaseUnits / 1e7 : '?'} de ${closed ? closed.cumulativeBaseUnits / 1e7 : '?'} USDC`,
);
const after = await paidCall();
check('   y el canal ya no acepta más llamadas', after.status === 409, `respondió ${after.status}`);

server.close();
console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
