/**
 * E2E de las llamadas pagadas desde el depósito retirable, contra Stellar TESTNET y un servicio
 * de demostración real (world-clock). No corre en `npm test`.
 *
 * Comprueba el camino completo de una llamada (callOnBehalf): se aparta del depósito, el
 * servicio responde, Kiba cobra por tandas al canal, y un retiro pedido directamente al contrato
 * (sin pasar por Kiba) se detecta y se cobra dentro de la espera.
 *
 * Necesita el servicio corriendo y confiando en la clave de plataforma de esta prueba:
 *   MASTER_WALLET_SECRET   la misma con la que se calculó KIBA_PLATFORM_PUBLIC_KEY del servicio
 *   E2E_AGENT_URL          p. ej. http://kiba-chan-agent:5007
 */
import http from 'node:http';
import { Keypair as SolKeypair } from '@solana/web3.js';
import {
  Asset,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  type Transaction,
} from '@stellar/stellar-sdk';

const AGENT_URL = process.env.E2E_AGENT_URL!;
if (!AGENT_URL || !process.env.MASTER_WALLET_SECRET) throw new Error('faltan E2E_AGENT_URL / MASTER_WALLET_SECRET');

const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const fund = async (addr: string) => {
  const r = await fetch(`https://friendbot.stellar.org?addr=${addr}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${r.status}`); // 400 = ya fondeada
};
async function classic(signer: Keypair, ops: ReturnType<typeof Operation.payment>[]) {
  const b = new TransactionBuilder(await hz.loadAccount(signer.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET }).setTimeout(60);
  ops.forEach((o) => b.addOperation(o));
  const tx = b.build();
  tx.sign(signer);
  await hz.submitTransaction(tx);
}
/** El usuario invoca el contrato del canal por su cuenta, pagando él la comisión: sin Kiba. */
async function userInvokesDirectly(signer: Keypair, channel: string, fn: string) {
  let tx = new TransactionBuilder(await server.getAccount(signer.publicKey()), { fee: '100000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(channel).call(fn))
    .setTimeout(60)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  const res = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (res.status !== 'SUCCESS') throw new Error(`${fn} ${res.status}`);
}

// Descubrimiento mínimo en proceso: el gateway pregunta por el servicio y se le da su manifiesto.
const discovery = http.createServer(async (req, res) => {
  try {
    const m = (await (await fetch(`${AGENT_URL}/manifest`)).json()) as Record<string, unknown>;
    if (req.url !== `/agents/${m.service}`) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...m, endpoint: AGENT_URL }));
  } catch {
    res.writeHead(502).end();
  }
});
await new Promise<void>((r) => discovery.listen(9911, '127.0.0.1', r));

// ─── Entorno del gateway ───
const WAIT_LEDGERS = 6;
const sol = SolKeypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.MASTER_WALLET_SECRET!)));
const treasury = Keypair.fromRawEd25519Seed(Buffer.from(sol.secretKey.slice(0, 32)));
const issuer = Keypair.random();
const user = Keypair.random();
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';
process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS = issuer.publicKey();
process.env.KIBA_DISCOVERY_URL = 'http://127.0.0.1:9911';
process.env.CHANNEL_REFUND_WAIT_LEDGERS = String(WAIT_LEDGERS);
process.env.CHANNEL_SETTLE_THRESHOLD = '20000'; // 0.002 USDC: cuatro llamadas de una zona
process.env.RESULT_FILES = '0';
delete process.env.TRUSTLESS_WORK_API_KEY;
delete process.env.KIBA_CHANNEL_FACTORY_ID;
delete process.env.STELLAR_CONTRACT_ID;

const { db, initDb, pool } = await import('../src/db');
const spend = await import('../src/spend');
const channel = await import('../src/channel');
const { callOnBehalf } = await import('../src/proxy');
const { getUserBalances } = await import('../src/wallets');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const usdc = new Asset('USDC', issuer.publicKey());
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};
const until = async (cond: () => Promise<boolean>, secs = 60) => {
  for (let i = 0; i < secs; i++) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};
async function userSends(uid: number, p: { xdr: string }) {
  const tx = TransactionBuilder.fromXDR(p.xdr, Networks.TESTNET) as Transaction;
  tx.sign(user);
  return spend.submitPrepared(uid, { signedXdr: tx.toXDR() });
}

