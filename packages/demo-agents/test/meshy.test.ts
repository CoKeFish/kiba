/**
 * Tests del agente Meshy (3d-generator). El agente es un wrapper sobre la API de Meshy,
 * así que probamos lo que puede romperse sin gastar créditos reales:
 *
 *   1. Normalización del request (sinónimos), resolución de la operación y pricing (puro).
 *   2. Construcción de los bodies de creación (texto / refine / imagen).
 *   3. El wrapper completo (generate) contra un Meshy FALSO local: crear + long-poll hasta
 *      SUCCEEDED, consulta por taskId sin saber el tipo (texto 404 → imagen), header de auth
 *      y mapeo de errores (401/402). Determinista, sin red.
 *
 * Correr:  npm test            (dentro de packages/demo-agents)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  normalizeRequest,
  resolveOp,
  priceFor,
  buildCreate,
  mapTask,
  generate,
  PRICE_STATUS_USDC,
  PRICE_TEXT_USDC,
  PRICE_TEXT_HIGH_USDC,
  PRICE_REFINE_USDC,
  PRICE_IMAGE_USDC,
  PRICE_IMAGE_HIGH_USDC,
  MODEL_STANDARD,
  MODEL_HIGH,
  type MeshyConfig,
} from '../src/meshy-core';

// ─── 1. normalizeRequest / resolveOp / priceFor (puro) ────────────────────────

test('normalizeRequest: sinónimos de prompt, imagen y taskId', () => {
  for (const key of ['prompt', 'text', 'description', 'query', 'object']) {
    assert.equal(normalizeRequest({ [key]: ' a robot ' }).prompt, 'a robot', `sinónimo ${key}`);
  }
  for (const key of ['imageUrl', 'image_url', 'image', 'url', 'link']) {
    assert.equal(normalizeRequest({ [key]: 'https://x/1.png' }).imageUrl, 'https://x/1.png', `sinónimo ${key}`);
  }
  for (const key of ['taskId', 'task_id', 'task', 'id', 'preview_task_id']) {
    assert.equal(normalizeRequest({ [key]: 'abc' }).taskId, 'abc', `sinónimo ${key}`);
  }
  assert.equal(normalizeRequest({ quality: 'high' }).quality, 'high');
  assert.equal(normalizeRequest({ model: 'meshy-7.1' }).quality, 'high');
  assert.equal(normalizeRequest({ quality: 'whatever' }).quality, 'standard');
  assert.equal(normalizeRequest({ taskId: 'x', texture: 'true' }).refine, true);
  assert.equal(normalizeRequest({ taskId: 'x', mode: 'refine' }).refine, true);
  assert.deepEqual(normalizeRequest({}).formats, ['glb']);
  assert.deepEqual(normalizeRequest({ formats: 'glb, FBX, exe' }).formats, ['glb', 'fbx']);
});

test('resolveOp: elige la operación y exige la entrada mínima', () => {
  assert.equal(resolveOp(normalizeRequest({ prompt: 'a chair' })), 'text');
  assert.equal(resolveOp(normalizeRequest({ imageUrl: 'https://x/1.png' })), 'image');
  assert.equal(resolveOp(normalizeRequest({ taskId: 't1' })), 'status');
  assert.equal(resolveOp(normalizeRequest({ taskId: 't1', refine: true })), 'refine');
  // taskId manda sobre prompt (consulta, no crea otra tarea)
  assert.equal(resolveOp(normalizeRequest({ taskId: 't1', prompt: 'a chair' })), 'status');
  assert.throws(() => resolveOp(normalizeRequest({})), /missing input/);
  assert.throws(() => resolveOp(normalizeRequest({ refine: true })), /missing 'taskId'/);
});

test('priceFor: precio por operación y calidad; floor para requests inválidas', () => {
  assert.equal(priceFor({ prompt: 'a chair' }), PRICE_TEXT_USDC);
  assert.equal(priceFor({ prompt: 'a chair', quality: 'high' }), PRICE_TEXT_HIGH_USDC);
  assert.equal(priceFor({ taskId: 't1', refine: true }), PRICE_REFINE_USDC);
  assert.equal(priceFor({ imageUrl: 'https://x/1.png' }), PRICE_IMAGE_USDC);
  assert.equal(priceFor({ imageUrl: 'https://x/1.png', quality: 'high' }), PRICE_IMAGE_HIGH_USDC);
  assert.equal(priceFor({ taskId: 't1' }), PRICE_STATUS_USDC);
  assert.equal(priceFor({}), PRICE_STATUS_USDC);
  assert.equal(priceFor(undefined), PRICE_STATUS_USDC);
});

// ─── 2. buildCreate ───────────────────────────────────────────────────────────

test('buildCreate: bodies de texto, refine e imagen', () => {
  const t = buildCreate(normalizeRequest({ prompt: 'a chair', style: 'sculpture' }), 'text');
  assert.equal(t.path, '/openapi/v2/text-to-3d');
  assert.equal(t.kind, 'text');
  assert.deepEqual(t.body, {
    mode: 'preview',
    prompt: 'a chair',
    ai_model: MODEL_STANDARD,
    art_style: 'sculpture',
    target_formats: ['glb'],
  });
  assert.equal(buildCreate(normalizeRequest({ prompt: 'x', quality: 'high' }), 'text').body.ai_model, MODEL_HIGH);
  assert.throws(() => buildCreate(normalizeRequest({ prompt: 'x'.repeat(801) }), 'text'), /800/);

  const r = buildCreate(normalizeRequest({ taskId: 'p1', refine: true, texturePrompt: 'red metal' }), 'refine');
  assert.deepEqual(r.body, { mode: 'refine', preview_task_id: 'p1', texture_prompt: 'red metal', target_formats: ['glb'] });

  const i = buildCreate(normalizeRequest({ imageUrl: 'https://x/1.png', formats: ['glb', 'fbx'] }), 'image');
  assert.equal(i.path, '/openapi/v1/image-to-3d');
  assert.equal(i.kind, 'image');
  assert.deepEqual(i.body, {
    image_url: 'https://x/1.png',
    ai_model: MODEL_STANDARD,
    should_texture: true,
    texture_resolution: '2048',
    target_formats: ['glb', 'fbx'],
  });
});

test('mapTask: estados, etapa y pista para el asistente', () => {
  const running = mapTask({ id: 't1', type: 'text-to-3d-preview', status: 'IN_PROGRESS', progress: 40 }, 'text');
  assert.equal(running.done, false);
  assert.equal(running.stage, 'preview');
  assert.match(running.next, /Still generating \(40%\)/);
  assert.equal(running.modelUrls, undefined);

  const ok = mapTask(
    {
      id: 't2',
      type: 'text-to-3d-refine',
      status: 'SUCCEEDED',
      progress: 100,
      model_urls: { glb: 'https://a/m.glb', fbx: '' },
      thumbnail_url: 'https://a/p.png',
      consumed_credits: 10,
      task_error: { message: '' },
    },
    'text',
  );
  assert.equal(ok.done, true);
  assert.equal(ok.stage, 'refine');
  assert.deepEqual(ok.modelUrls, { glb: 'https://a/m.glb' });
  assert.equal(ok.thumbnailUrl, 'https://a/p.png');
  assert.equal(ok.consumedCredits, 10);
  assert.equal(ok.error, undefined);

  const failed = mapTask({ id: 't3', status: 'FAILED', task_error: { message: 'nsfw' } }, 'image');
  assert.equal(failed.done, true);
  assert.equal(failed.stage, 'image');
  assert.equal(failed.error, 'nsfw');
  assert.match(failed.next, /FAILED: nsfw/);
});

// ─── 3. generate contra un Meshy falso ────────────────────────────────────────

interface FakeMeshy {
  config: MeshyConfig;
  seen: Array<{ method: string; path: string; auth?: string; body: unknown }>;
  close: () => Promise<void>;
}

/** Meshy falso: crea tareas y las hace progresar una lectura por vez hasta SUCCEEDED. */
function startFakeMeshy(opts: { statusOnCreate?: number } = {}): Promise<FakeMeshy> {
  const seen: FakeMeshy['seen'] = [];
  const tasks = new Map<string, { kind: 'text' | 'image'; reads: number }>();
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'POST') {
        if (opts.statusOnCreate) return send(opts.statusOnCreate, { message: 'nope' });
        const id = `task-${++n}`;
        tasks.set(id, { kind: req.url!.includes('image-to-3d') ? 'image' : 'text', reads: 0 });
        return send(200, { result: id });
      }
      const m = /\/openapi\/v[12]\/(text-to-3d|image-to-3d)\/([^/?]+)/.exec(req.url!);
      const task = m ? tasks.get(m[2]) : undefined;
      const kind = m?.[1] === 'image-to-3d' ? 'image' : 'text';
      if (!task || task.kind !== kind) return send(404, { message: 'not found' });
      task.reads += 1;
      if (task.reads < 2) return send(200, { id: m![2], status: 'IN_PROGRESS', progress: 50 });
      return send(200, {
        id: m![2],
        type: kind === 'text' ? 'text-to-3d-preview' : undefined,
        status: 'SUCCEEDED',
        progress: 100,
        model_urls: { glb: 'https://assets/m.glb' },
        thumbnail_url: 'https://assets/p.png',
        task_error: { message: '' },
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        seen,
        config: {
          apiKey: 'msy_test',
          baseUrl: `http://127.0.0.1:${port}`,
          timeoutMs: 2_000,
          waitCreateMs: 2_000,
          waitStatusMs: 2_000,
          pollMs: 10,
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('generate: crea desde texto y hace long-poll hasta SUCCEEDED', async () => {
  const fake = await startFakeMeshy();
  try {
    const out = await generate(fake.config, { prompt: 'a chair' });
    assert.equal(out.taskId, 'task-1');
    assert.equal(out.kind, 'text');
    assert.equal(out.status, 'SUCCEEDED');
    assert.equal(out.done, true);
    assert.deepEqual(out.modelUrls, { glb: 'https://assets/m.glb' });
    assert.equal(fake.seen[0].method, 'POST');
    assert.equal(fake.seen[0].path, '/openapi/v2/text-to-3d');
    assert.equal(fake.seen[0].auth, 'Bearer msy_test');
    assert.equal((fake.seen[0].body as { mode: string }).mode, 'preview');
  } finally {
    await fake.close();
  }
});

test('generate: consulta por taskId sin saber el tipo (texto 404 → imagen)', async () => {
  const fake = await startFakeMeshy();
  try {
    const created = await generate(fake.config, { imageUrl: 'https://x/1.png' });
    assert.equal(created.kind, 'image');
    const status = await generate(fake.config, { taskId: created.taskId });
    assert.equal(status.kind, 'image');
    assert.equal(status.status, 'SUCCEEDED');
    const paths = fake.seen.map((s) => s.path);
    assert.ok(paths.some((p) => p.startsWith('/openapi/v2/text-to-3d/task-1')), 'probó texto primero');
    assert.ok(paths.some((p) => p.startsWith('/openapi/v1/image-to-3d/task-1')), 'luego imagen');
  } finally {
    await fake.close();
  }
});

test('generate: errores legibles (taskId inexistente, 401, 402, sin key)', async () => {
  const fake = await startFakeMeshy();
  try {
    await assert.rejects(generate(fake.config, { taskId: 'nope' }), /not found/);
    await assert.rejects(generate({ ...fake.config, apiKey: '' }, { prompt: 'x' }), /MESHY_API_KEY/);
  } finally {
    await fake.close();
  }
  const unauth = await startFakeMeshy({ statusOnCreate: 401 });
  try {
    await assert.rejects(generate(unauth.config, { prompt: 'x' }), /401/);
  } finally {
    await unauth.close();
  }
  const broke = await startFakeMeshy({ statusOnCreate: 402 });
  try {
    await assert.rejects(generate(broke.config, { prompt: 'x' }), /credits/);
  } finally {
    await broke.close();
  }
});
