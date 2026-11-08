/**
 * Cliente del gateway de Kiba para que un SERVICIO pague a otros desde su propio código.
 *
 * Un servicio que corre con `AgentProvider` recibe en su handler un `ctx.kiba` construido con
 * esta clase: con él llama a cualquier servicio del catálogo (`call`) o a cualquier API que cobre
 * con x402 estándar (`callUrl`), y paga con el saldo de su publicador en Kiba. El gateway liga
 * esos pagos a la llamada del usuario que los originó (cabecera `X-Kiba-Parent-Call`), así el
 * usuario ve la cascada completa: lo que pagó él y lo que el servicio pagó a sus proveedores,
 * cada pago con su transacción en Stellar.
 *
 * Configuración: `gateway: { url, apiKey }` en el `AgentConfig`, o las variables `KIBA_URL` y
 * `KIBA_API_KEY` (las mismas que usa el conector `kiba-mcp`).
 */
import { BASE_UNITS_PER_TOKEN } from './config';
import { ConfigError } from './errors';

/** Gateway público de Kiba. */
export const DEFAULT_GATEWAY_URL = 'https://api.kiba.tools';
/** Cabecera con la que un servicio liga sus pagos a la llamada del usuario que los originó. */
export const PARENT_CALL_HEADER = 'X-Kiba-Parent-Call';
/** Cabecera con la que el gateway le dice al servicio el id de la llamada que está sirviendo. */
export const CALL_ID_HEADER = 'X-Kiba-Call-Id';

export interface KibaGatewayConfig {
  /** URL del gateway (default `KIBA_URL` o https://api.kiba.tools). */
  url?: string;
  /** Clave de API de la cuenta que paga (default `KIBA_API_KEY`). */
  apiKey?: string;
  /** Llamada padre: el gateway une a ella los pagos hechos con este cliente. */
  parentCallId?: string;
  /** Tiempo máximo por llamada, en ms, incluidos los sondeos de un resultado pendiente (default 10 min). */
  timeoutMs?: number;
  /** `fetch` a usar (tests). */
  fetch?: typeof fetch;
}

export interface GatewayCost {
  /** Unidades base del activo (stroops: 1 USDC = 1e7). */
  baseUnits: number;
  usd: number;
}

export interface GatewayCallResult<T = unknown> {
  /** La respuesta del servicio. */
  result: T;
  /** Id del resultado guardado en la cuenta del pagador. */
  resultId: string;
  resultUrl?: string;
  /** Lo que costó esta llamada. */
  cost: GatewayCost;
  /** Transacción en Stellar de este pago, cuando ya confirmó. */
  explorerUrl?: string;
}

export interface GatewayUrlOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Precio máximo autorizado para esta llamada, en USD. */
  maxUsd?: number;
}

export interface GatewayUrlResult<T = unknown> {
  result: T;
  /** Código HTTP que devolvió la API. */
  status: number;
  /** false si la URL no cobró. */
  paid: boolean;
  cost: GatewayCost;
  resultId?: string;
  payTo?: string;
  network?: string;
  txHash?: string;
  explorerUrl?: string;
}

