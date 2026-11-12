// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

process.env.STELLAR_CONTRACT_ID = 'C' + 'A'.repeat(55);

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, Networks, Operation, TransactionBuilder, scValToNative, type Transaction, type xdr } from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import { createUser } from '../src/auth';
import {
  linkWallet,
  setSpendChain,
  submitPrepared,
  type SpendChain,
} from '../src/spend';
import { deregisterAgent, needsSignature, registerAgent, setRegistryReader, updateAgent } from '../src/agents';

const me = Keypair.random(); // la wallet del publicador
const other = Keypair.random();

/** El registro, en memoria: servicio → dueño. */
const onChain = new Map<string, string>();
const calls: Array<{ owner: string; contract: string; fn: string; args: unknown[] }> = [];
let seq = 0;
const fakeChain = {
  passphrase: () => Networks.TESTNET,
  // Una transacción real (para que se pueda firmar y enviar) que recuerda qué llamada es.
  buildContractCall: async (owner: string, contract: string, fn: string, args: xdr.ScVal[]) => {
    calls.push({ owner, contract, fn, args: args.map((a) => scValToNative(a)) });
    return new TransactionBuilder(new Account(owner, String(++seq)), { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: `${fn}:${String(scValToNative(args[fn === 'register_agent' ? 1 : 0]))}`, value: 'x' }))
      .setTimeout(600)
      .build()
      .toXDR();
  },
  // La "red": aplica la llamada al registro.
  submitSponsored: async (signedXdr: string) => {
    const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET) as Transaction;
    const [fn, service] = (tx.operations[0] as { name: string }).name.split(':');
    if (fn === 'register_agent') onChain.set(service, tx.source);
    if (fn === 'deregister_agent') onChain.delete(service);
    return `tx-${tx.hash().toString('hex').slice(0, 8)}`;
  },
} as unknown as SpendChain;

before(async () => {
  await initDb();
});
after(async () => {
  setSpendChain(null);
  setRegistryReader(null);
  await pool.end();
});
beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  onChain.clear();
  calls.length = 0;
  setSpendChain(fakeChain);
  setRegistryReader({
    fetchAgent: async (service: string) =>
      onChain.has(service)
        ? ({ service, ownerAddress: onChain.get(service)!, pricePerCallBaseUnits: 1n, endpoint: 'https://x', description: '' } as never)
        : null,
  });
});

async function account(email: string): Promise<number> {
  const u = await createUser(email, 'password123');
  if ('error' in u) throw new Error(u.error);
  return Number(u.id);
}
/** Firma lo que Kiba armó, como lo haría la wallet del usuario, y lo manda. */
async function signAndSubmit(userId: number, prepared: { xdr: string }, kp = me) {
  const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction;
  tx.sign(kp);
  return submitPrepared(userId, { signedXdr: tx.toXDR() });
}
const input = { service: 'traductor', pricePerCallLamports: 1_000_000, endpoint: 'https://api.ejemplo.com', description: 'Traduce textos' };
const myServices = async (userId: number) =>
  ((await db.prepare('SELECT service FROM user_agents WHERE user_id = ?').all(userId)) as Array<{ service: string }>).map((r) => r.service);

test('sin una wallet vinculada no se publica: nada queda a nombre de una clave de Kiba', async () => {
  const userId = await account('nueva@test.com');
  const columns = ((await db.prepare(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`).all()) as Array<{ column_name: string }>).map(
    (c) => c.column_name,
  );
  // La base ya no tiene dónde guardar una clave ni una wallet controlada por Kiba.
  for (const gone of ['custodial_wallet_secret', 'custodial_wallet_pubkey', 'privy_wallet_id', 'stellar_address', 'privy_wallet_owned']) {
    assert.equal(columns.includes(gone), false, gone);
  }
  await assert.rejects(() => registerAgent(userId, input), /vincula tu wallet/);
  assert.equal(calls.length, 0);
});

test('publicar con la wallet propia: Kiba arma el registro, el usuario lo firma y queda de dueño', async () => {
  const userId = await account('pub@test.com');
  await linkWallet(userId, me.publicKey(), 'privy');

  const r = await registerAgent(userId, input);
  assert.ok(needsSignature(r));
  if (!needsSignature(r)) return;
  assert.deepEqual([r.prepared.kind, r.wallet.address, r.wallet.kind], ['agent_register', me.publicKey(), 'privy']);
  assert.deepEqual(calls[0], {
    owner: me.publicKey(),
    contract: process.env.STELLAR_CONTRACT_ID,
    fn: 'register_agent',
    args: [me.publicKey(), 'traductor', 1_000_000n, 'https://api.ejemplo.com', 'Traduce textos'],
  });
  // Mientras no firme, no hay servicio.
  assert.deepEqual([onChain.size, await myServices(userId)], [0, []]);

  // Una firma de otra wallet no sirve.
  await assert.rejects(() => signAndSubmit(userId, r.prepared, other), /no corresponde a la wallet/);
  const sent = await signAndSubmit(userId, r.prepared);
  assert.equal(sent.kind, 'agent_register');
  assert.equal(onChain.get('traductor'), me.publicKey());
  assert.deepEqual(await myServices(userId), ['traductor']);
  // La misma firma no se manda dos veces, y el nombre ya no está libre.
  await assert.rejects(() => signAndSubmit(userId, r.prepared), /ya enviada/);
  await assert.rejects(() => registerAgent(userId, input), /already registered/);
});

test('cambiar y dar de baja un servicio propio también lo firma el usuario; uno ajeno no se toca', async () => {
  const userId = await account('pub@test.com');
  await linkWallet(userId, me.publicKey(), 'external');
  const reg = await registerAgent(userId, input);
  assert.ok(needsSignature(reg));
  if (needsSignature(reg)) await signAndSubmit(userId, reg.prepared);

  const up = await updateAgent(userId, 'traductor', { pricePerCallLamports: 2_000_000 });
  assert.ok(needsSignature(up));
  // Solo cambia el precio: lo demás viaja vacío.
  assert.deepEqual(calls.at(-1), { owner: me.publicKey(), contract: process.env.STELLAR_CONTRACT_ID, fn: 'update_agent', args: ['traductor', 2_000_000n, null, null] });

  onChain.set('de-otro', other.publicKey());
  await assert.rejects(() => updateAgent(userId, 'de-otro', { description: 'mío' }), /not the owner/);
  await assert.rejects(() => deregisterAgent(userId, 'de-otro'), /not the owner/);
  await assert.rejects(() => deregisterAgent(userId, 'no-existe'), /not found/);

  const del = await deregisterAgent(userId, 'traductor');
  assert.ok(needsSignature(del));
  assert.deepEqual(await myServices(userId), ['traductor']); // sigue hasta que firme
  if (needsSignature(del)) await signAndSubmit(userId, del.prepared);
  assert.deepEqual([onChain.has('traductor'), await myServices(userId)], [false, []]);
});
