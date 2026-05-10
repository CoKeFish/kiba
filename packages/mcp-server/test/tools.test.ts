// _setup-env: patchea Server.prototype.connect ANTES de importar el módulo
// para evitar que se conecte al stdio real. También settea env y captura la
// instancia.
import { getCapturedServer, TEST_TMP_DIR } from './_setup-env';

// Importar el módulo dispara la registración de handlers. Lo cargamos como
// side-effect (no tiene exports).
import '../src/index';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { rmSync } from 'node:fs';

// Mock axios.get/.post — el mcp-server usa ambas.
interface MockReq { url: string; body?: unknown; opts?: { headers?: Record<string, string> } }
const calls: MockReq[] = [];
let getQueue: Array<(req: MockReq) => Promise<{ data: unknown }>> = [];
let postQueue: Array<(req: MockReq) => Promise<{ data: unknown }>> = [];

const origPost = axios.post;
const origGet = axios.get;

before(() => {
  // @ts-expect-error monkey-patch
  axios.get = async (url: string, opts?: unknown) => {
    calls.push({ url, opts: opts as { headers?: Record<string, string> } });
    const handler = getQueue.shift();
    if (!handler) throw new Error(`unexpected GET: ${url}`);
    return handler({ url, opts: opts as { headers?: Record<string, string> } });
  };
  // @ts-expect-error monkey-patch
  axios.post = async (url: string, body: unknown, opts?: unknown) => {
    calls.push({ url, body, opts: opts as { headers?: Record<string, string> } });
    const handler = postQueue.shift();
    if (!handler) throw new Error(`unexpected POST: ${url}`);
    return handler({ url, body, opts: opts as { headers?: Record<string, string> } });
  };
});

after(() => {
  // @ts-expect-error restore
  axios.get = origGet;
  // @ts-expect-error restore
  axios.post = origPost;
  try {
    rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  calls.length = 0;
  getQueue = [];
  postQueue = [];
});

// Helpers para invocar handlers
async function callHandler(method: string, params: unknown): Promise<unknown> {
  const handlers = getCapturedServer()._requestHandlers;
  const fn = handlers.get(method);
  assert.ok(fn, `handler para ${method} no registrado`);
  // El segundo arg "extra" es contexto interno; con un AbortSignal+sendNotification
  // basta para que no rompa.
  const extra = {
    signal: new AbortController().signal,
    sendNotification: () => Promise.resolve(),
    sendRequest: () => Promise.resolve({}),
    requestId: 1,
  };
  return await fn!({ method, params }, extra);
}

// ─── tools/list ────────────────────────────────────────────────

test('tools/list devuelve los 4 tools del marketplace', async () => {
  const result = (await callHandler('tools/list', {})) as {
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  };
  assert.equal(result.tools.length, 4);
  const names = result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['call_agent', 'get_balance', 'get_transactions', 'list_agents']);
});

test('tools/list: call_agent declara service como required', async () => {
  const result = (await callHandler('tools/list', {})) as {
    tools: Array<{ name: string; inputSchema: { required?: string[] } }>;
  };
  const callAgent = result.tools.find((t) => t.name === 'call_agent')!;
  assert.deepEqual(callAgent.inputSchema.required, ['service']);
});

// ─── tools/call: list_agents → GET /v1/agents ──────────────────

test('list_agents llama GET /v1/agents y devuelve content tipo text con JSON', async () => {
  getQueue.push(async () => ({ data: [{ service: 'translator', pricePerCall: 0.01 }] }));
  const result = (await callHandler('tools/call', {
    name: 'list_agents',
    arguments: {},
  })) as { content: Array<{ type: string; text: string }> };

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/agents$/);
  // Verifica que se mandó el Authorization header
  assert.equal(
    (calls[0].opts as { headers?: Record<string, string> })?.headers?.Authorization,
    'Bearer tok_test_dummy',
  );
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  const parsed = JSON.parse(result.content[0].text) as Array<{ service: string }>;
  assert.equal(parsed[0].service, 'translator');
});

// ─── tools/call: get_balance → GET /v1/balance ─────────────────

test('get_balance llama GET /v1/balance', async () => {
  getQueue.push(async () => ({
    data: { balance_lamports: 33_333_333, balance_usd: 5.0 },
  }));
  const result = (await callHandler('tools/call', {
    name: 'get_balance',
    arguments: {},
  })) as { content: Array<{ type: string; text: string }> };

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/balance$/);
  const parsed = JSON.parse(result.content[0].text) as { balance_usd: number };
  assert.equal(parsed.balance_usd, 5.0);
});

