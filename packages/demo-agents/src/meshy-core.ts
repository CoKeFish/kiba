/**
 * meshy-core — lógica del wrapper de Meshy (generación de modelos 3D), SIN dependencias
 * del SDK ni de express y SIN efectos de arranque (no abre puertos, no lee env al importar).
 *
 * Igual que firecrawl-core: aquí vive toda la superficie "real" del agente (normalización
 * del request, pricing, llamadas HTTP y mapeo de la respuesta) para testearla de forma
 * determinista (test/meshy.test.ts) y auditarla de un vistazo. meshy.ts arma la config
 * desde el entorno y delega en {@link generate}.
 *
 * Meshy es ASÍNCRONO: crear una tarea devuelve un id y el modelo tarda desde ~30 s hasta
 * varios minutos. Una llamada de Kiba es síncrona (el gateway espera ≤120 s), así que el
 * servicio funciona en dos pasos:
 *   1. crear  — { prompt } | { imageUrl } | { refine: true, taskId } → crea la tarea y espera
 *      hasta waitCreateMs por si termina rápido; si no, devuelve { taskId, status, progress }.
 *   2. consultar — { taskId } → long-poll hasta waitStatusMs y devuelve progreso o las URLs
 *      del modelo (GLB/FBX/OBJ…) y la miniatura cuando está listo.
 */

export type MeshyOp = 'text' | 'image' | 'refine' | 'status';
export type MeshyKind = 'text' | 'image';
export type MeshyQuality = 'standard' | 'high';

export interface MeshyRequest {
  /** Descripción del objeto a generar (sinónimos: text, description, query, object). */
  prompt?: string;
  /** URL pública (o data URI) de una imagen → modelo 3D texturizado (sinónimos: image_url, image, url). */
  imageUrl?: string;
  /** Id de una tarea ya creada → consulta su estado/resultado (sinónimos: task_id, task, id). */
  taskId?: string;
  /** true + taskId de un preview terminado → aplica texturas (sinónimo: texture). */
  refine?: boolean;
  /** 'standard' (meshy-6-lite, barato) | 'high' (meshy-7.1, más detalle y más caro). */
  quality?: MeshyQuality;
  /** Estilo artístico del texto a 3D: 'realistic' | 'sculpture'. */
  artStyle?: string;
  /** Prompt extra para guiar las texturas en el refine. */
  texturePrompt?: string;
  /** Tipo de tarea al consultar ('text' | 'image'); si falta se prueban ambos. */
  kind?: MeshyKind;
  /** Formatos de salida (default ['glb']; menos formatos = tarea más rápida). */
  formats?: string[] | string;
}

export interface MeshyResult {
  taskId: string;
  kind: MeshyKind;
  stage: 'preview' | 'refine' | 'image';
  /** PENDING | IN_PROGRESS | SUCCEEDED | FAILED | EXPIRED | CANCELED */
  status: string;
  progress: number;
  /** true cuando la tarea ya no va a cambiar (SUCCEEDED/FAILED/EXPIRED/CANCELED). */
  done: boolean;
  /** URLs de descarga por formato (glb, fbx, obj, usdz…), firmadas y temporales. Solo si SUCCEEDED. */
  modelUrls?: Record<string, string>;
  thumbnailUrl?: string;
  textureUrls?: unknown;
  error?: string;
  consumedCredits?: number;
  /** Qué hacer a continuación (pensado para el asistente que llama). */
  next: string;
}

/** Config de runtime del wrapper (la arma meshy.ts desde el entorno). */
export interface MeshyConfig {
  /** API key de Meshy (REQUERIDA; sin ella la API responde 401). */
  apiKey: string;
  /** Base URL de la API (default https://api.meshy.ai). */
  baseUrl: string;
  /** Timeout por request HTTP en ms. */
  timeoutMs: number;
  /** Cuánto esperar tras crear una tarea por si termina rápido (ms). */
  waitCreateMs: number;
  /** Cuánto esperar en una consulta de estado antes de devolver el progreso (ms). */
  waitStatusMs: number;
  /** Intervalo entre consultas a Meshy durante la espera (ms). */
  pollMs: number;
}

// Pricing dinámico (USDC). Referencia: Meshy cobra créditos por tarea (≈0.02 USD/crédito en
// el plan Pro); el precio de Kiba = créditos × 0.02 + margen. Consultar estado es casi gratis.
//   - consultar estado         → 0.0005 (floor on-chain)
//   - texto → 3D (preview)      → 0.12 standard (meshy-6-lite, 5 cr) · 0.45 high (meshy-7.1, 20 cr)
//   - refine (texturas)         → 0.25 (10 cr)
//   - imagen → 3D con textura   → 0.35 standard (15 cr) · 0.65 high (30 cr)
export const PRICE_STATUS_USDC = 0.0005;
export const PRICE_TEXT_USDC = 0.12;
export const PRICE_TEXT_HIGH_USDC = 0.45;
export const PRICE_REFINE_USDC = 0.25;
export const PRICE_IMAGE_USDC = 0.35;
export const PRICE_IMAGE_HIGH_USDC = 0.65;

