// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb, pool } from '../src/db';
import { recordEarning, settleAgent, getAccrued } from '../src/settlement';
import {
  RETENTION_DAYS,
  RETENTION_DUST,
  RETENTION_MAX_WAIT_DAYS,
  RETENTION_MIN_HOLD,
  RETENTION_VOLUME_HOLD,
  RETENTION_PERIOD_DAYS,
  claimInfoForTransactions,
  closePeriods,
  createClaim,
  fundHolds,
  isAdminEmail,
  listClaimsForAdmin,
  listClaimsOfUser,
  listHoldsOfPublisher,
  periodCutoff,
  releaseDue,
  resolveClaim,
  retentionEnabled,
  runRetentionJob,
  setHoldBackend,
  setPublisherTrust,
  type HoldBackend,
} from '../src/retention';

const USDC = (n: number) => Math.round(n * 1e7);
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

/**
 * Escrow en memoria con las reglas de Trustless Work que importan aquí: el monto queda fijo al
 * fondear, liberar paga todo al receptor, resolver exige que el reparto sume el saldo, y un
 * escrow ya cerrado no se vuelve a pagar.
 */
class FakeEscrows implements HoldBackend {
  escrows = new Map<string, { receiver: string; balance: number; state: 'held' | 'released' | 'resolved' }>();
  byEngagement = new Map<string, string>();
  paidToReceiver = new Map<string, number>();
  backToTreasury = 0;
  failOpen = false;
  failRelease = false;
  readyCalls = 0;
  async ready() {
    this.readyCalls++;
  }
  async open(a: { engagementId: string; service: string; receiver: string; amount: number }) {
    if (this.failOpen) throw new Error('Trustless Work no responde');
    // Mismo engagementId = mismo escrow: un reintento no crea ni fondea otro.
    let escrowId = this.byEngagement.get(a.engagementId);
    if (!escrowId) {
      escrowId = `C${this.escrows.size + 1}-${a.service}`;
      this.byEngagement.set(a.engagementId, escrowId);
      this.escrows.set(escrowId, { receiver: a.receiver, balance: a.amount, state: 'held' });
    }
    return { escrowId };
  }
  private pay(receiver: string, amount: number) {
    this.paidToReceiver.set(receiver, (this.paidToReceiver.get(receiver) ?? 0) + amount);
  }
  async release(escrowId: string) {
    if (this.failRelease) throw new Error('Trustless Work no responde');
    const e = this.escrows.get(escrowId)!;
    if (e.state !== 'held') return; // idempotente
    this.pay(e.receiver, e.balance);
    e.balance = 0;
    e.state = 'released';
  }
  async resolve(escrowId: string, a: { receiver: string; toReceiver: number; toTreasury: number }) {
    if (this.failRelease) throw new Error('Trustless Work no responde');
    const e = this.escrows.get(escrowId)!;
    if (e.state !== 'held') return;
    assert.equal(a.toReceiver + a.toTreasury, e.balance, 'el reparto debe sumar el saldo del escrow');
    assert.equal(a.receiver, e.receiver);
    this.pay(e.receiver, a.toReceiver);
    this.backToTreasury += a.toTreasury;
    e.balance = 0;
    e.state = 'resolved';
  }
}

let escrows: FakeEscrows;

before(async () => {
  await initDb();
});

after(async () => {
  setHoldBackend(null);
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  escrows = new FakeEscrows();
  setHoldBackend(escrows);
});

async function createUser(email: string, credits = 0): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO users (email, password_hash, balance_lamports, created_at)
       VALUES (?, 'x', ?, ?) RETURNING id`,
    )
    .run(email, credits, now());
  return Number(r.lastInsertRowid);
}

/** Un servicio publicado por `ownerId`, que cobra en `payTo`. */
async function publish(ownerId: number, service: string, _payTo: string) {
  await db.prepare('INSERT INTO user_agents (user_id, service, created_at) VALUES (?, ?, ?)').run(ownerId, service, now());
}

/** Una llamada pagada con créditos: fila en el historial + ganancia del publicador. */
async function paidCall(userId: number, service: string, payTo: string, usdc: number, daysAgo = 0) {
  const at = now() - daysAgo * DAY;
  const tx = await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'call', ?, ?, '{}', ?) RETURNING id`,
    )
    .run(userId, -USDC(usdc), service, at);
  const transactionId = Number(tx.lastInsertRowid);
  const earningId = await recordEarning({
    service,
    payTo,
    lamports: USDC(usdc),
    paidBy: { userId, transactionId, paidWith: 'credit' },
  });
  await db.prepare('UPDATE agent_earnings SET created_at = ? WHERE id = ?').run(at, earningId);
  return { transactionId, earningId };
}

