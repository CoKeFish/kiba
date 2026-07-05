/**
 * E2E del fund per-call (escrow TW por servicio/ciclo) contra el stack local.
 *
 * Corre DENTRO del contenedor del gateway (usa su red y su DATABASE_URL):
 *
 *   docker compose exec -e SERVICE=<service> gateway node --import tsx test/e2e-fund-per-call.ts
 *
 * Prerrequisitos (ver plan):
 *   - Gateway con TRUSTLESS_WORK_API_KEY y SETTLEMENT_MIN_PAYOUT bajo (p.ej. 100000).
 *   - Treasury local con USDC (faucet de Circle) y trustline establecida.
 *   - El agente standalone (examples/standalone-agent) corriendo en el host con
 *     SERVICE=<service> único y PUBLIC_ENDPOINT accesible desde Docker.
 *
 * Flujo verificado:
 *   1. El backend indexa el servicio → ownerWallet.
 *   2. signup + topup de créditos (modo crédito garantizado).
 *   3. /v1/call ×2 → explorerUrl presente, step escrow_opened con hash+escrowId, MISMO
 *      escrow en ambas, tx consultable en Horizon, transactions.signature poblada,
 *      agent_earnings.escrow_id seteado, service_escrows activa con funded = suma.
 *   4. /v1/publisher/settle → settlement 'settled', escrow 'released', delta USDC del
 *      agente ≈ 94-95% de lo fondeado (valida que el release paga el BALANCE).
 *   5. /v1/call de nuevo → escrow NUEVO (ciclo 2).
 */
import assert from 'node:assert/strict';
import axios, { type AxiosInstance } from 'axios';
import { db } from '../src/db';

