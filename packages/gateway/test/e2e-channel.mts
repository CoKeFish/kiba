/**
 * E2E del depósito retirable contra Stellar TESTNET (no corre en `npm test`).
 *
 * Usa la fábrica de canales publicada en testnet (packages/contracts-channel) y un token propio
 * con símbolo USDC (emisor nuevo, para poder acuñarlo). La wallet del usuario es una clave local
 * que firma el XDR completo, como una wallet externa (Freighter); Kiba solo prepara y paga las
 * comisiones.
 *
 *   docker run --rm --network <red> -e DATABASE_URL=postgres://... kiba-gw-test \
 *     node --import tsx test/e2e-channel.mts
 */
import { Keypair as SolKeypair } from '@solana/web3.js';
import {
  Account,
  Asset,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
} from '@stellar/stellar-sdk';

const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const fund = async (addr: string) => {
  const r = await fetch(`https://friendbot.stellar.org?addr=${addr}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
};
async function classic(signer: Keypair, ops: ReturnType<typeof Operation.payment>[]) {
  const b = new TransactionBuilder(await hz.loadAccount(signer.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET }).setTimeout(60);
  ops.forEach((o) => b.addOperation(o));
  const tx = b.build();
  tx.sign(signer);
  await hz.submitTransaction(tx);
}

// ─── Entorno del gateway ───
const WAIT_LEDGERS = 5; // espera del retiro sin Kiba: ~25 s para la prueba
const sol = SolKeypair.generate();
const treasury = Keypair.fromRawEd25519Seed(Buffer.from(sol.secretKey.slice(0, 32)));
const issuer = Keypair.random();
const user = Keypair.random();
process.env.CHAIN = 'stellar';
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(sol.secretKey));
process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS = issuer.publicKey();
process.env.STELLAR_NETWORK = 'testnet';
process.env.CHANNEL_REFUND_WAIT_LEDGERS = String(WAIT_LEDGERS);
delete process.env.TRUSTLESS_WORK_API_KEY;
delete process.env.KIBA_CHANNEL_FACTORY_ID;

const { db, initDb, pool } = await import('../src/db');
const spend = await import('../src/spend');
const channel = await import('../src/channel');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const usdc = new Asset('USDC', issuer.publicKey());
const xlmOf = async (a: string) => Number((await hz.loadAccount(a)).balances.find((b) => b.asset_type === 'native')!.balance);
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};
/** El usuario firma el XDR completo (wallet externa) y lo envía por el gateway. */
async function userSends(uid: number, p: { xdr: string }) {
  const tx = TransactionBuilder.fromXDR(p.xdr, Networks.TESTNET) as Transaction;
  tx.sign(user);
  const t = Date.now();
  const r = await spend.submitPrepared(uid, { signedXdr: tx.toXDR() });
  return { ...r, secs: ((Date.now() - t) / 1000).toFixed(1) };
}
const consume = (uid: number, n: number) =>
  db.prepare(`UPDATE pay_channels SET spent = spent + ? WHERE user_id = ? AND status = 'open'`).run(Math.round(n * 1e7), uid);

await initDb();
await db.exec('TRUNCATE pay_channel_moves, pay_channels, spend_prepared, spend_charges, transactions, users RESTART IDENTITY CASCADE');
console.log(`Fábrica: ${channel.channelFactoryId()}`);
console.log('Montando token, tesorería y wallet en testnet...');
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
        `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, created_at)
         VALUES ('e2e-channel@kiba.test', 'x', '[]', 'x', ?) RETURNING id`,
      )
      .run(Math.floor(Date.now() / 1000))
  ).lastInsertRowid,
);

// 1. Activar la wallet (Kiba crea la cuenta; el usuario firma que acepta USDC) y recibir 10 USDC.
const trust = await spend.prepareActivation(uid, user.publicKey());
await userSends(uid, trust!);
await classic(issuer, [Operation.payment({ destination: user.publicKey(), asset: usdc, amount: '10' })]);
const xlm0 = await xlmOf(user.publicKey());
check('1. wallet del usuario activada con 10 USDC', (await usdcOf(user.publicKey())) === 10, `XLM: ${xlm0}`);

// 2. Abrir el canal con 5 USDC: una transacción que firma el usuario.
const open = await channel.prepareChannelOpen(uid, { address: user.publicKey(), amount: 5e7 });
const opened = await userSends(uid, open);
let st = await channel.getChannelStatus(uid);
check(
  '2. abrir el canal: 5 USDC pasan de la wallet al canal',
  st.channel?.state === 'open' && st.channel.depositedBaseUnits === 5e7 && (await usdcOf(user.publicKey())) === 5,
  `${opened.secs} s, canal ${st.channel?.channel.slice(0, 8)}…`,
);
const ch = st.channel!.channel;

// 3. El compromiso que arma el gateway es byte a byte el del contrato.
{
  const tx = new TransactionBuilder(new Account(treasury.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(ch).call('prepare_commitment', nativeToScVal(13_000_000n, { type: 'i128' })))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  const onchain = rpc.Api.isSimulationError(sim) ? Buffer.alloc(0) : Buffer.from(scValToNative(sim.result!.retval) as Uint8Array);
  check('3. el compromiso local coincide con el del contrato', onchain.equals(channel.commitmentBytes(Networks.TESTNET, ch, 13_000_000n)));
}

// 4. Recargar 1 USDC.
await userSends(uid, await channel.prepareChannelTopUp(uid, 1e7));
st = await channel.getChannelStatus(uid);
check('4. recarga: el depósito sube a 6', st.channel?.depositedBaseUnits === 6e7 && (await usdcOf(user.publicKey())) === 4);

// 5. Cobro sin cerrar: 1.3 consumidos.
await consume(uid, 1.3);
let t = Date.now();
const settleHash = await channel.settleChannel(uid);
check('5. Kiba cobra 1.3 sin cerrar el canal', (await usdcOf(treasury.publicKey())) === 1.3, `${((Date.now() - t) / 1000).toFixed(1)} s, tx ${settleHash?.slice(0, 10)}…`);

// 6. Liquidar: 0.7 más consumidos; Kiba cobra y el resto vuelve a la wallet en un paso.
await consume(uid, 0.7);
t = Date.now();
const liq = await channel.liquidateChannel(uid);
check(
  '6. liquidar: Kiba cobra 0.7 y vuelven 4.0 a la wallet en una sola transacción',
  liq.paidBaseUnits === 0.7e7 && liq.refundedBaseUnits === 4e7 && liq.pendingBaseUnits === 0 &&
    (await usdcOf(treasury.publicKey())) === 2 && (await usdcOf(user.publicKey())) === 8,
  `${((Date.now() - t) / 1000).toFixed(1)} s, tx ${liq.hash.slice(0, 10)}…`,
);
check('   el canal quedó cerrado', (await channel.getChannelStatus(uid)).channel?.state === 'closed');

// 7. Retiro con espera en un canal nuevo de 3 USDC con 0.5 consumidos.
await userSends(uid, await channel.prepareChannelOpen(uid, { address: user.publicKey(), amount: 3e7 }));
await consume(uid, 0.5);
await userSends(uid, await channel.prepareChannelCloseStart(uid));
st = await channel.getChannelStatus(uid);
check('7. pedir el retiro: Kiba cobra lo consumido dentro de la espera', st.channel?.state === 'closing' && (await usdcOf(treasury.publicKey())) === 2.5);
let early = '';
try {
  await channel.prepareChannelRefund(uid);
} catch (e) {
  early = (e as Error).message;
}
check('   antes del plazo no se puede retirar', /disponible en unos/.test(early), early);
console.log(`   esperando ${WAIT_LEDGERS} ledgers...`);
while ((await server.getHealth()).latestLedger < st.channel!.closeEffectiveLedger!) await new Promise((r) => setTimeout(r, 3000));
const refund = await channel.prepareChannelRefund(uid);
await userSends(uid, refund);
check(
  '   pasado el plazo, el usuario retira los 2.5 restantes',
  refund.amountBaseUnits === 2.5e7 && (await usdcOf(user.publicKey())) === 7.5 &&
    (await channel.getChannelStatus(uid)).channel?.state === 'closed',
);

// 8. Todo lo firmó el usuario y las comisiones las pagó Kiba.
check('8. el usuario no pagó comisiones de red', (await xlmOf(user.publicKey())) === xlm0, `XLM: ${await xlmOf(user.publicKey())}`);

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
