/**
 * E2E de la wallet de pagos contra Stellar TESTNET y la API real de Privy (no corre en `npm test`).
 *
 * - Token propio con símbolo USDC (emisor nuevo, vía TRUSTLESS_WORK_TRUSTLINE_ADDRESS) para poder
 *   acuñarlo; treasury nueva.
 * - Wallet de pagos = wallet Stellar de Privy cuyo DUEÑO es una clave P-256 "del usuario": el
 *   gateway no puede firmar con ella; el test firma como lo haría el navegador.
 * - Wallet anterior = wallet de Privy app-owned (como las de hoy) para probar la migración.
 *
 *   doppler run -p kiba -c prd --only-secrets PRIVY_APP_ID,PRIVY_APP_SECRET -- \
 *     docker run --rm -e PRIVY_APP_ID -e PRIVY_APP_SECRET -e DATABASE_URL=... kiba-gw-test \
 *     node --import tsx test/e2e-spend.mts
 */
import crypto from 'node:crypto';
import { Keypair as SolKeypair } from '@solana/web3.js';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';

const APP_ID = process.env.PRIVY_APP_ID!;
const APP_SECRET = process.env.PRIVY_APP_SECRET!;
if (!APP_ID || !APP_SECRET) throw new Error('faltan PRIVY_APP_ID / PRIVY_APP_SECRET');

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

// ─── Privy: wallet con dueño = clave P-256 del "usuario" ───
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v);
const basic = 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64');
async function privy(method: string, path: string, body: object, ownerKey?: crypto.KeyObject) {
  const url = `https://api.privy.io/v1${path}`;
  const headers: Record<string, string> = { Authorization: basic, 'privy-app-id': APP_ID, 'Content-Type': 'application/json' };
  if (ownerKey) {
    const payload = { version: 1, method, url, body, headers: { 'privy-app-id': APP_ID } };
    headers['privy-authorization-signature'] = crypto.sign('sha256', Buffer.from(canon(payload)), ownerKey).toString('base64');
  }
  const r = await fetch(url, { method, headers, body: JSON.stringify(body) });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`privy ${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
const userKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const payWallet = (await privy('POST', '/wallets', {
  chain_type: 'stellar',
  owner: { public_key: userKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
})) as { id: string; address: string };
/** Lo que hace el navegador con `signRawHash`: firma del hash, en hex con 0x. */
async function userSigns(hash: string): Promise<string> {
  const r = (await privy('POST', `/wallets/${payWallet.id}/raw_sign`, { params: { hash: '0x' + hash } }, userKey.privateKey)) as {
    data: { signature: string };
  };
  return r.data.signature;
}

// ─── Entorno del gateway ───
const sol = SolKeypair.generate();
const treasury = Keypair.fromRawEd25519Seed(Buffer.from(sol.secretKey.slice(0, 32)));
const issuer = Keypair.random();
const outside = Keypair.random(); // otra wallet del usuario, destino del retiro
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(sol.secretKey));
process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS = issuer.publicKey();
process.env.STELLAR_NETWORK = 'testnet';
delete process.env.TRUSTLESS_WORK_API_KEY;
process.env.SPEND_DEBT_CAP = '10000000'; // 1 USDC

const { db, initDb, pool } = await import('../src/db');
const spend = await import('../src/spend');
const { PrivyStellarSigner, createStellarWallet } = await import('../src/privy');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const usdc = new Asset('USDC', issuer.publicKey());
const fmt = (n: number) => (n / 1e7).toFixed(2);
const xlmOf = async (a: string) => Number((await hz.loadAccount(a)).balances.find((b) => b.asset_type === 'native')!.balance);
const usdcOf = async (a: string) => {
  const b = (await hz.loadAccount(a)).balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC');
  return b ? Number(b.balance) : 0;
};

await initDb();
await db.exec('TRUNCATE spend_prepared, spend_charges, transactions, users RESTART IDENTITY CASCADE');
console.log('Montando token, treasury y wallets en testnet...');
await Promise.all([issuer, treasury, outside].map((k) => fund(k.publicKey())));
await Promise.all([treasury, outside].map((k) => classic(k, [Operation.changeTrust({ asset: usdc })])));
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
         VALUES ('e2e@kiba.test', 'x', '[]', 'x', ?) RETURNING id`,
      )
      .run(Math.floor(Date.now() / 1000))
  ).lastInsertRowid,
);

// 0. El servidor de Kiba NO puede firmar con la wallet de pagos.
try {
  await privy('POST', `/wallets/${payWallet.id}/raw_sign`, { params: { hash: '0x' + '00'.repeat(32) } });
  check('0. Kiba no puede firmar con la wallet de pagos', false);
} catch (e) {
  check('0. Kiba no puede firmar con la wallet de pagos', /401/.test(String(e)), 'Privy responde 401 sin la firma del dueño');
}

