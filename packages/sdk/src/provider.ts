/**
 * AgentProvider — for agents that OFFER a paid service.
 *
 *   const agent = new AgentProvider({ wallet, service, pricePerCall, contractId, network });
 *   agent.serve(async (req) => ({ ... }));
 *   await agent.bootstrap();   // fund if needed + register on-chain
 *   await agent.listen(5001);  // optional: mount the built-in express server
 *
 * Two ways to get paid, both verified before the handler runs:
 *   1. Platform-signed calls (fast, off-chain): the marketplace platform signs each
 *      call with its private key; the provider verifies against `platform.publicKey`
 *      (no shared secret) and the payment is settled in batches off-band.
 *   2. x402 escrow (trustless, on-chain): the caller funds a Trustless Work escrow
 *      naming THIS agent as receiver; the provider verifies the binding + funding,
 *      serves once, then releases.
 *
 * The core logic lives in {@link AgentProvider.verifyAndServe}, which is framework
 * agnostic ((body, headers) → {status, body}). The built-in express server just
 * adapts to it; `listen()` is optional — mount `verifyAndServe` in any framework.
 */
import type { Express, Request, Response } from 'express';
import type { AgentConfig, ProviderHandler } from './types';
import { createChainClient, walletToSigner, type ChainClient } from './chain';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import { BASE_UNITS_PER_TOKEN, DEFAULT_ASSET } from './config';
import { ConfigError } from './errors';
import {
  verifyPlatformCall,
  ReplayGuard,
  PLATFORM_CERT_HEADER,
  PLATFORM_SIGNATURE_HEADER,
} from './platform-auth';

/** Result of the framework-agnostic verify+serve entry point. */
export interface ServeResult {
  status: number;
  body: unknown;
}

/** Input to {@link AgentProvider.verifyAndServe}. */
export interface ServeInput {
  /** Parsed request body. */
  body: unknown;
  /** Request headers (case-insensitive). */
  headers: Record<string, string | string[] | undefined>;
  /** Exact request body bytes — used to bind platform-auth signatures. Falls back to
   *  re-serializing `body` when omitted (must match how the caller serialized it). */
  rawBody?: Uint8Array | string;
  /** Caller IP, for rate-limiting the unpaid (402) path. */
  ip?: string;
}

export class AgentProvider {
  readonly config: AgentConfig;
  /** null if no chain is configured — the agent only serves with `allowUnverified`. */
  readonly chain: ChainClient | null;

  private _app?: Express;
  private handler: ProviderHandler | null = null;
  private readonly ownerAddress: string;
  private readonly platformPublicKey?: string;
  private readonly platformMaxSkewSec?: number;
  private readonly platformReplay = new ReplayGuard();

  /** nonce → quoted amount, so the post-payment check reuses the quote (priceFn runs once). */
  private readonly quoteCache = new Map<string, { amount: bigint; exp: number }>();
  /** Per-IP counter for the unpaid 402 path (anti-DoS on priceFn compute). */
  private readonly rate = new Map<string, { count: number; windowStart: number }>();
  /** escrowId → consumedAt (unix sec). Serves each funded escrow at most once. */
  private readonly consumedEscrows = new Map<string, number>();
  /** escrowIds currently being served (between funding check and response). */
  private readonly inFlightEscrows = new Set<string>();

  constructor(config: AgentConfig) {
    this.config = config;
    this.chain = config.chainClient ?? createChainClient({
      network: config.network,
      contractId: config.contractId,
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      horizonUrl: config.horizonUrl,
      friendbotUrl: config.friendbotUrl,
      asset: config.asset,
      assetIssuer: config.assetIssuer,
      trustlessWork: config.trustlessWork,
      wallet: config.wallet,
      signer: config.signer,
      secret: config.secret,
      label: config.service,
    });
    this.ownerAddress = this.resolveOwnerAddress();
    this.platformPublicKey = config.platform?.publicKey;
    this.platformMaxSkewSec = config.platform?.maxClockSkewSec;
  }