/** Error devuelto por el gateway (HTTP ≠ 2xx) o fallo del servicio llamado. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly resultId?: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class KibaGateway {
  readonly url: string;
  /** Llamada del usuario a la que se unen los pagos hechos con este cliente. */
  readonly parentCallId?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(cfg: KibaGatewayConfig = {}) {
    this.url = (cfg.url ?? process.env.KIBA_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
    this.apiKey = cfg.apiKey ?? process.env.KIBA_API_KEY ?? undefined;
    this.parentCallId = cfg.parentCallId;
    this.timeoutMs = cfg.timeoutMs ?? 600_000;
    this.fetchFn = cfg.fetch ?? globalThis.fetch;
  }

  /** true si hay clave de API (sin ella, `call` y `callUrl` lanzan ConfigError). */
  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /** El mismo cliente ligado a una llamada padre. */
  forCall(parentCallId?: string): KibaGateway {
    return new KibaGateway({
      url: this.url,
      apiKey: this.apiKey,
      parentCallId,
      timeoutMs: this.timeoutMs,
      fetch: this.fetchFn,
    });
  }

  /**
   * Llama a un servicio del catálogo de Kiba y lo paga. Si el servicio tarda más que `waitMs`,
   * sigue esperando el resultado guardado hasta `timeoutMs`.
   */
  async call<T = unknown>(
    service: string,
    payload: unknown,
    opts: { waitMs?: number } = {},
  ): Promise<GatewayCallResult<T>> {
    const deadline = Date.now() + this.timeoutMs;
    const first = await this.request<Record<string, unknown>>('POST', '/v1/call', {
      service,
      payload: payload ?? {},
      waitMs: opts.waitMs ?? 40_000,
    });
    if (first.status === 'pending') return this.awaitResult<T>(String(first.resultId), deadline);
    return normalizeCall<T>(first);
  }

  /** Paga una API externa que cobra con x402 estándar en Stellar (o la llama gratis si no cobra). */
  async callUrl<T = unknown>(url: string, opts: GatewayUrlOptions = {}): Promise<GatewayUrlResult<T>> {
    const out = await this.request<Record<string, unknown>>('POST', '/v1/x402/call', {
      url,
      method: opts.method,
      body: opts.body,
      headers: opts.headers,
      maxUsd: opts.maxUsd,
    });
    return {
      result: out.result as T,
      status: Number(out.status ?? 200),
      paid: Boolean(out.paid),
      cost: normalizeCost(out.cost),
      resultId: optString(out.resultId),
      payTo: optString(out.payTo),
      network: optString(out.network),
      txHash: optString(out.txHash),
      explorerUrl: optString(out.explorerUrl),
    };
  }

  /** Saldo en USD con el que paga este cliente. */
  async balanceUsd(): Promise<number> {
    const b = await this.request<{ total_usd?: number; balance_usd?: number }>('GET', '/v1/balance');
    return Number(b.total_usd ?? b.balance_usd ?? 0);
  }

  private async awaitResult<T>(id: string, deadline: number): Promise<GatewayCallResult<T>> {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new GatewayError(`el servicio no terminó a tiempo (resultId ${id})`, undefined, id);
      const row = await this.request<Record<string, unknown>>(
        'GET',
        `/v1/results/${encodeURIComponent(id)}?waitMs=${Math.min(25_000, remaining)}`,
      );
      if (row.status === 'done') return normalizeCall<T>(row);
      if (row.status === 'error') throw new GatewayError(String(row.error ?? 'el servicio falló'), undefined, id);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new ConfigError(
        'Falta la clave de API de Kiba con la que paga este servicio: pasa `gateway.apiKey` al AgentProvider o define KIBA_API_KEY.',
      );
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.parentCallId) headers[PARENT_CALL_HEADER] = this.parentCallId;
    const res = await this.fetchFn(`${this.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text };
    }
    if (!res.ok) {
      const msg = (json as { error?: unknown } | null)?.error;
      throw new GatewayError(typeof msg === 'string' ? msg : `gateway respondió ${res.status}`, res.status);
    }
    return json as T;
  }
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function normalizeCost(cost: unknown): GatewayCost {
  const c = (cost ?? {}) as { lamports?: number; baseUnits?: number; usd?: number };
  const baseUnits = Number(c.baseUnits ?? c.lamports ?? 0);
  const usd = typeof c.usd === 'number' ? c.usd : baseUnits / BASE_UNITS_PER_TOKEN;
  return { baseUnits, usd };
}

/** Una respuesta de POST /v1/call (hecha en línea) o un resultado guardado (GET /v1/results/:id). */
function normalizeCall<T>(o: Record<string, unknown>): GatewayCallResult<T> {
  const cost =
    o.cost !== undefined
      ? normalizeCost(o.cost)
      : normalizeCost({ baseUnits: typeof o.costBaseUnits === 'number' ? o.costBaseUnits : 0 });
  return {
    result: o.result as T,
    resultId: String(o.resultId ?? ''),
    resultUrl: optString(o.resultUrl),
    cost,
    explorerUrl: optString(o.explorerUrl),
  };
}