const lastPeriod = RETENTION_PERIOD_DAYS + 1; // días atrás: seguro dentro de un período ya cerrado
const holdsOf = async (service: string) =>
  (await db.prepare('SELECT * FROM earning_holds WHERE service = ? ORDER BY id').all(service)) as Array<Record<string, unknown>>;
const credits = async (userId: number) =>
  Number(((await db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(userId)) as { balance_lamports: number }).balance_lamports);
/** Adelanta el reloj de una retención: como si hubieran pasado `days` desde que se fondeó. */
const age = (holdId: number, days: number) =>
  db.prepare('UPDATE earning_holds SET release_at = release_at - ? WHERE id = ?').run(days * DAY, holdId);

test('la retención está activa con un escrow configurado y RETENTION=0 la apaga', () => {
  assert.equal(retentionEnabled(), true);
  process.env.RETENTION = '0';
  try {
    assert.equal(retentionEnabled(), false);
  } finally {
    delete process.env.RETENTION;
  }
});

test('al cerrar el período, lo ganado por un servicio pasa a una retención con el monto exacto', async () => {
  const buyer = await createUser('b@x.com');
  await paidCall(buyer, 'traductor', 'GPUB', 1.5, lastPeriod);
  await paidCall(buyer, 'traductor', 'GPUB', 2.5, lastPeriod);
  await paidCall(buyer, 'traductor', 'GPUB', 9, 0); // período en curso: todavía no
  assert.equal(await closePeriods(), 1);
  assert.equal(await closePeriods(), 0); // no se repite
  let [h] = await holdsOf('traductor');
  assert.equal(h.status, 'funding');
  assert.equal(Number(h.period_end), periodCutoff());

  assert.equal(await fundHolds(), 1);
  [h] = await holdsOf('traductor');
  assert.equal(h.status, 'held');
  assert.equal(Number(h.amount), USDC(4));
  const escrow = escrows.escrows.get(String(h.escrow_id))!;
  assert.deepEqual([escrow.receiver, escrow.balance], ['GPUB', USDC(4)]);
  // La ganancia del período en curso sigue suelta, esperando su cierre.
  const loose = (await db.prepare('SELECT COUNT(*) AS n FROM agent_earnings WHERE hold_id IS NULL').get()) as { n: number };
  assert.equal(Number(loose.n), 1);
});

test('lo que no llega al mínimo espera al período siguiente', async () => {
  const buyer = await createUser('b@x.com');
  await paidCall(buyer, 'reloj', 'GPUB', RETENTION_MIN_HOLD / 1e7 / 2, lastPeriod);
  assert.equal(await closePeriods(), 0);
  await paidCall(buyer, 'reloj', 'GPUB', RETENTION_MIN_HOLD / 1e7, lastPeriod);
  assert.equal(await closePeriods(), 1);
  await fundHolds();
  assert.equal(Number((await holdsOf('reloj'))[0].amount), RETENTION_MIN_HOLD * 1.5);
});

test('un servicio que mueve mucho entra al escrow de inmediato, sin esperar al cierre del período', async () => {
  const buyer = await createUser('b@x.com');
  const big = RETENTION_VOLUME_HOLD / 1e7;
  // Todo de hoy: el período no ha cerrado.
  await paidCall(buyer, 'modelos', 'GPUB', big / 2, 0);
  assert.equal(await closePeriods(), 0);
  await paidCall(buyer, 'modelos', 'GPUB', big / 2, 0);
  assert.equal(await closePeriods(), 1);
  await fundHolds();
  const [h] = await holdsOf('modelos');
  assert.deepEqual([h.status, Number(h.amount)], ['held', RETENTION_VOLUME_HOLD]);
  // Otro servicio del mismo publicador, pequeño, sigue esperando su cierre.
  await paidCall(buyer, 'reloj', 'GPUB', 2, 0);
  assert.equal(await closePeriods(), 0);
  // Y lo siguiente del servicio grande empieza a contar de cero.
  await paidCall(buyer, 'modelos', 'GPUB', 1, 0);
  assert.equal(await closePeriods(), 0);
});