export const MODEL_STANDARD = 'meshy-6-lite';
export const MODEL_HIGH = 'meshy-7.1';

const DONE_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELED']);

/** Request normalizado: los LLMs adivinan los nombres de campo, así que aceptamos sinónimos. */
export interface NormalizedRequest {
  prompt: string;
  imageUrl: string;
  taskId: string;
  refine: boolean;
  quality: MeshyQuality;
  artStyle?: string;
  texturePrompt?: string;
  kind?: MeshyKind;
  formats: string[];
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'si' || s === 'sí';
}

export function normalizeFormats(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((f) => str(f).toLowerCase())
    : str(raw)
        .split(',')
        .map((f) => f.toLowerCase().trim());
  const allowed = new Set(['glb', 'fbx', 'obj', 'usdz', 'stl', 'mtl', 'gltf', '3mf']);
  return list.filter((f) => allowed.has(f));
}

export function normalizeRequest(req: unknown): NormalizedRequest {
  const r = (req ?? {}) as Record<string, unknown>;
  const qualityRaw = str(r.quality ?? r.model ?? r.ai_model ?? r.aiModel).toLowerCase();
  const quality: MeshyQuality =
    qualityRaw === 'high' || qualityRaw === 'hd' || qualityRaw === 'latest' || qualityRaw.startsWith('meshy-7')
      ? 'high'
      : 'standard';
  const stage = str(r.stage ?? r.mode).toLowerCase();
  const kindRaw = str(r.kind).toLowerCase();
  const formats = normalizeFormats(r.formats ?? r.format ?? r.target_formats);
  return {
    prompt: str(r.prompt ?? r.text ?? r.description ?? r.query ?? r.object),
    imageUrl: str(r.imageUrl ?? r.image_url ?? r.image ?? r.url ?? r.link),
    taskId: str(r.taskId ?? r.task_id ?? r.task ?? r.id ?? r.previewTaskId ?? r.preview_task_id),
    refine: truthy(r.refine) || truthy(r.texture) || stage === 'refine',
    quality,
    artStyle: str(r.artStyle ?? r.art_style ?? r.style) || undefined,
    texturePrompt: str(r.texturePrompt ?? r.texture_prompt) || undefined,
    kind: kindRaw === 'image' ? 'image' : kindRaw === 'text' ? 'text' : undefined,
    formats: formats.length > 0 ? formats : ['glb'],
  };
}

/** Qué operación pide la request. Lanza si falta la entrada mínima. */
export function resolveOp(n: NormalizedRequest): MeshyOp {
  if (n.refine) {
    if (!n.taskId) throw new Error("missing 'taskId' — refine needs the id of a finished preview task");
    return 'refine';
  }
  if (n.taskId) return 'status';
  if (n.imageUrl) return 'image';
  if (n.prompt) return 'text';
  throw new Error(
    "missing input — pass { prompt } to generate from text, { imageUrl } from an image, " +
      "{ taskId } to check a task, or { refine: true, taskId } to add textures",
  );
}

/** Precio (USDC) para esta request. Determinista en el payload (el 402 y el cobro deben coincidir). */
export function priceFor(req: unknown): number {
  let n: NormalizedRequest;
  let op: MeshyOp;
  try {
    n = normalizeRequest(req);
    op = resolveOp(n);
  } catch {
    return PRICE_STATUS_USDC; // request inválida: el handler la rechaza; cobramos el floor
  }
  switch (op) {
    case 'text':
      return n.quality === 'high' ? PRICE_TEXT_HIGH_USDC : PRICE_TEXT_USDC;
    case 'refine':
      return PRICE_REFINE_USDC;
    case 'image':
      return n.quality === 'high' ? PRICE_IMAGE_HIGH_USDC : PRICE_IMAGE_USDC;
    default:
      return PRICE_STATUS_USDC;
  }
}

/** Construye la llamada de creación para Meshy según la operación. */
export function buildCreate(
  n: NormalizedRequest,
  op: Exclude<MeshyOp, 'status'>,
): { path: string; body: Record<string, unknown>; kind: MeshyKind } {
  const aiModel = n.quality === 'high' ? MODEL_HIGH : MODEL_STANDARD;
  if (op === 'text') {
    if (n.prompt.length > 800) throw new Error('prompt too long — Meshy accepts up to 800 characters');
    return {
      path: '/openapi/v2/text-to-3d',
      kind: 'text',
      body: {
        mode: 'preview',
        prompt: n.prompt,
        ai_model: aiModel,
        ...(n.artStyle ? { art_style: n.artStyle } : {}),
        target_formats: n.formats,
      },
    };
  }
  if (op === 'refine') {
    return {
      path: '/openapi/v2/text-to-3d',
      kind: 'text',
      body: {
        mode: 'refine',
        preview_task_id: n.taskId,
        ...(n.texturePrompt ? { texture_prompt: n.texturePrompt } : {}),
        target_formats: n.formats,
      },
    };
  }
  return {
    path: '/openapi/v1/image-to-3d',
    kind: 'image',
    body: {
      image_url: n.imageUrl,
      ai_model: aiModel,
      should_texture: true,
      texture_resolution: '2048',
      target_formats: n.formats,
    },
  };
}

