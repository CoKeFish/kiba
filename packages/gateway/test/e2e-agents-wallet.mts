/**
 * E2E en TESTNET: publicar, cambiar y dar de baja un servicio firmando con la wallet del
 * usuario (no corre en `npm test`). Kiba arma cada transacción contra el registro real y paga
 * la comisión; la firma la pone una clave que Kiba no tiene.
 *
 *   E2E_TREASURY_SECRET   clave S... de una cuenta de testnet (la tesorería de la prueba)
 *   STELLAR_CONTRACT_ID   el contrato de registro en testnet
 *   DATABASE_URL          un Postgres vacío
 */
process.env.CHAIN = 'stellar';
process.env.STELLAR_NETWORK = 'testnet';

import { Keypair, Networks, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';

const SECRET = process.env.E2E_TREASURY_SECRET!;
if (!SECRET || !process.env.STELLAR_CONTRACT_ID) throw new Error('faltan E2E_TREASURY_SECRET / STELLAR_CONTRACT_ID');
const treasury = Keypair.fromSecret(SECRET);
process.env.MASTER_WALLET_SECRET = JSON.stringify([...treasury.rawSecretKey(), ...treasury.rawPublicKey()]);

const { db, initDb, pool } = await import('../src/db');
const { createUser } = await import('../src/auth');
const { linkWallet, submitPrepared } = await import('../src/spend');
const { deregisterAgent, listMyAgents, needsSignature, registerAgent, updateAgent } = await import('../src/agents');
const { chainClientFor } = await import('../src/chain');
const { getMasterWallet, existingUserSigner } = await import('../src/wallets');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await initDb();
await db.exec('TRUNCATE spend_prepared, user_agents, users RESTART IDENTITY CASCADE');
const wallet = Keypair.random(); // la wallet del publicador: Kiba no tiene su clave
const fb = await fetch(`https://friendbot.stellar.org?addr=${wallet.publicKey()}`);
if (!fb.ok) throw new Error(`friendbot ${fb.status}`);
const u = await createUser('publicador@kiba.test', 'password123');
if ('error' in u) throw new Error(u.error);
const userId = Number(u.id);
await linkWallet(userId, wallet.publicKey(), 'external');
check('la cuenta no tiene ninguna wallet que Kiba pueda firmar', (await existingUserSigner(userId)) === null);

const reader = chainClientFor(getMasterWallet(), 'treasury')!;
const service = `e2e-${Date.now().toString(36)}`;
/** Firma con la wallet del publicador lo que Kiba armó, y lo manda. */
async function sign(r: unknown): Promise<string> {
  if (!needsSignature(r)) throw new Error('se esperaba una transacción por firmar');
  const tx = TransactionBuilder.fromXDR(r.prepared.xdr, Networks.TESTNET) as Transaction;
  tx.sign(wallet);
  return (await submitPrepared(userId, { signedXdr: tx.toXDR() })).hash;
}

// 1. Registrar.
let t = Date.now();
let hash = '';
try {
  hash = await sign(await registerAgent(userId, { service, pricePerCallLamports: 1_000_000, endpoint: 'https://e2e.kiba.test', description: 'Prueba de registro' }));
} catch (err) {
  console.log('error al registrar:', (err as Error).message);
}
await sleep(3000);
let a = await reader.fetchAgent(service);
check(
  '1. el servicio queda en el registro a nombre de la wallet del publicador',
  a?.ownerAddress === wallet.publicKey() && Number(a.pricePerCallBaseUnits) === 1_000_000,
  `${((Date.now() - t) / 1000).toFixed(0)} s; tx ${hash.slice(0, 12)}…; dueño ${String(a?.ownerAddress).slice(0, 8)}…`,
);
const mine = await listMyAgents(userId);
check('   y aparece en la lista de servicios de la cuenta', mine.length === 1 && mine[0].service === service && mine[0].owner === wallet.publicKey());

// 2. Cambiar el precio.
try {
  await sign(await updateAgent(userId, service, { pricePerCallLamports: 2_500_000 }));
} catch (err) {
  console.log('error al cambiar:', (err as Error).message);
}
await sleep(3000);
a = await reader.fetchAgent(service);
check('2. el publicador cambia el precio firmando él', Number(a?.pricePerCallBaseUnits) === 2_500_000 && a?.endpoint === 'https://e2e.kiba.test');

// 3. Otra cuenta no puede tocarlo: el contrato exige la firma del dueño.
const intruder = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${intruder.publicKey()}`);
const v = await createUser('otro@kiba.test', 'password123');
if ('error' in v) throw new Error(v.error);
await linkWallet(Number(v.id), intruder.publicKey(), 'external');
let denied = '';
try {
  await updateAgent(Number(v.id), service, { description: 'mío' });
} catch (err) {
  denied = (err as Error).message;
}
check('3. otra cuenta no puede cambiarlo', /not the owner/.test(denied), denied);

// 4. Dar de baja.
try {
  await sign(await deregisterAgent(userId, service));
} catch (err) {
  console.log('error al dar de baja:', (err as Error).message);
}
await sleep(3000);
check('4. el publicador lo da de baja firmando él', (await reader.fetchAgent(service)) === null && (await listMyAgents(userId)).length === 0);

console.log(`\n${pass}/${pass + fail} comprobaciones pasaron`);
await pool.end();
process.exit(fail ? 1 : 0);