test('un servicio que no llega al mínimo no espera para siempre', async () => {
  const buyer = await createUser('b@x.com');
  const small = RETENTION_MIN_HOLD / 1e7 / 2;
  await paidCall(buyer, 'reloj', 'GPUB', small, RETENTION_MAX_WAIT_DAYS - 1);
  assert.equal(await closePeriods(), 0); // todavía dentro de la espera
  await paidCall(buyer, 'viejo', 'GPUB', small, RETENTION_MAX_WAIT_DAYS + 1);
  await paidCall(buyer, 'viejo', 'GPUB', small / 2, 0); // lo de hoy entra junto
  assert.equal(await closePeriods(), 1);
  await fundHolds();
  assert.equal(Number((await holdsOf('viejo'))[0].amount), RETENTION_MIN_HOLD * 0.75);
  // Menos que el piso no vale una operación en la red, por viejo que sea.
  await paidCall(buyer, 'polvo', 'GPUB', RETENTION_DUST / 1e7 / 2, RETENTION_MAX_WAIT_DAYS + 5);
  assert.equal(await closePeriods(), 0);
});

test('el plazo depende de la confianza en el publicador', async () => {
  const buyer = await createUser('b@x.com');
  const nuevo = await createUser('nuevo@x.com');
  const verificado = await createUser('verificado@x.com');
  const confiable = await createUser('confiable@x.com');
  await publish(nuevo, 's-nuevo', 'GA');
  await publish(verificado, 's-verificado', 'GB');
  await publish(confiable, 's-confiable', 'GC');
  await setPublisherTrust(verificado, 'verified');
  await setPublisherTrust(confiable, 'trusted');
  await assert.rejects(() => setPublisherTrust(nuevo, 'amigo' as never), /inválido/);
  for (const [s, p] of [['s-nuevo', 'GA'], ['s-verificado', 'GB'], ['s-confiable', 'GC'], ['s-sin-cuenta', 'GD']]) {
    await paidCall(buyer, s, p, 2, lastPeriod);
  }
  await closePeriods();
  await fundHolds();
  const days = async (s: string) => {
    const [h] = await holdsOf(s);
    return [h.trust, Number(h.retention_days), Math.round((Number(h.release_at) - Number(h.funded_at)) / DAY)];
  };
  assert.deepEqual(await days('s-nuevo'), ['new', RETENTION_DAYS.new, 14]);
  assert.deepEqual(await days('s-verificado'), ['verified', RETENTION_DAYS.verified, 3]);
  assert.deepEqual(await days('s-confiable'), ['trusted', RETENTION_DAYS.trusted, 1]);
  assert.deepEqual(await days('s-sin-cuenta'), ['new', 14, 14]); // sin cuenta en Kiba = nuevo
});

test('vencido el plazo se libera al publicador; antes, no', async () => {
  const buyer = await createUser('b@x.com');
  const pub = await createUser('p@x.com');
  await publish(pub, 'traductor', 'GPUB');
  await paidCall(buyer, 'traductor', 'GPUB', 4, lastPeriod);
  await closePeriods();
  await fundHolds();
  const [h] = await holdsOf('traductor');
  assert.equal(await releaseDue(), 0);
  assert.equal(escrows.paidToReceiver.get('GPUB'), undefined);
  await age(Number(h.id), 13);
  assert.equal(await releaseDue(), 0); // falta un día
  await age(Number(h.id), 1);
  assert.equal(await releaseDue(), 1);
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(4));
  assert.equal(await releaseDue(), 0); // no se paga dos veces

  const [after] = await holdsOf('traductor');
  assert.equal(after.status, 'released');
  const s = (await db.prepare('SELECT * FROM settlements WHERE id = ?').get(after.settlement_id)) as Record<string, unknown>;
  assert.deepEqual([s.status, Number(s.amount_lamports), s.escrow_id], ['settled', USDC(4), after.escrow_id]);
  assert.equal(await getAccrued('traductor'), 0);
  const view = await listHoldsOfPublisher(pub);
  assert.equal(view.length, 1);
  assert.deepEqual([view[0].status, view[0].amountBaseUnits, view[0].trust, view[0].retentionDays], ['released', USDC(4), 'new', 14]);
});

