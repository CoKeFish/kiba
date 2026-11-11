/**
 * E2E de la retención con reclamos contra Trustless Work en TESTNET (no corre en `npm test`).
 *
 * Usa el escrow REAL de Trustless Work (API de testnet) con el USDC oficial de testnet, que es
 * el único activo que acepta. La tesorería de la prueba es una cuenta de testnet con ese USDC:
 *
 *   E2E_TREASURY_SECRET       clave S... de una cuenta de testnet con USDC de Circle
 *   TRUSTLESS_WORK_API_KEY    clave de la API de Trustless Work
 *
 *   doppler run -p kiba -c prd --only-secrets TRUSTLESS_WORK_API_KEY -- \
 *     docker run --rm -e TRUSTLESS_WORK_API_KEY -e E2E_TREASURY_SECRET=... -e DATABASE_URL=... \
 *     <imagen del gateway> node --import tsx test/e2e-retention.mts
 *
 * Si la tesorería tiene poco USDC, cambia XLM de testnet por USDC en el mercado de testnet.
 */
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const SECRET = process.env.E2E_TREASURY_SECRET!;
if (!SECRET || !process.env.TRUSTLESS_WORK_API_KEY) throw new Error('faltan E2E_TREASURY_SECRET / TRUSTLESS_WORK_API_KEY');
const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdc = new Asset('USDC', CIRCLE);
const hz = new Horizon.Server('https://horizon-testnet.stellar.org');
const treasury = Keypair.fromSecret(SECRET);
const pubA = Keypair.random();
const pubB = Keypair.random();

