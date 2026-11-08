import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GatewayError, KibaGateway, PARENT_CALL_HEADER } from '../src/gateway-client';
import { ConfigError } from '../src/errors';

// ─── Gateway falso ─────────────────────────────────────────────

interface Seen {
  method: string;
  url: string;
  auth?: string;
  parent?: string;
  body?: unknown;
}

const seen: Seen[] = [];
let polls = 0;
let server: Server;
let url: string;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      auth: req.headers.authorization,
      parent: req.headers[PARENT_CALL_HEADER.toLowerCase()] as string | undefined,
      body,
    });
    if (req.headers.authorization !== 'Bearer k-test') return json(res, 401, { error: 'unauthorized' });

    const path = req.url ?? '';
    if (req.method === 'POST' && path === '/v1/call') {
      const { service } = body as { service: string };
      if (service === 'fast') {
        return json(res, 200, {
          status: 'done',
          resultId: 'res_fast',
          resultUrl: 'https://app/results/res_fast',
          result: { hi: 1 },
          cost: { lamports: 1234, usd: 0.0001234 },
          explorerUrl: 'https://stellar.expert/tx/fast',
        });
      }
      if (service === 'slow') return json(res, 200, { status: 'pending', resultId: 'res_slow', resultUrl: 'u' });
      if (service === 'boom') return json(res, 500, { error: 'el servicio no respondió' });
      return json(res, 400, { error: `servicio desconocido ${service}` });
    }
    if (req.method === 'GET' && path.startsWith('/v1/results/res_slow')) {
      polls += 1;
      if (polls < 2) return json(res, 200, { status: 'pending', resultId: 'res_slow' });
      return json(res, 200, {
        status: 'done',
        resultId: 'res_slow',
        resultUrl: 'u',
        result: { ok: true },
        costBaseUnits: 5000,
        explorerUrl: 'https://stellar.expert/tx/slow',
      });
    }
    if (req.method === 'GET' && path.startsWith('/v1/results/res_err')) {
      return json(res, 200, { status: 'error', resultId: 'res_err', error: 'página vacía' });
    }
    if (req.method === 'POST' && path === '/v1/x402/call') {
      return json(res, 200, {
        resultId: 'res_x',
        url: (body as { url: string }).url,
        status: 200,
        result: { weather: 'sunny' },
        paid: true,
        cost: { lamports: 100000, usd: 0.01 },
        payTo: 'GSELLER',
        network: 'stellar:testnet',
        txHash: 'abc',
        explorerUrl: 'https://stellar.expert/tx/abc',
      });
    }
    if (req.method === 'GET' && path === '/v1/balance') return json(res, 200, { total_usd: 4.2 });
    json(res, 404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

// ─── Tests ─────────────────────────────────────────────────────

test('sin clave de API: enabled=false y call lanza ConfigError', async () => {
  const saved = process.env.KIBA_API_KEY;
  delete process.env.KIBA_API_KEY;
  try {
    const g = new KibaGateway({ url });
    assert.equal(g.enabled, false);
    await assert.rejects(g.call('fast', {}), ConfigError);
  } finally {
    if (saved !== undefined) process.env.KIBA_API_KEY = saved;
  }
});

test('call: manda la clave y el padre, y normaliza la respuesta hecha en línea', async () => {
  seen.length = 0;
  const g = new KibaGateway({ url, apiKey: 'k-test' }).forCall('res_parent');
  assert.equal(g.parentCallId, 'res_parent');
  const out = await g.call<{ hi: number }>('fast', { a: 1 });
  assert.equal(out.result.hi, 1);
  assert.equal(out.resultId, 'res_fast');
  assert.deepEqual(out.cost, { baseUnits: 1234, usd: 0.0001234 });
  assert.equal(out.explorerUrl, 'https://stellar.expert/tx/fast');
  assert.equal(seen[0].auth, 'Bearer k-test');
  assert.equal(seen[0].parent, 'res_parent');
  assert.deepEqual(seen[0].body, { service: 'fast', payload: { a: 1 }, waitMs: 40_000 });
});

test('call: un resultado pendiente se espera hasta que termina', async () => {
  seen.length = 0;
  polls = 0;
  const g = new KibaGateway({ url, apiKey: 'k-test' });
  const out = await g.call<{ ok: boolean }>('slow', {});
  assert.equal(out.result.ok, true);
  assert.equal(out.cost.baseUnits, 5000);
  assert.equal(out.cost.usd, 0.0005);
  assert.equal(out.explorerUrl, 'https://stellar.expert/tx/slow');
  assert.equal(seen.filter((s) => s.url.startsWith('/v1/results/')).length, 2);
  // Sin padre no viaja la cabecera.
  assert.equal(seen[0].parent, undefined);
});

test('call: el error del gateway llega con su mensaje', async () => {
  const g = new KibaGateway({ url, apiKey: 'k-test' });
  await assert.rejects(g.call('boom', {}), (err: unknown) => {
    assert.ok(err instanceof GatewayError);
    assert.equal(err.message, 'el servicio no respondió');
    assert.equal(err.status, 500);
    return true;
  });
});

test('callUrl: paga una API x402 y normaliza el costo', async () => {
  seen.length = 0;
  const g = new KibaGateway({ url, apiKey: 'k-test' }).forCall('res_p2');
  const out = await g.callUrl<{ weather: string }>('https://api.example.com/weather', { maxUsd: 0.05 });
  assert.equal(out.result.weather, 'sunny');
  assert.equal(out.paid, true);
  assert.deepEqual(out.cost, { baseUnits: 100000, usd: 0.01 });
  assert.equal(out.txHash, 'abc');
  assert.equal(out.payTo, 'GSELLER');
  assert.equal(seen[0].parent, 'res_p2');
  assert.deepEqual(seen[0].body, { url: 'https://api.example.com/weather', maxUsd: 0.05 });
});

test('balanceUsd lee el saldo total', async () => {
  const g = new KibaGateway({ url, apiKey: 'k-test' });
  assert.equal(await g.balanceUsd(), 4.2);
});