/** Llamada HTTP a Meshy con auth, timeout y mapeo de errores legibles. */
export async function meshyFetch(
  config: MeshyConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(config.baseUrl.replace(/\/+$/, '') + path, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (res.status === 401) throw new Error('Meshy rejected the API key (401) — check MESHY_API_KEY');
    if (res.status === 402) throw new Error('Meshy account has no credits left (402)');
    if (res.status === 429) throw new Error('Meshy rate limit reached (429) — retry in a few seconds');
    if (res.status >= 400 && res.status !== 404) {
      const msg = (json?.message as string) ?? text.slice(0, 200);
      throw new Error(`Meshy error ${res.status}: ${msg}`);
    }
    return { status: res.status, json };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Meshy did not answer within ${config.timeoutMs} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function taskPath(kind: MeshyKind, taskId: string): string {
  return kind === 'image'
    ? `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`
    : `/openapi/v2/text-to-3d/${encodeURIComponent(taskId)}`;
}

/** Lee una tarea. Si no se sabe el tipo, prueba texto y luego imagen (404 = no es de ese tipo). */
export async function getTask(
  config: MeshyConfig,
  taskId: string,
  kindHint?: MeshyKind,
): Promise<{ raw: Record<string, unknown>; kind: MeshyKind }> {
  const order: MeshyKind[] = kindHint === 'image' ? ['image', 'text'] : ['text', 'image'];
  for (const kind of order) {
    const { status, json } = await meshyFetch(config, taskPath(kind, taskId));
    if (status === 200 && json) return { raw: json, kind };
  }
  throw new Error(`Meshy task '${taskId}' not found — check the taskId`);
}

/** Mapea el objeto de tarea de Meshy a la respuesta del servicio. */
export function mapTask(raw: Record<string, unknown>, kind: MeshyKind): MeshyResult {
  const status = String(raw.status ?? 'PENDING');
  const type = String(raw.type ?? '');
  const stage: MeshyResult['stage'] =
    kind === 'image' ? 'image' : type.includes('refine') ? 'refine' : 'preview';
  const done = DONE_STATUSES.has(status);
  const progress = Number(raw.progress ?? 0) || 0;
  const taskId = String(raw.id ?? '');
  const error = (raw.task_error as { message?: string } | undefined)?.message || undefined;

  let next: string;
  if (status === 'SUCCEEDED') {
    next =
      stage === 'preview'
        ? 'Mesh ready (no textures yet): download it from modelUrls (GLB) or call again with { refine: true, taskId } to add textures.'
        : 'Model ready: download it from modelUrls (GLB/FBX/OBJ) and show thumbnailUrl to the user. Links expire, download soon.';
  } else if (done) {
    next = `Task ended with ${status}${error ? `: ${error}` : ''}. Create a new task if needed.`;
  } else {
    next = `Still generating (${progress}%). Call again with { taskId: "${taskId}", kind: "${kind}" } in ~30 s.`;
  }

  const modelUrls = (raw.model_urls as Record<string, string> | undefined) ?? undefined;
  return {
    taskId,
    kind,
    stage,
    status,
    progress,
    done,
    ...(status === 'SUCCEEDED' && modelUrls
      ? {
          modelUrls: Object.fromEntries(Object.entries(modelUrls).filter(([, v]) => Boolean(v))),
          thumbnailUrl: (raw.thumbnail_url as string) || undefined,
          textureUrls: raw.texture_urls,
        }
      : {}),
    ...(error ? { error } : {}),
    ...(raw.consumed_credits !== undefined ? { consumedCredits: Number(raw.consumed_credits) } : {}),
    next,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Long-poll: consulta la tarea hasta que termine o se agote maxWaitMs. */
export async function waitForTask(
  config: MeshyConfig,
  taskId: string,
  kind: MeshyKind,
  maxWaitMs: number,
): Promise<MeshyResult> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const { raw } = await getTask(config, taskId, kind);
    const result = mapTask(raw, kind);
    if (result.done || Date.now() >= deadline) return result;
    await sleep(Math.min(config.pollMs, Math.max(0, deadline - Date.now())));
  }
}

/** Handler completo del servicio: crea o consulta según la request. */
export async function generate(config: MeshyConfig, req: unknown): Promise<MeshyResult> {
  if (!config.apiKey) throw new Error('MESHY_API_KEY is not configured on this service');
  const n = normalizeRequest(req);
  const op = resolveOp(n);

  if (op === 'status') {
    const { raw, kind } = await getTask(config, n.taskId, n.kind);
    const first = mapTask(raw, kind);
    if (first.done) return first;
    return waitForTask(config, n.taskId, kind, config.waitStatusMs);
  }

  const { path, body, kind } = buildCreate(n, op);
  const { json } = await meshyFetch(config, path, { method: 'POST', body });
  const taskId = str(json?.result);
  if (!taskId) throw new Error('Meshy did not return a task id');
  return waitForTask(config, taskId, kind, config.waitCreateMs);
}