// 1. Activar: Kiba crea la cuenta; el usuario firma trustline y permiso sin tope.
const t0 = Date.now();
const trust = await spend.prepareActivation(uid, payWallet.address);
check('1. Kiba crea la cuenta de la wallet de pagos', trust !== null && (await xlmOf(payWallet.address)) > 0, `reserva ${await xlmOf(payWallet.address)} XLM`);
await spend.submitPrepared(uid, { hash: trust!.hash, signature: await userSigns(trust!.hash) });
const ap = await spend.prepareApprove(uid, { address: payWallet.address, kind: 'privy' });
const apr = await spend.submitPrepared(uid, { hash: ap.hash, signature: await userSigns(ap.hash) });
let st = await spend.getSpendStatus(uid);
check('   el usuario firma (Privy) trustline y permiso sin tope', st.unlimited && st.address === payWallet.address, `${((Date.now() - t0) / 1000).toFixed(1)} s, tx ${apr.hash.slice(0, 10)}…`);
const xlmAfterActivation = await xlmOf(payWallet.address);
check('   el usuario no pagó comisiones (las pagó Kiba)', xlmAfterActivation === 1.6, `XLM en la wallet: ${xlmAfterActivation}`);

// 2. El usuario recarga y el agente gasta sin pedir firma.
await classic(issuer, [Operation.payment({ destination: payWallet.address, asset: usdc, amount: '10' })]);
const lat: number[] = [];
for (let i = 0; i < 6; i++) {
  const t = Date.now();
  const r = await spend.reserveSpend(uid, 2e6);
  lat.push(Date.now() - t);
  if (!r.ok) throw new Error(r.reason);
}
await spend.settleSpend(uid);
await spend.settleSpend(uid);
st = await spend.getSpendStatus(uid);
check('2. 6 llamadas de 0.20 sin firmas del usuario, cobradas a la treasury', (await usdcOf(treasury.publicKey())) === 1.2 && st.debtBaseUnits === 0, `ms: ${lat.join(', ')}; cobros ${st.charges.map((c) => fmt(c.amount)).join(' + ')}`);

// 3. Retirar: lo firma el usuario; Kiba paga la comisión.
await spend.reserveSpend(uid, 2e6); // consumo pendiente al momento de retirar
const w = await spend.prepareWithdraw(uid, { to: outside.publicKey() });
const blockedDuring = await spend.reserveSpend(uid, 2e6);
await spend.submitPrepared(uid, { hash: w.hash, signature: await userSigns(w.hash) });
check('3. retiro: primero se cobró lo pendiente y salió el resto', (await usdcOf(outside.publicKey())) === 8.6 && (await usdcOf(payWallet.address)) === 0, `retirado ${fmt(w.amountBaseUnits)} USDC a otra wallet`);
check('   durante el retiro no se anotó más consumo', !blockedDuring.ok);
check('   sin comisiones para el usuario', (await xlmOf(payWallet.address)) === 1.6);

// 4. Migración desde una wallet app-owned de Privy (como las actuales).
const legacy = await createStellarWallet();
await fund(legacy.address);
const legacySigner = new PrivyStellarSigner(legacy.walletId, legacy.address);
{
  const tx = new TransactionBuilder(await hz.loadAccount(legacy.address), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(60)
    .build();
  await legacySigner.signTransaction(tx);
  await hz.submitTransaction(tx);
}
await classic(issuer, [Operation.payment({ destination: legacy.address, asset: usdc, amount: '3.5' })]);
spend.setLegacySignerLoader(async () => legacySigner as never);
const legacyBefore = await spend.legacyWallet(uid);
const mg = await spend.migrateLegacyWallet(uid);
check('4. migración: el USDC de la wallet anterior pasa a la wallet de pagos', (await usdcOf(payWallet.address)) === 3.5 && (await usdcOf(legacy.address)) === 0, `${fmt(legacyBefore!.balanceBaseUnits)} USDC, tx ${mg.hash.slice(0, 10)}…`);

// 5. Revocar.
const rv = await spend.prepareApprove(uid, { address: payWallet.address, amount: 0 });
await spend.submitPrepared(uid, { hash: rv.hash, signature: await userSigns(rv.hash) });
const afterRevoke = await spend.reserveSpend(uid, 2e6);
check('5. tras revocar, Kiba no puede anotar más', !afterRevoke.ok, afterRevoke.ok ? '' : afterRevoke.reason);

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
console.log(`wallets de prueba en Privy: pagos ${payWallet.id}, anterior ${legacy.walletId}`);
await pool.end();
process.exit(fail ? 1 : 0);