// ─── tools/call: get_transactions → GET /v1/transactions ───────

test('get_transactions llama GET /v1/transactions', async () => {
  getQueue.push(async () => ({
    data: [{ id: '1', type: 'topup', amount_lamports: 1000, created_at: 0 }],
  }));
  const result = (await callHandler('tools/call', {
    name: 'get_transactions',
    arguments: {},
  })) as { content: Array<{ type: string; text: string }> };

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/transactions$/);
  const parsed = JSON.parse(result.content[0].text) as Array<{ type: string }>;
  assert.equal(parsed[0].type, 'topup');
});

// ─── tools/call: call_agent → POST /v1/call ────────────────────

test('call_agent envía POST /v1/call con service+payload', async () => {
  postQueue.push(async () => ({
    data: { result: { translated: 'hola' }, cost: { usd: 0.01 }, mode: 'virtual' },
  }));
  const result = (await callHandler('tools/call', {
    name: 'call_agent',
    arguments: { service: 'translator', payload: { text: 'hello' } },
  })) as { content: Array<{ type: string; text: string }> };

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/call$/);
  assert.deepEqual(calls[0].body, {
    service: 'translator',
    payload: { text: 'hello' },
  });
  const parsed = JSON.parse(result.content[0].text) as {
    result: { translated: string };
    mode: string;
  };
  assert.equal(parsed.result.translated, 'hola');
  assert.equal(parsed.mode, 'virtual');
});

test('call_agent sin service: isError true con mensaje "service required"', async () => {
  const result = (await callHandler('tools/call', {
    name: 'call_agent',
    arguments: {},
  })) as { content: Array<{ text: string }>; isError?: boolean };

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /service required/i);
});

test('call_agent con payload omitido → defaults a {}', async () => {
  postQueue.push(async () => ({ data: { ok: true } }));
  await callHandler('tools/call', {
    name: 'call_agent',
    arguments: { service: 'no-payload' },
  });
  assert.deepEqual(calls[0].body, { service: 'no-payload', payload: {} });
});

test('call de tool desconocida → isError true con mensaje "unknown tool"', async () => {
  const result = (await callHandler('tools/call', {
    name: 'totally_made_up',
    arguments: {},
  })) as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unknown tool/i);
});

test('error de gateway se propaga como isError + mensaje en content', async () => {
  getQueue.push(async () => {
    throw new Error('Network down');
  });
  const result = (await callHandler('tools/call', {
    name: 'list_agents',
    arguments: {},
  })) as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Network down/);
});

// ─── list_agents con query (Fix #1) ────────────────────────────

test('list_agents con query manda ?q=… URL-encoded al gateway', async () => {
  getQueue.push(async () => ({ data: [{ service: 'translator-pro', score: 0.91 }] }));
  await callHandler('tools/call', {
    name: 'list_agents',
    arguments: { query: 'translate text to spanish' },
  });
  assert.equal(calls.length, 1);
  // URL debe terminar con ?q=translate%20text%20to%20spanish
  assert.match(calls[0].url, /\/v1\/agents\?q=translate%20text%20to%20spanish$/);
});

test('list_agents con query en español (utf-8) se URL-encodea correctamente', async () => {
  getQueue.push(async () => ({ data: [] }));
  await callHandler('tools/call', {
    name: 'list_agents',
    arguments: { query: 'traducción' },
  });
  // 'ó' encode → %C3%B3 ; 'ó' es 0xC3 0xB3 en UTF-8
  assert.match(calls[0].url, /\/v1\/agents\?q=traducci%C3%B3n$/);
});

test('list_agents con query="" (vacío) → cae al path sin filtro', async () => {
  getQueue.push(async () => ({ data: [] }));
  await callHandler('tools/call', {
    name: 'list_agents',
    arguments: { query: '   ' },
  });
  assert.match(calls[0].url, /\/v1\/agents$/);
});

test('list_agents declara `query` como propiedad opcional en su inputSchema', async () => {
  const result = (await callHandler('tools/list', {})) as {
    tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }>;
  };
  const list = result.tools.find((t) => t.name === 'list_agents')!;
  assert.ok(list.inputSchema.properties, 'inputSchema.properties debe existir');
  assert.ok('query' in list.inputSchema.properties, 'query debe estar declarado');
  // No debe ser required (la búsqueda es opcional)
  assert.ok(
    !list.inputSchema.required || !list.inputSchema.required.includes('query'),
    'query no debe ser required',
  );
});
