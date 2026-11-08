/**
 * x402 estándar (lado vendedor): un servicio Kiba cobra a clientes x402 cualesquiera.
 * El facilitador se simula; el protocolo (cabeceras, requisitos, verificación, liquidación)
 * es el real de @x402/core.
 */
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';
import { AgentProvider } from '../src/provider';
import type { X402FacilitatorClient, X402Payload, X402Requirements } from '../src/x402-standard';

const owner = Keypair.random();

class FakeFacilitator implements X402FacilitatorClient {
  mode: 'ok' | 'invalid' | 'settle-fail' = 'ok';
  verifies: Array<{ payload: X402Payload; requirements: X402Requirements }> = [];
  settles: Array<{ payload: X402Payload; requirements: X402Requirements }> = [];
  async verify(payload: X402Payload, requirements: X402Requirements) {
    this.verifies.push({ payload, requirements });
    if (this.mode === 'invalid') return { isValid: false, invalidReason: 'insufficient_funds', invalidMessage: 'sin USDC' };
    return { isValid: true, payer: 'GPAYER' };
  }
  async settle(payload: X402Payload, requirements: X402Requirements) {
    this.settles.push({ payload, requirements });
    if (this.mode === 'settle-fail') {
      return { success: false, errorReason: 'tx_failed', errorMessage: 'la red la rechazó', transaction: '', network: requirements.network };
    }
    return { success: true, transaction: 'ab'.repeat(32), network: requirements.network, payer: 'GPAYER' };
  }
  async getSupported() {
    return {
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet', extra: { areFeesSponsored: true } }],
      extensions: [],
      signers: {} as Record<string, string[]>,
    };
  }
}

const facilitator = new FakeFacilitator();
let provider: AgentProvider;
let server: Server;
let baseUrl: string;