await initDb();
await db.exec(
  'TRUNCATE pay_channel_holds, pay_channel_moves, pay_channels, spend_prepared, spend_charges, agent_earnings, transactions, users RESTART IDENTITY CASCADE',
);
console.log('Montando token, tesorería, wallet y depósito en testnet...');
await Promise.all([issuer, treasury].map((k) => fund(k.publicKey())));
await classic(treasury, [Operation.changeTrust({ asset: usdc })]);
{
  let tx = new TransactionBuilder(await server.getAccount(issuer.publicKey()), { fee: '100000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.createStellarAssetContract({ asset: usdc }))
    .setTimeout(60)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(issuer);
  const sent = await server.sendTransaction(tx);
  await server.pollTransaction(sent.hash, { attempts: 60 });
}
const uid = Number(
  (
    await db
      .prepare(
        `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
         VALUES ('e2e-calls@kiba.test', 'x', '[]', 'x', 0, ?) RETURNING id`,
      )
      .run(Math.floor(Date.now() / 1000))
  ).lastInsertRowid,
);
await userSends(uid, (await spend.prepareActivation(uid, user.publicKey()))!);
await classic(issuer, [Operation.payment({ destination: user.publicKey(), asset: usdc, amount: '5' })]);
await userSends(uid, await channel.prepareChannelOpen(uid, { address: user.publicKey(), amount: 2e7 }));

// 1. Una llamada real: sin crédito, se paga del depósito.
let t = Date.now();
const first = await callOnBehalf({ userId: uid, service: 'world-clock', payload: { zone: 'Tokyo' } });
const ms = Date.now() - t;
const now = (first.result as { now?: { zone?: string }[] }).now;
check(
  '1. la llamada se sirve y se paga del depósito',
  first.mode === 'deposit' && first.paidWith === 'wallet' && Array.isArray(now) && now.length === 1 && first.cost.lamports === 5000,
  `${ms} ms, costo ${first.cost.lamports / 1e7} USDC, responde ${JSON.stringify(now?.[0]?.zone)}`,
);
let st = await channel.getChannelStatus(uid);
check('   el consumo quedó anotado sin tocar la cadena', st.channel?.spentBaseUnits === 5000 && st.channel.settledBaseUnits === 0 && first.newBalance.lamports === 2e7 - 5000);
check('   el saldo único del usuario es lo que queda del depósito', (await getUserBalances(uid)).totalBaseUnits === 2e7 - 5000);

// 2. Precio dinámico y cobro por tandas al llegar al umbral.
const lat: number[] = [];
for (const payload of [{ zone: 'London' }, { zones: ['Bogotá', 'Madrid', 'Lisbon'] }]) {
  t = Date.now();
  await callOnBehalf({ userId: uid, service: 'world-clock', payload });
  lat.push(Date.now() - t);
}
st = await channel.getChannelStatus(uid);
check('2. tres llamadas: 1 + 1 + 3 zonas = 0.0025 USDC consumidos', st.channel?.spentBaseUnits === 25000, `ms: ${ms}, ${lat.join(', ')}`);
const settled = await until(async () => (await channel.getChannelStatus(uid)).channel?.settledBaseUnits === 25000);
check('   al pasar el umbral Kiba cobró todo en una transacción', settled && (await usdcOf(treasury.publicKey())) === 0.0025, `tesorería: ${await usdcOf(treasury.publicKey())} USDC`);
const calls = (await db.prepare(`SELECT metadata FROM transactions WHERE user_id = ? AND type = 'call'`).all(uid)) as { metadata: string }[];
const earned = (await db.prepare(`SELECT COALESCE(SUM(amount_lamports), 0) AS total FROM agent_earnings`).get()) as { total: number };
check(
  '   historial por llamada y ganancia del publicador anotados',
  calls.length === 3 && calls.every((c) => JSON.parse(c.metadata).mode === 'deposit') && Number(earned.total) === 25000,
);

// 3. Una llamada que no cabe en lo que queda se rechaza sin cobrar nada.
await db.prepare('UPDATE pay_channels SET deposited = spent + 100 WHERE user_id = ?').run(uid);
let rejected = '';
try {
  await callOnBehalf({ userId: uid, service: 'world-clock', payload: { zone: 'Tokyo' } });
} catch (e) {
  rejected = (e as Error).message;
}
check('3. sin saldo suficiente en el depósito la llamada se rechaza', /depósito insuficiente/.test(rejected), rejected);
await db.prepare('UPDATE pay_channels SET deposited = 20000000 WHERE user_id = ?').run(uid);

// 4. El usuario pide el retiro directamente al contrato, sin pasar por Kiba.
await callOnBehalf({ userId: uid, service: 'world-clock', payload: { zone: 'Paris' } }); // 0.0005 sin cobrar, bajo el umbral
const ch = st.channel!.channel;
await userInvokesDirectly(user, ch, 'close_start');
await channel.runChannelJob();
st = await channel.getChannelStatus(uid);
check(
  '4. retiro pedido al contrato por fuera: el job lo detecta y cobra lo pendiente',
  st.channel?.state === 'closing' && st.channel.closeEffectiveLedger !== null && st.channel.settledBaseUnits === 30000 &&
    (await usdcOf(treasury.publicKey())) === 0.003,
  `efectivo en el ledger ${st.channel?.closeEffectiveLedger}`,
);
let blocked = '';
try {
  await callOnBehalf({ userId: uid, service: 'world-clock', payload: { zone: 'Tokyo' } });
} catch (e) {
  blocked = (e as Error).message;
}
check('   con el retiro pedido ya no se paga del depósito', blocked !== '', blocked.slice(0, 80));

// 5. Pasada la espera el usuario retira por fuera y Kiba cierra el canal en sus libros.
console.log(`   esperando ${WAIT_LEDGERS} ledgers...`);
await until(async () => (await server.getHealth()).latestLedger >= st.channel!.closeEffectiveLedger!, 120);
await userInvokesDirectly(user, ch, 'refund');
await channel.runChannelJob();
st = await channel.getChannelStatus(uid);
check(
  '5. el usuario retira por fuera todo lo no consumido y el canal queda cerrado',
  st.channel?.state === 'closed' && (await usdcOf(user.publicKey())) === 5 - 0.003,
  `wallet del usuario: ${await usdcOf(user.publicKey())} USDC`,
);

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
discovery.close();
await pool.end();
process.exit(fail ? 1 : 0);