test('si Trustless Work falla, la retención se reintenta sin duplicar el escrow ni el pago', async () => {
  const buyer = await createUser('b@x.com');
  await paidCall(buyer, 'traductor', 'GPUB', 4, lastPeriod);
  await closePeriods();
  escrows.failOpen = true;
  assert.equal(await fundHolds(), 0);
  let [h] = await holdsOf('traductor');
  assert.equal(h.status, 'funding');
  assert.match(String(h.error), /no responde/);
  escrows.failOpen = false;
  assert.equal(await fundHolds(), 1);
  assert.equal(escrows.escrows.size, 1);

  [h] = await holdsOf('traductor');
  await age(Number(h.id), 14);
  escrows.failRelease = true;
  assert.equal(await releaseDue(), 0);
  assert.equal((await holdsOf('traductor'))[0].status, 'held');
  escrows.failRelease = false;
  assert.equal(await releaseDue(), 1);
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(4));
});

test('con retención, el publicador no puede liquidar a pedido', async () => {
  const buyer = await createUser('b@x.com');
  await paidCall(buyer, 'traductor', 'GPUB', 4, 0);
  const r = await settleAgent('traductor');
  assert.equal(r.status, 'skipped');
  assert.match(String(r.reason), /retención/);
  assert.equal(r.amountLamports, USDC(4));
});

test('el trabajo periódico hace el ciclo completo', async () => {
  const buyer = await createUser('b@x.com');
  await paidCall(buyer, 'traductor', 'GPUB', 4, lastPeriod);
  await runRetentionJob();
  assert.equal(escrows.readyCalls, 1);
  const [h] = await holdsOf('traductor');
  assert.equal(h.status, 'held');
  await age(Number(h.id), 14);
  await runRetentionJob();
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(4));
});

// ─── Reclamos ───────────────────────────────────────────────────────────────

test('reclamo aceptado antes de retener: el usuario recupera sus créditos y el escrow guarda menos', async () => {
  const buyer = await createUser('b@x.com');
  const admin = await createUser('admin@kiba.test');
  const a = await paidCall(buyer, 'traductor', 'GPUB', 3, lastPeriod);
  await paidCall(buyer, 'traductor', 'GPUB', 2, lastPeriod);

  await assert.rejects(() => createClaim(buyer, a.transactionId, 'malo'), /al menos 10/);
  const other = await createUser('otro@x.com');
  await assert.rejects(() => createClaim(other, a.transactionId, 'no era mi llamada pero reclamo'), /no se puede reclamar/);
  const claim = await createClaim(buyer, a.transactionId, 'El servicio devolvió un texto vacío.');
  assert.deepEqual([claim.status, claim.amountBaseUnits], ['open', USDC(3)]);
  await assert.rejects(() => createClaim(buyer, a.transactionId, 'Lo reclamo otra vez por si acaso.'), /ya reclamaste/);

  const resolved = await resolveClaim(admin, claim.id, { decision: 'refund', note: 'Confirmado: respuesta vacía.' });
  assert.deepEqual([resolved.status, resolved.refundedBaseUnits], ['refunded', USDC(3)]);
  assert.equal(await credits(buyer), USDC(3));
  await assert.rejects(() => resolveClaim(admin, claim.id, { decision: 'refund' }), /no está abierto/);

  await closePeriods();
  await fundHolds();
  const [h] = await holdsOf('traductor');
  assert.equal(Number(h.amount), USDC(2)); // solo lo no devuelto
  assert.equal(Number(h.refund_due), 0);
  await age(Number(h.id), 14);
  await releaseDue();
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(2));
  assert.equal(escrows.backToTreasury, 0);
});

test('reclamo aceptado con el escrow ya fondeado: se cierra por disputa y reparte', async () => {
  const buyer = await createUser('b@x.com');
  const admin = await createUser('admin@kiba.test');
  const a = await paidCall(buyer, 'traductor', 'GPUB', 3, lastPeriod);
  await paidCall(buyer, 'traductor', 'GPUB', 2, lastPeriod);
  await closePeriods();
  await fundHolds();
  const [h] = await holdsOf('traductor');

  const info = await claimInfoForTransactions(buyer, [a.transactionId]);
  assert.equal(info[a.transactionId].claimable, true);
  assert.equal(info[a.transactionId].until, Number(h.release_at));

  const claim = await createClaim(buyer, a.transactionId, 'El resultado no corresponde a lo pedido.');
  // Con un reclamo abierto la retención no se libera aunque venza el plazo.
  await age(Number(h.id), 14);
  assert.equal(await releaseDue(), 0);

  await resolveClaim(admin, claim.id, { decision: 'refund', amount: USDC(1) }); // devolución parcial
  assert.equal(await credits(buyer), USDC(1));
  assert.equal(Number((await holdsOf('traductor'))[0].refund_due), USDC(1));
  assert.equal(await releaseDue(), 1);
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(4)); // 5 − 1 devuelto
  assert.equal(escrows.backToTreasury, USDC(1)); // lo que Kiba ya le devolvió al usuario
  const [after] = await holdsOf('traductor');
  assert.equal(after.status, 'resolved');
  const s = (await db.prepare('SELECT amount_lamports FROM settlements WHERE id = ?').get(after.settlement_id)) as { amount_lamports: number };
  assert.equal(Number(s.amount_lamports), USDC(4));

  const mine = await listClaimsOfUser(buyer);
  assert.deepEqual([mine[0].status, mine[0].refundedBaseUnits], ['refunded', USDC(1)]);
});