before(async () => {
  provider = new AgentProvider({
    secret: owner.secret(),
    service: 'echo-x402',
    pricePerCall: 0.01,
    description: 'echo con x402 estándar',
    endpoint: 'http://localhost:9999/service',
    allowUnverified: true,
    priceFn: (req) => 0.001 + ((req as { text?: string })?.text?.length ?? 0) * 0.0001,
    x402: { facilitator },
  });
  provider.serve(async (req: unknown) => ({ echoed: req }));
  await new Promise<void>((resolve) => {
    server = provider.app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

beforeEach(() => {
  facilitator.mode = 'ok';
  facilitator.verifies = [];
  facilitator.settles = [];
});

async function quote(body: unknown): Promise<{ res: Response; accepts: X402Requirements[]; kiba: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const header = res.headers.get('payment-required');
  const accepts = header ? (decodePaymentRequiredHeader(header).accepts as X402Requirements[]) : [];
  return { res, accepts, kiba: (await res.json()) as Record<string, unknown> };
}

function paid(body: unknown, accepted: X402Requirements): Promise<Response> {
  const payload: X402Payload = { x402Version: 2, accepted, payload: { transaction: 'AAAA-firmado' } };
  return fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'payment-signature': encodePaymentSignatureHeader(payload) },
    body: JSON.stringify(body),
  });
}

test('el manifest anuncia x402 estándar con la cuenta del agente', async () => {
  const m = (await (await fetch(`${baseUrl}/manifest`)).json()) as { x402?: Record<string, unknown> };
  assert.deepEqual(m.x402, { standard: 'x402', version: 2, scheme: 'exact', network: 'stellar:testnet', payTo: owner.publicKey() });
});

test('el 402 lleva PAYMENT-REQUIRED con el precio de ESTA petición, además de la cotización de Kiba', async () => {
  const { res, accepts, kiba } = await quote({ text: 'hola' });
  assert.equal(res.status, 402);
  assert.equal(kiba.amount, '100000'); // floor 0.01 USDC
  assert.ok(kiba.nonce);
  assert.equal(accepts.length, 1);
  const a = accepts[0];
  assert.equal(a.scheme, 'exact');
  assert.equal(a.network, 'stellar:testnet');
  assert.equal(a.asset, USDC_TESTNET_ADDRESS);
  assert.equal(a.payTo, owner.publicKey());
  assert.equal(a.amount, '100000');
  // Precio dinámico: un texto largo sube el precio y el requisito lo refleja.
  const long = await quote({ text: 'x'.repeat(300) });
  assert.equal(long.accepts[0].amount, '310000'); // 0.001 + 300*0.0001 = 0.031 USDC
});

test('PAYMENT-SIGNATURE válida: verifica, sirve, liquida y devuelve PAYMENT-RESPONSE', async () => {
  const body = { text: 'hola' };
  const { accepts } = await quote(body);
  const res = await paid(body, accepts[0]);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { echoed: unknown; _payment: Record<string, unknown> };
  assert.deepEqual(data.echoed, body);
  assert.equal(data._payment.standard, 'x402');
  assert.equal(data._payment.transaction, 'ab'.repeat(32));
  assert.equal(data._payment.payer, 'GPAYER');
  const settled = decodePaymentResponseHeader(res.headers.get('payment-response')!);
  assert.equal(settled.success, true);
  assert.equal(settled.transaction, 'ab'.repeat(32));
  assert.equal(facilitator.verifies.length, 1);
  assert.equal(facilitator.settles.length, 1);
  assert.equal(facilitator.settles[0].requirements.payTo, owner.publicKey());
});

test('payTo ajeno: 402 sin consultar al facilitador, con re-cotización', async () => {
  const body = { text: 'hola' };
  const { accepts } = await quote(body);
  const res = await paid(body, { ...accepts[0], payTo: Keypair.random().publicKey() });
  assert.equal(res.status, 402);
  const data = (await res.json()) as { error: string; amount: string };
  assert.match(data.error, /payTo no es la cuenta de este servicio/);
  assert.equal(data.amount, '100000');
  assert.ok(res.headers.get('payment-required'));
  assert.equal(facilitator.verifies.length, 0);
});

test('monto por debajo del precio de la petición: 402 (el precio es por cuerpo, no por ruta)', async () => {
  const cheap = { text: 'hola' };
  const { accepts } = await quote(cheap);
  const res = await paid({ text: 'x'.repeat(300) }, accepts[0]); // pagó 0.01, cuesta 0.031
  assert.equal(res.status, 402);
  const data = (await res.json()) as { error: string };
  assert.match(data.error, /por debajo del precio 310000/);
  assert.equal(facilitator.verifies.length, 0);
});

test('el facilitador invalida el pago: 402 y no se liquida', async () => {
  facilitator.mode = 'invalid';
  const body = { text: 'hola' };
  const { accepts } = await quote(body);
  const res = await paid(body, accepts[0]);
  assert.equal(res.status, 402);
  assert.match(((await res.json()) as { error: string }).error, /rechazó el pago: insufficient_funds \(sin USDC\)/);
  assert.equal(facilitator.settles.length, 0);
});

test('la liquidación falla: 402 y el resultado no se entrega', async () => {
  facilitator.mode = 'settle-fail';
  const body = { text: 'hola' };
  const { accepts } = await quote(body);
  const res = await paid(body, accepts[0]);
  assert.equal(res.status, 402);
  const data = (await res.json()) as { error: string; echoed?: unknown };
  assert.match(data.error, /no se pudo liquidar el pago: tx_failed/);
  assert.equal(data.echoed, undefined);
  assert.equal(res.headers.get('payment-response'), null);
});

test('sin x402 configurado el 402 no lleva PAYMENT-REQUIRED (comportamiento previo intacto)', async () => {
  const plain = new AgentProvider({ secret: Keypair.random().secret(), service: 'plain', pricePerCall: 0.01, allowUnverified: true });
  plain.serve(async () => ({ ok: true }));
  const r = await plain.verifyAndServe({ body: {}, headers: {}, ip: '1.1.1.1' });
  assert.equal(r.status, 402);
  assert.equal(r.headers, undefined);
  assert.equal(plain.x402, null);
});
