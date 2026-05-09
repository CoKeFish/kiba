/**
 * Embeddings semánticos con @xenova/transformers (corre en proceso, sin servidor).
 * Modelo: Xenova/all-MiniLM-L6-v2 — 384 dim, ~22MB, gratis, sin API key.
 *
 * El modelo se descarga la primera vez y se cachea en TRANSFORMERS_CACHE.
 * Si falla (sin red, librería rota, env desactivado), todo el módulo entra en modo "disabled"
 * y el caller debe asumir que solo hay keyword search.
 */

let _enabled = process.env.SEMANTIC_SEARCH !== 'false';
let _ready = false;
let _loading: Promise<void> | null = null;
let _extractor: any = null;
let _loadError: string | null = null;

async function loadModel(): Promise<void> {
  if (_ready || !_enabled) return;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      // Solo modelos remotos (Hugging Face Hub); en producción podríamos cachear localmente
      env.allowLocalModels = false;
      _extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      _ready = true;
      console.log('[embeddings] modelo cargado: all-MiniLM-L6-v2 (384 dim)');
    } catch (err) {
      _loadError = (err as Error).message;
      _enabled = false;
      console.warn('[embeddings] no disponible:', _loadError);
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

/** Lanza la carga sin bloquear. Llamar al arrancar el server. */
export function warmup(): void {
  if (!_enabled) return;
  void loadModel();
}

export function isEnabled(): boolean {
  return _enabled;
}

export function isReady(): boolean {
  return _ready;
}

export function status(): { enabled: boolean; ready: boolean; error: string | null } {
  return { enabled: _enabled, ready: _ready, error: _loadError };
}

/**
 * Devuelve embedding normalizado (norma L2 = 1) o null si no está disponible.
 * El normalize=true permite usar dot product directamente como cosine similarity.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  if (!_enabled) return null;
  if (!_ready) await loadModel();
  if (!_ready) return null;
  const output = await _extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Cosine similarity entre dos vectores. Si ambos están normalizados (norma 1),
 * es equivalente al dot product. Validamos por si acaso para no asumir.
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSim: dimensiones distintas (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Para tests: forzar el estado interno (no usar en runtime) */
export function _resetForTests(opts: { enabled?: boolean; ready?: boolean } = {}): void {
  _enabled = opts.enabled ?? false;
  _ready = opts.ready ?? false;
  _loading = null;
  _extractor = null;
  _loadError = null;
}
