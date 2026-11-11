/**
 * E2E del depósito retirable con una wallet de Privy cuyo DUEÑO es el usuario, contra Stellar
 * TESTNET y la API real de Privy (no corre en `npm test`).
 *
 * - La wallet del usuario es una wallet Stellar de Privy cuyo dueño es una clave P-256 "del
 *   usuario": el gateway no puede firmar con ella; la prueba firma el hash como lo haría el
 *   navegador con `signRawHash`.
 * - Wallet anterior = wallet de Privy app-owned (la que Kiba sí controla), para la migración.
 * - Token propio con símbolo USDC (emisor nuevo) para poder acuñarlo; tesorería nueva.
 *
 *   doppler run -p kiba -c prd --only-secrets PRIVY_APP_ID,PRIVY_APP_SECRET -- \
 *     docker run --rm -e PRIVY_APP_ID -e PRIVY_APP_SECRET -e DATABASE_URL=... <imagen del gateway> \
 *     node --import tsx test/e2e-channel-privy.mts
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
const userWallet = (await privy('POST', '/wallets', {
  chain_type: 'stellar',
  owner: { public_key: userKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
})) as { id: string; address: string };
/** Lo que hace el navegador con `signRawHash`: firma del hash, en hex con 0x. */
async function userSigns(hash: string): Promise<string> {
  const r = (await privy('POST', `/wallets/${userWallet.id}/raw_sign`, { params: { hash: '0x' + hash } }, userKey.privateKey)) as {
    data: { signature: string };
  };
  return r.data.signature;
}

// ─── Entorno del gateway ───
const sol = SolKeypair.generate();
const treasury = Keypair.fromRawEd25519Seed(Buffer.from(sol.secretKey.slice(0, 32)));
const issuer = Keypair.random();
const outside = Keypair.random(); // otra wallet del usuario, destino del envío
process.env.CHAIN = 'stellar';
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(sol.secretKey));
process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS = issuer.publicKey();
process.env.STELLAR_NETWORK = 'testnet';
delete process.env.TRUSTLESS_WORK_API_KEY;
delete process.env.KIBA_CHANNEL_FACTORY_ID;

const { db, initDb, pool } = await import('../src/db');
const spend = await import('../src/spend');
const channel = await import('../src/channel');
const { PrivyStellarSigner, createStellarWallet } = await import('../src/privy');

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
/** El usuario firma el hash con Privy y lo envía por el gateway. */
const userSends = async (uid: number, p: { hash: string }) => spend.submitPrepared(uid, { hash: p.hash, signature: await userSigns(p.hash) });

await initDb();
await db.exec('TRUNCATE pay_channel_holds, pay_channel_moves, pay_channels, spend_prepared, transactions, users RESTART IDENTITY CASCADE');
console.log('Montando token, tesorería y wallets en testnet...');
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
         VALUES ('e2e-privy@kiba.test', 'x', '[]', 'x', ?) RETURNING id`,
      )
      .run(Math.floor(Date.now() / 1000))
  ).lastInsertRowid,
);

// 0. El servidor de Kiba NO puede firmar con la wallet del usuario.
try {
  await privy('POST', `/wallets/${userWallet.id}/raw_sign`, { params: { hash: '0x' + '00'.repeat(32) } });
  check('0. Kiba no puede firmar con la wallet del usuario', false);
} catch (e) {
  check('0. Kiba no puede firmar con la wallet del usuario', /401/.test(String(e)), 'Privy responde 401 sin la firma del dueño');
}

// 1. Activar: Kiba crea la cuenta; el usuario firma (Privy) que acepta USDC y la wallet queda vinculada.
const trust = await spend.prepareActivation(uid, userWallet.address, 'privy');
check('1. Kiba crea la cuenta de la wallet', trust !== null && (await xlmOf(userWallet.address)) > 0, `reserva ${await xlmOf(userWallet.address)} XLM`);
await userSends(uid, trust!);
let w = await spend.getSpendStatus(uid);
check('   el usuario firma con Privy y la wallet queda vinculada a su cuenta', w.address === userWallet.address && w.kind === 'privy');
const xlm0 = await xlmOf(userWallet.address);

// 2. Depositar: el usuario firma con Privy la apertura del canal.
await classic(issuer, [Operation.payment({ destination: userWallet.address, asset: usdc, amount: '10' })]);
const t0 = Date.now();
await userSends(uid, await channel.prepareChannelOpen(uid, { address: userWallet.address, amount: 5e7, kind: 'privy' }));
let st = await channel.getChannelStatus(uid);
check(
  '2. depósito de 5 USDC firmado con Privy',
  st.channel?.state === 'open' && st.channel.kind === 'privy' && st.channel.depositedBaseUnits === 5e7 && (await usdcOf(userWallet.address)) === 5,
  `${((Date.now() - t0) / 1000).toFixed(1)} s`,
);

// 3. Consumo y retiro: Kiba cobra lo consumido y el resto vuelve a la wallet de Privy.
const hold = await channel.reserveChannel(uid, 3e6);
if (hold.ok) await channel.confirmChannel(hold);
const liq = await channel.liquidateChannel(uid);
check(
  '3. retiro: Kiba se queda con los 0.3 consumidos y vuelven 4.7 a la wallet del usuario',
  // Los 0.3 pasan del umbral, así que Kiba puede haberlos cobrado ya antes de liquidar.
  liq.refundedBaseUnits === 4.7e7 && (await usdcOf(treasury.publicKey())) === 0.3 && (await usdcOf(userWallet.address)) === 9.7,
  `cobrado al liquidar: ${liq.paidBaseUnits / 1e7}`,
);

// 4. Migración desde una wallet app-owned de Privy (las anteriores, que Kiba sí controla).
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
const mg = await spend.migrateLegacyWallet(uid);
check('4. migración: el USDC de la wallet anterior pasa a la wallet del usuario', (await usdcOf(userWallet.address)) === 13.2 && (await usdcOf(legacy.address)) === 0, `tx ${mg.hash.slice(0, 10)}…`);

// 5. Enviar USDC de la wallet a otra dirección: lo firma el usuario con Privy.
const send = await spend.prepareWithdraw(uid, { to: outside.publicKey(), amount: 2e7 });
await userSends(uid, send);
w = await spend.getSpendStatus(uid);
check('5. enviar 2 USDC a otra wallet, firmado con Privy', (await usdcOf(outside.publicKey())) === 2 && w.balanceBaseUnits === 11.2e7);

// 6. Todo lo firmó el usuario y las comisiones las pagó Kiba.
check('6. el usuario no pagó comisiones de red', (await xlmOf(userWallet.address)) === xlm0, `XLM: ${await xlmOf(userWallet.address)}`);

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
console.log(`wallets de prueba en Privy: usuario ${userWallet.id}, anterior ${legacy.walletId}`);
await pool.end();
process.exit(fail ? 1 : 0);