test('reclamo rechazado: no cambia nada y la retención se libera completa', async () => {
  const buyer = await createUser('b@x.com');
  const admin = await createUser('admin@kiba.test');
  const a = await paidCall(buyer, 'traductor', 'GPUB', 3, lastPeriod);
  await closePeriods();
  await fundHolds();
  const [h] = await holdsOf('traductor');
  const claim = await createClaim(buyer, a.transactionId, 'No me gustó el estilo de la traducción.');
  const queue = await listClaimsForAdmin();
  assert.deepEqual([queue.length, queue[0].userEmail, queue[0].status], [1, 'b@x.com', 'open']);
  const r = await resolveClaim(admin, claim.id, { decision: 'reject', note: 'El servicio entregó lo pedido.' });
  assert.equal(r.status, 'rejected');
  assert.equal(await credits(buyer), 0);
  await age(Number(h.id), 14);
  await releaseDue();
  assert.equal(escrows.paidToReceiver.get('GPUB'), USDC(3));
});

test('liberada la ganancia ya no se puede reclamar, ni devolver más de lo pagado', async () => {
  const buyer = await createUser('b@x.com');
  const admin = await createUser('admin@kiba.test');
  const a = await paidCall(buyer, 'traductor', 'GPUB', 3, lastPeriod);
  const b = await paidCall(buyer, 'traductor', 'GPUB', 2, lastPeriod);
  const claim = await createClaim(buyer, b.transactionId, 'Respuesta incompleta, faltó la mitad.');
  await assert.rejects(() => resolveClaim(admin, claim.id, { decision: 'refund', amount: USDC(2.5) }), /supera/);
  await assert.rejects(() => resolveClaim(admin, claim.id, { decision: 'refund', amount: 0 }), /inválido/);
  await resolveClaim(admin, claim.id, { decision: 'reject' });

  await closePeriods();
  await fundHolds();
  const [h] = await holdsOf('traductor');
  await age(Number(h.id), 14);
  await releaseDue();
  await assert.rejects(() => createClaim(buyer, a.transactionId, 'Reclamo tarde: ya pasaron dos semanas.'), /plazo/);
  const info = await claimInfoForTransactions(buyer, [a.transactionId, b.transactionId]);
  assert.equal(info[a.transactionId].claimable, false);
  assert.equal(info[b.transactionId].claim?.status, 'rejected');
});

test('si todo lo del período se devolvió, no se crea escrow', async () => {
  const buyer = await createUser('b@x.com');
  const admin = await createUser('admin@kiba.test');
  const a = await paidCall(buyer, 'traductor', 'GPUB', 3, lastPeriod);
  await closePeriods();
  const claim = await createClaim(buyer, a.transactionId, 'El servicio falló y no entregó nada.');
  await resolveClaim(admin, claim.id, { decision: 'refund' });
  await fundHolds();
  assert.equal((await holdsOf('traductor'))[0].status, 'void');
  assert.equal(escrows.escrows.size, 0);
  assert.equal(await credits(buyer), USDC(3));
});

test('los administradores son los correos de ADMIN_EMAILS', () => {
  const prev = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'ana@kiba.tools, Luis@Kiba.tools';
  try {
    assert.equal(isAdminEmail('ana@kiba.tools'), true);
    assert.equal(isAdminEmail('LUIS@kiba.tools'), true);
    assert.equal(isAdminEmail('otro@kiba.tools'), false);
    assert.equal(isAdminEmail(undefined), false);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  }
});