const fund = async (a: string) => {
  const r = await fetch(`https://friendbot.stellar.org?addr=${a}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
};
async function classic(signer: Keypair, ops: ReturnType<typeof Operation.payment>[]) {
  const b = new TransactionBuilder(await hz.loadAccount(signer.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET }).setTimeout(60);
  ops.forEach((o) => b.addOperation(o));
  const tx = b.build();
  tx.sign(signer);
  await hz.submitTransaction(tx);
}
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};

// ─── Entorno del gateway ───
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';
// La tesorería del gateway es un par de 64 bytes (semilla + clave pública).
process.env.MASTER_WALLET_SECRET = JSON.stringify([...treasury.rawSecretKey(), ...treasury.rawPublicKey()]);
process.env.TRUSTLESS_WORK_PLATFORM_ADDRESS = treasury.publicKey();
process.env.RETENTION_MIN_HOLD = '10000000';
delete process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS;
delete process.env.RETENTION;

const { db, initDb, pool } = await import('../src/db');
const { recordEarning } = await import('../src/settlement');
const retention = await import('../src/retention');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

await initDb();
await db.exec('TRUNCATE claims, earning_holds, agent_earnings, settlements, transactions, user_agents, users RESTART IDENTITY CASCADE');
console.log(`Tesorería de prueba: ${treasury.publicKey()}`);
await Promise.all([pubA, pubB].map((k) => fund(k.publicKey())));
await Promise.all([pubA, pubB].map((k) => classic(k, [Operation.changeTrust({ asset: usdc })])));
if ((await usdcOf(treasury.publicKey())) < 12) {
  await classic(treasury, [
    Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '200', destination: treasury.publicKey(), destAsset: usdc, destAmount: '20', path: [] }),
  ]);
}
const t0 = await usdcOf(treasury.publicKey());
console.log(`USDC de la tesorería al empezar: ${t0}`);

const mkUser = async (email: string) =>
  Number(
    (
      await db
        .prepare(
          `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
           VALUES (?, 'x', '[]', ?, 0, ?) RETURNING id`,
        )
        .run(email, `pk-${email}`, now())
    ).lastInsertRowid,
  );
const buyer = await mkUser('comprador@kiba.test');
const admin = await mkUser('admin@kiba.test');
const owner = await mkUser('publicador-b@kiba.test');
await db.prepare('INSERT INTO user_agents (user_id, service, created_at) VALUES (?, ?, ?)').run(owner, 'e2e-b', now());
await retention.setPublisherTrust(owner, 'trusted');

/** Una llamada pagada con créditos en el período anterior. */
async function paidCall(service: string, payTo: string, amount: number) {
  const at = now() - (retention.RETENTION_PERIOD_DAYS + 1) * DAY;
  const tx = await db
    .prepare(`INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at) VALUES (?, 'call', ?, ?, '{}', ?) RETURNING id`)
    .run(buyer, -amount, service, at);
  const transactionId = Number(tx.lastInsertRowid);
  const id = await recordEarning({ service, payTo, lamports: amount, paidBy: { userId: buyer, transactionId, paidWith: 'credit' } });
  await db.prepare('UPDATE agent_earnings SET created_at = ? WHERE id = ?').run(at, id);
  return transactionId;
}
const callA1 = await paidCall('e2e-a', pubA.publicKey(), 3e7);
await paidCall('e2e-a', pubA.publicKey(), 2e7);
await paidCall('e2e-b', pubB.publicKey(), 2e7);
const holds = async () =>
  (await db.prepare('SELECT * FROM earning_holds ORDER BY service').all()) as Array<Record<string, unknown>>;

// 1. Cierre del período: un escrow real de Trustless Work por servicio, con el monto exacto.
let t = Date.now();
await retention.runRetentionJob();
let [a, b] = await holds();
check(
  '1. al cerrar el período se crea un escrow de Trustless Work por servicio',
  a?.status === 'held' && b?.status === 'held' && String(a.escrow_id).startsWith('C') && String(b.escrow_id).startsWith('C') &&
    Number(a.amount) === 5e7 && Number(b.amount) === 2e7,
  `${((Date.now() - t) / 1000).toFixed(0)} s; escrows ${String(a?.escrow_id).slice(0, 8)}… y ${String(b?.escrow_id).slice(0, 8)}…${a?.error ? ' error: ' + a.error : ''}`,
);
check('   el dinero salió de la tesorería a los escrows', near(t0 - (await usdcOf(treasury.publicKey())), 7), `tesorería: −${(t0 - (await usdcOf(treasury.publicKey()))).toFixed(4)} USDC`);
check(
  '   el plazo sigue la confianza: nuevo 14 días, de confianza 1 día',
  Number(a.retention_days) === 14 && Number(b.retention_days) === 1,
);

// 2. Antes del plazo no se libera nada.
await retention.runRetentionJob();
check('2. antes del plazo no se libera', (await usdcOf(pubA.publicKey())) === 0 && (await usdcOf(pubB.publicKey())) === 0);

// 3. Reclamo sobre una llamada del servicio A; el administrador devuelve 1 de los 3 USDC.
const claim = await retention.createClaim(buyer, callA1, 'El servicio devolvió un resultado incompleto.');
const resolved = await retention.resolveClaim(admin, claim.id, { decision: 'refund', amount: 1e7, note: 'Devolución parcial.' });
const credits = Number(((await db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(buyer)) as { balance_lamports: number }).balance_lamports);
check('3. reclamo aceptado: el usuario recupera 1 USDC en sus créditos', resolved.status === 'refunded' && credits === 1e7);

// 4. Vence el plazo de los dos: B se libera normal; A se cierra por disputa y reparte.
await db.prepare('UPDATE earning_holds SET release_at = ?').run(now() - 1);
const before = { t: await usdcOf(treasury.publicKey()) };
t = Date.now();
await retention.runRetentionJob();
[a, b] = await holds();
const gotA = await usdcOf(pubA.publicKey());
const gotB = await usdcOf(pubB.publicKey());
check(
  '4. sin reclamos: el escrow se libera y el publicador cobra su 94,7 %',
  b.status === 'released' && near(gotB, 2 * 0.947),
  `publicador B: +${gotB} USDC`,
);
check(
  '   con devolución: se cierra por disputa; el publicador cobra lo suyo menos lo devuelto',
  a.status === 'resolved' && near(gotA, 4 * 0.947),
  `publicador A: +${gotA} USDC (de 5 retenidos, 1 devuelto)${a.error ? ' error: ' + a.error : ''}`,
);
const back = (await usdcOf(treasury.publicKey())) - before.t;
check(
  '   la tesorería recupera lo devuelto y recibe su comisión',
  near(back, 1 * 0.997 + 4 * 0.05 + 2 * 0.05),
  `tesorería: +${back.toFixed(4)} USDC, ${((Date.now() - t) / 1000).toFixed(0)} s`,
);
const settlements = (await db.prepare(`SELECT service, amount_lamports, status FROM settlements ORDER BY service`).all()) as Array<Record<string, unknown>>;
check(
  '   queda registrado el pago a cada publicador',
  settlements.length === 2 && Number(settlements[0].amount_lamports) === 4e7 && Number(settlements[1].amount_lamports) === 2e7,
);

// 5. Repetir el trabajo no paga dos veces.
await retention.runRetentionJob();
check('5. repetir el trabajo no vuelve a pagar', near(await usdcOf(pubA.publicKey()), gotA) && near(await usdcOf(pubB.publicKey()), gotB));

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