  /**
   * The built-in express app, built lazily on first access. Optional to use — call
   * `listen()`, or mount {@link verifyAndServe} in any framework and never touch this.
   * Requires `express` to be installed (it is an optional peer dependency).
   */
  get app(): Express {
    if (!this._app) this._app = this.buildApp();
    return this._app;
  }

  serve<TReq, TRes>(handler: ProviderHandler<TReq, TRes>): this {
    this.handler = handler as ProviderHandler;
    return this;
  }

  /** Base units per token of the active asset (stroops). */
  private get baseUnitsPerToken(): number {
    return this.chain?.baseUnitsPerToken ?? BASE_UNITS_PER_TOKEN;
  }

  /** Settlement asset symbol. */
  private get asset(): 'USDC' | 'XLM' {
    return this.chain?.asset ?? DEFAULT_ASSET;
  }

  private resolveOwnerAddress(): string {
    if (this.chain) return this.chain.ownerAddress;
    if (this.config.signer) return this.config.signer.publicKey();
    if (this.config.secret) return StellarKeypair.fromSecret(this.config.secret).publicKey();
    if (this.config.wallet) return walletToSigner(this.config.wallet).publicKey();
    return 'unknown';
  }

  // ─── built-in express server (optional) ─────────────────────

  private buildApp(): Express {
    let express: typeof import('express');
    try {
      // Lazy + optional: only consumers that use the built-in server need express.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      express = require('express');
    } catch {
      throw new ConfigError(
        "the built-in HTTP server requires 'express'. Install it (npm i express), " +
          'or mount verifyAndServe() in your own framework instead of using app/listen().',
      );
    }
    const app = express();
    const limit = this.config.bodyLimit ?? '256kb';
    // Capture the exact bytes so platform-auth can bind to the literal payload.
    app.use(
      express.json({
        limit,
        verify: (req, _res, buf) => {
          (req as Request & { rawBody?: Buffer }).rawBody = buf;
        },
      }),
    );

    app.post('/service', (req, res) => void this.handleExpress(req, res));

    app.get('/manifest', (_req, res) => {
      res.json(this.manifest());
    });

    app.get('/health', (_req, res) => {
      res.json({ ok: true, service: this.config.service });
    });

    return app;
  }

  /** The service manifest (also served at GET /manifest). */
  manifest(): Record<string, unknown> {
    return {
      service: this.config.service,
      pricePerCall: this.config.pricePerCall,
      dynamicPricing: !!this.config.priceFn,
      pricingNote: this.config.pricingNote,
      description: this.config.description,
      endpoint: this.config.endpoint,
      ownerWallet: this.ownerAddress,
      acceptedToken: this.asset,
      platformAuth: !!this.platformPublicKey,
    };
  }

  private async handleExpress(req: Request, res: Response): Promise<void> {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const result = await this.verifyAndServe({
      body: req.body,
      headers: req.headers,
      rawBody,
      ip: req.ip,
    });
    res.status(result.status).json(result.body);
  }