const SERVICE = process.env.SERVICE || '';
const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:8000').replace(/\/+$/, '');
const BACKEND = (process.env.BACKEND_URL || 'http://backend:4000').replace(/\/+$/, '');
const HORIZON = (process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org').replace(/\/+$/, '');
const USDC_ISSUER =
  process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS ||
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

if (!SERVICE) {
  console.error('Falta SERVICE (nombre del agente de prueba registrado por el standalone).');
  process.exit(1);
}

function step(msg: string): void {
  console.log(`\n━━ ${msg}`);
}

async function poll<T>(
  label: string,
  fn: () => Promise<T | null>,
  { timeoutMs = 120_000, everyMs = 3_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v !== null) return v;
    } catch {
      /* red aún no disponible (p.ej. backend arrancando) — reintenta */
    }
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Balance USDC (decimal) de una cuenta G... vía Horizon; 0 si no existe/sin trustline. */
async function usdcBalance(account: string): Promise<number> {
  const r = await axios.get(`${HORIZON}/accounts/${account}`, { validateStatus: () => true });
  if (r.status !== 200) return 0;
  const entry = (r.data.balances as Array<Record<string, string>>).find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  return entry ? parseFloat(entry.balance) : 0;
}

interface CallResult {
  explorerUrl?: string;
  cost: { baseUnits?: number; lamports?: number };
  trace: { steps: Array<Record<string, unknown>> };
  mode: string;
}

async function callService(http: AxiosInstance, payload: unknown): Promise<CallResult> {
  const r = await http.post(`${GATEWAY}/v1/call`, { service: SERVICE, payload });
  assert.equal(r.status, 200, `POST /v1/call → ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data as CallResult;
}

function escrowStep(call: CallResult): { signature: string; escrowId: string } {
  const s = call.trace.steps.find((x) => x.type === 'escrow_opened');
  assert.ok(s, 'el trace debe incluir el step escrow_opened (fund per-call confirmado)');
  assert.ok(typeof s!.signature === 'string' && s!.signature, 'escrow_opened.signature (hash) vacío');
  assert.ok(typeof s!.escrowId === 'string' && s!.escrowId, 'escrow_opened.escrowId vacío');
  return { signature: s!.signature as string, escrowId: s!.escrowId as string };
}

async function main(): Promise<void> {
  // Corridas previas pueden dejar earnings sin liquidar (p.ej. settlements fallidos
  // durante el desarrollo): los asserts de DB se limitan a lo creado por ESTA corrida.
  const t0 = Math.floor(Date.now() / 1000) - 5;

  // ── 1. El backend indexa el servicio ─────────────────────────────────────
  step(`1. Esperando que el backend indexe '${SERVICE}'`);
  const manifest = await poll(`backend /agents/${SERVICE}`, async () => {
    const r = await axios.get(`${BACKEND}/agents/${encodeURIComponent(SERVICE)}`, {
      validateStatus: () => true,
    });
    return r.status === 200 ? (r.data as { ownerWallet: string }) : null;
  });
  const agentWallet = manifest.ownerWallet;
  assert.ok(agentWallet?.startsWith('G'), `ownerWallet inválido: ${agentWallet}`);
  console.log(`   ownerWallet = ${agentWallet}`);

  // ── 2. Usuario + créditos ────────────────────────────────────────────────
  step('2. signup + topup');
  const email = `e2e-${Date.now()}@kiba.test`;
  const signup = await axios.post(
    `${GATEWAY}/signup`,
    { email, password: 'e2e-secret' },
    { headers: { Accept: 'application/json' }, validateStatus: () => true },
  );
  assert.equal(signup.status, 200, `signup → ${signup.status}: ${JSON.stringify(signup.data)}`);
  const cookie = (signup.headers['set-cookie'] ?? [])
    .map((c: string) => c.split(';')[0])
    .join('; ');
  assert.ok(cookie.includes('session='), 'signup no devolvió cookie de sesión');
  const userId = Number((signup.data as { user: { id: string } }).user.id);
  const http = axios.create({
    headers: { Cookie: cookie, Accept: 'application/json' },
    timeout: 150_000,
    validateStatus: () => true,
  });
  const topup = await http.post(`${GATEWAY}/v1/topup`, { amount: 5 });
  assert.equal(topup.status, 200, `topup → ${topup.status}: ${JSON.stringify(topup.data)}`);
  console.log(`   user ${userId} con $${(topup.data as { balance_usd: number }).balance_usd} de crédito`);

  // ── 3. Dos llamadas → fund per-call al MISMO escrow ──────────────────────
  step('3. /v1/call ×2 (fund per-call)');
  // El escrow del ciclo puede venir de una corrida previa con fondos ya acumulados:
  // los asserts comparan el INCREMENTO de funded_lamports, no el absoluto.
  const activeBefore = (await db
    .prepare("SELECT escrow_id, funded_lamports FROM service_escrows WHERE service = ? AND status = 'active'")
    .get(SERVICE)) as { escrow_id: string; funded_lamports: number } | undefined;
  const call1 = await callService(http, { text: 'hola mundo, primera llamada e2e' });
  assert.equal(call1.mode, 'virtual', `la llamada debió salir en modo crédito, salió ${call1.mode}`);
  assert.ok(call1.explorerUrl, 'call 1 sin explorerUrl (el fund no confirmó)');
  const e1 = escrowStep(call1);
  console.log(`   call 1: tx ${e1.signature.slice(0, 10)}… escrow ${e1.escrowId.slice(0, 10)}…`);
  console.log(`   explorer: ${call1.explorerUrl}`);

  const call2 = await callService(http, { text: 'segunda llamada e2e' });
  assert.ok(call2.explorerUrl, 'call 2 sin explorerUrl');
  const e2 = escrowStep(call2);
  assert.equal(e2.escrowId, e1.escrowId, 'las dos llamadas deben fondear el MISMO escrow del ciclo');
  assert.notEqual(e2.signature, e1.signature, 'cada llamada debe tener su PROPIA tx de fondeo');
  console.log(`   call 2: tx ${e2.signature.slice(0, 10)}… mismo escrow ✓`);

  // Ambas txs consultables en Horizon.
  for (const sig of [e1.signature, e2.signature]) {
    const r = await axios.get(`${HORIZON}/transactions/${sig}`, { validateStatus: () => true });
    assert.equal(r.status, 200, `Horizon no resuelve la tx ${sig}`);
    assert.notEqual(r.data.successful, false, `tx ${sig} no exitosa`);
  }
  console.log('   ambas txs resuelven en Horizon ✓');

  // Estado en DB.
  const txRows = (await db
    .prepare(
      "SELECT signature FROM transactions WHERE user_id = ? AND type = 'call' ORDER BY id",
    )
    .all(userId)) as Array<{ signature: string | null }>;
  assert.equal(txRows.length, 2);
  assert.ok(txRows.every((t) => t.signature), 'transactions.signature debe quedar poblada');

  const earnRows = (await db
    .prepare(
      'SELECT escrow_id, amount_lamports FROM agent_earnings WHERE service = ? AND settled_at IS NULL AND created_at >= ?',
    )
    .all(SERVICE, t0)) as Array<{ escrow_id: string | null; amount_lamports: number }>;
  assert.equal(earnRows.length, 2);
  assert.ok(earnRows.every((r) => r.escrow_id === e1.escrowId), 'agent_earnings.escrow_id debe apuntar al escrow del ciclo');
  const fundedSum = earnRows.reduce((s, r) => s + r.amount_lamports, 0);

  const escrowRow = (await db
    .prepare("SELECT * FROM service_escrows WHERE service = ? AND status = 'active'")
    .get(SERVICE)) as { escrow_id: string; funded_lamports: number } | undefined;
  assert.ok(escrowRow, 'debe existir service_escrows activa');
  assert.equal(escrowRow!.escrow_id, e1.escrowId);
  const fundedBefore =
    activeBefore?.escrow_id === escrowRow!.escrow_id ? Number(activeBefore.funded_lamports) : 0;
  assert.equal(
    Number(escrowRow!.funded_lamports) - fundedBefore,
    fundedSum,
    'incremento de funded_lamports = suma de las llamadas de esta corrida',
  );
  console.log(`   DB consistente ✓ (fondeado +${fundedSum} base units)`);

  // ── 4. Settle → release del escrow ───────────────────────────────────────
  step('4. /v1/publisher/settle (release del ciclo)');
  const balBefore = await usdcBalance(agentWallet);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      'INSERT INTO user_agents (service, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT (service) DO UPDATE SET user_id = EXCLUDED.user_id',
    )
    .run(SERVICE, userId, now);

  const settle = await http.post(`${GATEWAY}/v1/publisher/settle`, {});
  assert.equal(settle.status, 200, `settle → ${settle.status}: ${JSON.stringify(settle.data)}`);
  const result = (settle.data as { settlements: Array<Record<string, unknown>> }).settlements.find(
    (s) => s.service === SERVICE,
  );
  assert.ok(result, 'el settle debe incluir el servicio de prueba');
  assert.equal(result!.status, 'settled', `settlement no liquidado: ${JSON.stringify(result)}`);
  console.log(`   settlement settled ✓ (escrow(s): ${result!.escrowId})`);

  const released = (await db
    .prepare('SELECT status FROM service_escrows WHERE escrow_id = ?')
    .get(e1.escrowId)) as { status: string };
  assert.equal(released.status, 'released');

  // El agente recibió ~94-95% del TOTAL liquidado (platformFee 5% + fee TW ~0.3%).
  // El liquidado puede incluir acumulado previo de la misma service (settlements
  // fallidos de corridas anteriores) → se compara contra amountLamports del settle.
  const settledLamports = Number(result!.amountLamports);
  assert.ok(settledLamports >= fundedSum, 'el settle debe cubrir al menos lo fondeado en esta corrida');
  const expected = settledLamports / 1e7;
  const delta = await poll(
    'delta USDC del agente',
    async () => {
      const bal = await usdcBalance(agentWallet);
      const d = bal - balBefore;
      return d > 0 ? d : null;
    },
    { timeoutMs: 90_000 },
  );
  console.log(`   agente +${delta.toFixed(7)} USDC (liquidado ${expected.toFixed(7)})`);
  assert.ok(
    delta >= expected * 0.92 && delta <= expected * 0.97,
    `delta ${delta} fuera del rango esperado [92%, 97%] de ${expected}`,
  );

  // ── 5. Ciclo nuevo ───────────────────────────────────────────────────────
  step('5. /v1/call de nuevo → escrow del ciclo 2');
  const call3 = await callService(http, { text: 'tercera llamada e2e (ciclo 2)' });
  assert.ok(call3.explorerUrl, 'call 3 sin explorerUrl');
  const e3 = escrowStep(call3);
  assert.notEqual(e3.escrowId, e1.escrowId, 'el ciclo 2 debe usar un escrow NUEVO');
  console.log(`   ciclo 2: escrow ${e3.escrowId.slice(0, 10)}… ✓`);

  console.log('\n✅ E2E fund-per-call: TODO OK');
  console.log(`   tx call 1: ${call1.explorerUrl}`);
  console.log(`   tx call 2: ${call2.explorerUrl}`);
  console.log(`   tx call 3: ${call3.explorerUrl}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ E2E falló:', err.message ?? err);
  process.exit(1);
});