  async listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, '0.0.0.0', () => {
        console.log(
          `[${this.config.service}] live on :${port} (${this.config.pricePerCall} ${this.asset}/call)`,
        );
        resolve();
      });
    });
  }

  // ─── framework-agnostic verify + serve ──────────────────────

  /**
   * Verify payment and run the handler. Returns `{ status, body }` — mount this in
   * any HTTP framework. Order of acceptance:
   *   1. If platform-auth headers are present → verify the signature (401 on failure,
   *      no fall-through).
   *   2. Else if X-PAYMENT is present → verify the escrow binding + funding (402 on
   *      failure), serve once, release in the background.
   *   3. Else → 402 with a quote (rate-limited).
   */
  async verifyAndServe(input: ServeInput): Promise<ServeResult> {
    if (!this.handler) {
      return { status: 500, body: { error: 'service handler not configured' } };
    }

    const hasPlatformCert =
      headerPresent(input.headers, PLATFORM_CERT_HEADER) ||
      headerPresent(input.headers, PLATFORM_SIGNATURE_HEADER);
    if (hasPlatformCert) {
      return this.servePlatformSigned(input);
    }

    const paymentHeader = headerValue(input.headers, 'X-PAYMENT');
    if (!paymentHeader) {
      return this.quote402(input);
    }
    return this.serveEscrow(input, paymentHeader);
  }

  // ── path 1: platform-signed (trusted, fast off-chain) ───────

  private async servePlatformSigned(input: ServeInput): Promise<ServeResult> {
    if (!this.platformPublicKey) {
      return {
        status: 401,
        body: { error: 'platform-auth is not enabled on this agent (no platform.publicKey configured)' },
      };
    }
    const verdict = verifyPlatformCall({
      publicKey: this.platformPublicKey,
      headers: input.headers,
      body: input.rawBody ?? (input.body as object),
      expectedService: this.config.service,
      replayGuard: this.platformReplay,
      maxClockSkewSec: this.platformMaxSkewSec,
    });
    if (!verdict.ok) {
      return { status: 401, body: { error: verdict.error.message, reason: verdict.error.reason } };
    }
    return this.runHandler(input.body, { trusted: true, claimed: false });
  }

  // ── path 2: x402 escrow (trustless, on-chain) ───────────────

  private async serveEscrow(input: ServeInput, paymentHeader: string): Promise<ServeResult> {
    let parsed: { escrowId?: string; nonce?: string };
    try {
      parsed = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'invalid X-PAYMENT header (must be base64 JSON)' } };
    }

    // Degraded mode: no chain → cannot verify on-chain. Fail-closed unless explicitly
    // opted in via `allowUnverified` (local demos only).
    if (!this.chain) {
      if (!this.config.allowUnverified) {
        return {
          status: 503,
          body: {
            error:
              'on-chain verification unavailable (no chain configured) — refusing to serve unpaid. ' +
              'Set allowUnverified:true to allow degraded mode explicitly.',
          },
        };
      }
      return this.runHandler(input.body, { claimed: false, mode: 'degraded-no-onchain-verification' });
    }

    const escrowId = parsed.escrowId;
    if (!escrowId) return { status: 400, body: { error: 'X-PAYMENT without escrowId' } };

    // Single-use: never serve the same escrow twice. The on-chain state check below
    // covers post-release reuse; this set covers the in-flight + just-served window
    // (release is backgrounded and slow).
    this.pruneConsumed();
    if (this.inFlightEscrows.has(escrowId) || this.consumedEscrows.has(escrowId)) {
      return { status: 409, body: { error: 'escrow already consumed' } };
    }

    const expected = this.amountForNonce(parsed.nonce, input.body);

    // The escrow may take a moment to index AND its funding to confirm on-chain.
    // Retry until Pending + funded (>= price), or time out (~30s).
    const attempts = this.config.escrowPollAttempts ?? 12;
    const intervalMs = this.config.escrowPollIntervalMs ?? 2500;
    let escrow = await this.chain.fetchEscrow({ escrowId });
    for (
      let i = 0;
      i < attempts && !(escrow && escrow.state === 'Pending' && escrow.amountBaseUnits >= expected);
      i++
    ) {
      await sleep(intervalMs);
      escrow = await this.chain.fetchEscrow({ escrowId });
    }
    if (!escrow) return { status: 402, body: { error: 'escrow not found' } };
    if (escrow.state !== 'Pending') {
      return { status: 402, body: { error: `escrow already ${escrow.state.toLowerCase()}` } };
    }

    // CRITICAL: bind the escrow to THIS agent. Without this, a caller could present an
    // escrow funded for a different agent and drain this one for free.
    if (escrow.receiver === undefined) {
      return {
        status: 402,
        body: { error: 'escrow receiver unknown — cannot verify this agent is the payee' },
      };
    }
    if (escrow.receiver !== this.chain.ownerAddress) {
      return {
        status: 402,
        body: { error: 'escrow receiver does not match this agent' },
      };
    }
    if (escrow.amountBaseUnits < expected) {
      return {
        status: 402,
        body: { error: `escrow amount ${escrow.amountBaseUnits} below price ${expected}` },
      };
    }

    // Claim the slot before serving so concurrent presentations of the same escrow lose.
    this.inFlightEscrows.add(escrowId);
    let result: unknown;
    try {
      result = await this.handler!(input.body);
    } catch (err) {
      this.inFlightEscrows.delete(escrowId); // serving failed → allow a retry
      return { status: 500, body: { error: err instanceof Error ? err.message : 'unknown error' } };
    }
    this.inFlightEscrows.delete(escrowId);
    this.consumedEscrows.set(escrowId, Math.floor(Date.now() / 1000));

    // Funds are locked for this agent → respond now and release in the background
    // (Trustless Work release is slow/flaky). If release fails, funds stay in the
    // escrow and can be retried/recovered — the caller still got its result.
    const body = withPayment(result, {
      claimed: false,
      settling: true,
      escrowId,
      amount: escrow.amountBaseUnits.toString(),
    });
    void this.claimWithRetry(escrowId)
      .then((sig) => console.log(`[${this.config.service}] release ${escrowId} ok: ${sig}`))
      .catch((err) =>
        console.error(
          `[${this.config.service}] release ${escrowId} failed (funds remain in escrow): ${(err as Error).message}`,
        ),
      );
    return { status: 200, body };
  }

  // ── path 3: unpaid → 402 quote (rate-limited) ───────────────

  private async quote402(input: ServeInput): Promise<ServeResult> {
    const perMin = this.config.rateLimitPerMinute ?? 60;
    if (perMin > 0 && this.rateLimited(input.ip ?? 'unknown', perMin)) {
      return { status: 429, body: { error: 'rate limit exceeded' } };
    }
    const nonce = generateNonce().toString();
    const amount = await this.computeAmountBaseUnits(input.body);
    // Cache so the post-payment check reuses this amount (priceFn runs once, and a
    // non-deterministic priceFn can't strand funds by quoting a different number).
    this.quoteCache.set(nonce, { amount, exp: Math.floor(Date.now() / 1000) + 120 });
    this.pruneQuotes();
    return {
      status: 402,
      body: {
        amount: amount.toString(),
        payTo: this.ownerAddress,
        asset: this.asset,
        service: this.config.service,
        nonce,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
    };
  }

  // ─── helpers ────────────────────────────────────────────────

  private async runHandler(body: unknown, payment: Record<string, unknown>): Promise<ServeResult> {
    try {
      const result = await this.handler!(body);
      return { status: 200, body: withPayment(result, payment) };
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : 'unknown error' } };
    }
  }

  /** Use the cached quote amount for this nonce if present; otherwise recompute. */
  private amountForNonce(nonce: string | undefined, body: unknown): bigint {
    if (nonce) {
      const cached = this.quoteCache.get(nonce);
      if (cached) return cached.amount;
    }
    // Fallback: recompute synchronously from the floor (no priceFn await here — the
    // escrow amount is the binding constraint; the floor is the minimum we accept).
    return BigInt(Math.floor(this.config.pricePerCall * this.baseUnitsPerToken));
  }

  /**
   * Compute how many base units to charge for this request.
   * - With `priceFn`: invoke it, raise to the floor if lower.
   * - Without: always `pricePerCall` (flat).
   */
  private async computeAmountBaseUnits(payload: unknown): Promise<bigint> {
    const floor = this.config.pricePerCall;
    let priceToken = floor;
    if (this.config.priceFn) {
      try {
        const computed = await this.config.priceFn(payload);
        priceToken = Number.isFinite(computed) ? Math.max(floor, computed) : floor;
      } catch (err) {
        console.warn(`[${this.config.service}] priceFn threw, falling back to floor:`, err);
        priceToken = floor;
      }
    }
    return BigInt(Math.floor(priceToken * this.baseUnitsPerToken));
  }

  private rateLimited(ip: string, perMin: number): boolean {
    const now = Date.now();
    const e = this.rate.get(ip);
    if (!e || now - e.windowStart >= 60_000) {
      this.rate.set(ip, { count: 1, windowStart: now });
      return false;
    }
    e.count += 1;
    return e.count > perMin;
  }

  private pruneQuotes(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, q] of this.quoteCache) if (q.exp <= now) this.quoteCache.delete(nonce);
  }

  private pruneConsumed(): void {
    const cutoff = Math.floor(Date.now() / 1000) - 3600; // keep 1h (well past release time)
    for (const [id, at] of this.consumedEscrows) if (at < cutoff) this.consumedEscrows.delete(id);
  }

  /**
   * Ensure the agent is funded for fees and registered on-chain (registers if absent,
   * reconciles config drift if present). No-op in degraded mode.
   */
  async bootstrap(): Promise<void> {
    if (!this.chain) {
      console.log(`[${this.config.service}] skip bootstrap (no chain configured)`);
      return;
    }
    await this.chain.ensureFunds(0.5, 2);

    const expectedPrice = BigInt(Math.floor(this.config.pricePerCall * this.chain.baseUnitsPerToken));
    const existing = await this.chain.fetchAgent(this.config.service);
    if (existing) {
      const priceDrift = existing.pricePerCallBaseUnits !== expectedPrice;
      const descDrift = (existing.description ?? '') !== (this.config.description ?? '');
      const endpointDrift = (existing.endpoint ?? '') !== (this.config.endpoint ?? '');
      if (priceDrift || descDrift || endpointDrift) {
        console.log(
          `[${this.config.service}] config drift → updating on-chain (price=${priceDrift}, desc=${descDrift}, endpoint=${endpointDrift})`,
        );
        const sig = await this.chain.updateAgent({
          service: this.config.service,
          pricePerCallBaseUnits: priceDrift ? expectedPrice : null,
          description: descDrift ? this.config.description ?? '' : null,
          endpoint: endpointDrift ? this.config.endpoint ?? '' : null,
        });
        console.log(`[${this.config.service}] updated on-chain: ${sig}`);
      } else {
        console.log(`[${this.config.service}] already registered (owner: ${existing.ownerAddress})`);
      }
      return;
    }

    const sig = await this.chain.registerAgent({
      service: this.config.service,
      pricePerCallBaseUnits: expectedPrice,
      endpoint: this.config.endpoint ?? '',
      description: this.config.description ?? '',
    });
    console.log(`[${this.config.service}] registered on-chain: ${sig}`);
  }

  /**
   * Release the payment with retries. On testnet `claim_payment` can fail from
   * propagation lag even after `fetchEscrow` saw Pending. A landed-but-unconfirmed
   * attempt is detected via Completed state.
   */
  private async claimWithRetry(escrowId: string): Promise<string> {
    const ATTEMPTS = 4;
    let lastErr: unknown;
    for (let i = 0; i < ATTEMPTS; i++) {
      try {
        return await this.chain!.claimPayment({ escrowId });
      } catch (err) {
        lastErr = err;
        try {
          const e = await this.chain!.fetchEscrow({ escrowId });
          if (e && e.state === 'Completed') return 'claimed';
        } catch {
          /* ignore, retry */
        }
        if (i < ATTEMPTS - 1) await sleep(1500 * (i + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('claim failed after retries');
  }
}

// ─── module helpers ───────────────────────────────────────────

function withPayment(result: unknown, payment: Record<string, unknown>): Record<string, unknown> {
  const base = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : { result };
  return { ...base, _payment: payment };
}

function generateNonce(): bigint {
  const ts = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * 1_000_000));
  return (ts << 20n) | rand;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function headerPresent(headers: Record<string, string | string[] | undefined>, name: string): boolean {
  return headerValue(headers, name) !== undefined;
}
