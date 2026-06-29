import axios, { type AxiosError, type AxiosResponse } from 'axios';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import type { CallOptions, ClientConfig, ServiceManifest, X402Quote } from './types';
import { createChainClient, walletToSigner, type ChainClient } from './chain';
import { BASE_UNITS_PER_TOKEN } from './config';
import { AgentCallError, EndpointVerificationError, EscrowError, ServiceNotFoundError } from './errors';
import { buildPlatformCallHeaders, type PlatformCallSigner } from './platform-auth';

/**
 * Trace of each step of the x402 handshake. Useful for inspection/UI: the dashboard
 * renders this array as a timeline.
 */
export type X402Step =
  | {
      type: 'discover';
      service: string;
      endpoint: string;
      pricePerCall: number;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: '402_received';
      quote: { amount: string; payTo: string; asset: string; nonce: string; expiresAt: number };
      durationMs: number;
      timestamp: number;
    }
  | {
      type: 'escrow_opened';
      signature: string;
      /** Escrow identity (Trustless Work contractId). */
      escrowId?: string;
      amount: string;
      nonce: string;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: 'service_responded';
      status: number;
      claimSignature?: string;
      claimedAmount?: string;
      durationMs: number;
      timestamp: number;
    };

export interface X402Trace {
  service: string;
  endpoint: string;
  totalDurationMs: number;
  steps: X402Step[];
}

/**
 * AgentClient — for agents (or the platform) that CONSUME a service.
 *
 *   const client = new AgentClient({ wallet, contractId, network });
 *   await client.bootstrap();  // fund if needed
 *   const result = await client.call('yield-hunter', { token: 'USDC' });
 */
export class AgentClient {
  /** Keypair of the client. Optional: with `signer` (e.g. Privy) there is no local keypair. */
  readonly wallet?: ClientConfig['wallet'];
  /** Settlement chain. null in degraded mode (no chain configured). */
  readonly chain: ChainClient | null;

  private readonly discoveryUrl?: string;
  private readonly verifyEndpoint: boolean;
  private readonly fallbackAddress: string;

  constructor(config: ClientConfig) {
    this.wallet = config.wallet;
    this.verifyEndpoint = config.verifyEndpoint ?? false;
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
      label: 'client',
    });
    this.discoveryUrl = config.discoveryUrl ?? process.env.KIBA_DISCOVERY_URL ?? process.env.BACKEND_URL;
    this.fallbackAddress = this.resolveAddress(config);
  }

  private resolveAddress(config: ClientConfig): string {
    if (config.signer) return config.signer.publicKey();
    if (config.secret) return StellarKeypair.fromSecret(config.secret).publicKey();
    if (config.wallet) return walletToSigner(config.wallet).publicKey();
    return 'unknown';
  }

  private get baseUnitsPerToken(): number {
    return this.chain?.baseUnitsPerToken ?? BASE_UNITS_PER_TOKEN;
  }

  /** Address used to locate escrows / receive responses. Prefers the chain address. */
  get ownerAddress(): string {
    return this.chain?.ownerAddress ?? this.fallbackAddress;
  }

  /**
   * Pre-quote: probe (POST without payment) to learn the real price the agent will
   * charge for this specific payload. Useful for callers that need the amount before
   * the full handshake (e.g. the gateway debits credit before moving funds on-chain).
   */
  async getQuote(
    service: string,
    payload: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<{ manifest: ServiceManifest; quote: X402Quote }> {
    const manifest = await this.discover(service);
    let quote: X402Quote;
    try {
      const probe = await axios.post(`${manifest.endpoint}/service`, payload, {
        timeout: options.timeoutMs ?? 30_000,
        validateStatus: () => true,
      });
      if (probe.status === 402) {
        quote = probe.data as X402Quote;
      } else if (probe.status >= 200 && probe.status < 300) {
        // Legacy: agent answered 200 directly, no paywall. Synthesize a quote from the manifest.
        quote = {
          amount: String(Math.floor(manifest.pricePerCall * this.baseUnitsPerToken)),
          payTo: manifest.ownerWallet,
          asset: manifest.acceptedToken,
          service: manifest.service,
          nonce: '0',
          expiresAt: 0,
        };
      } else {
        throw new AgentCallError(
          `expected 402, got ${probe.status}: ${JSON.stringify(probe.data)}`,
          service,
          probe.status,
        );
      }
    } catch (err) {
      const ax = err as AxiosError<X402Quote>;
      if (ax.response?.status === 402) {
        quote = ax.response.data as X402Quote;
      } else {
        throw err;
      }
    }
    return { manifest, quote };
  }

  async bootstrap(): Promise<void> {
    if (!this.chain) {
      console.log('[client] skip bootstrap (no chain configured)');
      return;
    }
    await this.chain.ensureFunds(0.5, 2);
  }

  /**
   * Discover and call a service, handling the x402 handshake automatically.
   * Wrapper over {@link callWithTrace} that discards the trace.
   */
  async call<TRes = unknown>(service: string, payload: unknown, options: CallOptions = {}): Promise<TRes> {
    const { result } = await this.callWithTrace<TRes>(service, payload, options);
    return result;
  }

  /**
   * Like {@link call} but also returns the trace of each x402 step (timestamps +
   * signatures). The dashboard renders this as a visual 402 → escrow → service →
   * claim timeline.
   */
  async callWithTrace<TRes = unknown>(
    service: string,
    payload: unknown,
    options: CallOptions = {},
  ): Promise<{ result: TRes; trace: X402Trace }> {
    const t0 = performance.now();
    const steps: X402Step[] = [];
    const stepStart = (start: number) => Math.max(1, Math.round(performance.now() - start));

    // 0) Discover
    const tDiscover = performance.now();
    const manifest = await this.discover(service);
    steps.push({
      type: 'discover',
      service: manifest.service,
      endpoint: manifest.endpoint,
      pricePerCall: manifest.pricePerCall,
      durationMs: stepStart(tDiscover),
      timestamp: Date.now(),
    });

    if (options.allowlist && !options.allowlist.includes(service)) {
      throw new AgentCallError(`service '${service}' not in allowlist`, service);
    }
    if (options.maxPrice !== undefined && manifest.pricePerCall > options.maxPrice) {
      throw new AgentCallError(
        `service '${service}' costs ${manifest.pricePerCall} ${manifest.acceptedToken}, exceeds maxPrice ${options.maxPrice}`,
        service,
      );
    }

    // 1) Probe → expect 402 with quote
    const tProbe = performance.now();
    let quote: X402Quote;
    try {
      const probe = await axios.post(`${manifest.endpoint}/service`, payload, {
        timeout: options.timeoutMs ?? 30_000,
        validateStatus: () => true,
      });
      if (probe.status !== 402) {
        if (probe.status >= 200 && probe.status < 300) {
          // Legacy / no paywall — return the result; trace stays partial.
          return {
            result: probe.data as TRes,
            trace: {
              service: manifest.service,
              endpoint: manifest.endpoint,
              totalDurationMs: Math.round(performance.now() - t0),
              steps,
            },
          };
        }
        throw new AgentCallError(
          `unexpected status ${probe.status}: ${JSON.stringify(probe.data)}`,
          service,
          probe.status,
        );
      }
      quote = probe.data;
    } catch (err) {
      const ax = err as AxiosError<X402Quote>;
      if (ax.response?.status === 402) {
        quote = ax.response.data;
      } else {
        throw err;
      }
    }
    steps.push({
      type: '402_received',
      quote: {
        amount: String(quote.amount),
        payTo: String(quote.payTo),
        asset: String(quote.asset ?? 'USDC'),
        nonce: String(quote.nonce),
        expiresAt: Number(quote.expiresAt ?? 0),
      },
      durationMs: stepStart(tProbe),
      timestamp: Date.now(),
    });

    // Authoritative cap: validate the REAL 402 price (quote.amount), not just the advertised
    // floor — a provider with dynamic pricing could quote higher.
    if (options.maxPrice !== undefined) {
      const quotedPrice = Number(quote.amount) / this.baseUnitsPerToken;
      if (quotedPrice > options.maxPrice) {
        throw new AgentCallError(
          `service '${service}' quoted ${quotedPrice}, exceeds maxPrice ${options.maxPrice}`,
          service,
        );
      }
    }

    // 2) Open (deploy+fund) the escrow in Trustless Work
    const tEscrow = performance.now();
    let escrowSig = 'NO_ONCHAIN_PROGRAM_ID';
    let escrowId = '';
    if (this.chain) {
      try {
        const opened = await this.chain.openEscrow({
          service: manifest.service,
          payToAddress: quote.payTo,
          nonce: BigInt(quote.nonce),
          amountBaseUnits: BigInt(quote.amount),
        });
        escrowSig = opened.signature;
        escrowId = opened.escrowId;
      } catch (err) {
        throw new EscrowError(
          `opening escrow for '${service}' (nonce ${quote.nonce}) failed or did not confirm. ` +
            `If the escrow was funded, recover it via the Trustless Work dispute flow. ` +
            `Cause: ${(err as Error).message}`,
          { recoverable: true, service, nonce: String(quote.nonce) },
        );
      }
    }
    steps.push({
      type: 'escrow_opened',
      signature: escrowSig,
      escrowId: escrowId || undefined,
      amount: String(quote.amount),
      nonce: String(quote.nonce),
      durationMs: stepStart(tEscrow),
      timestamp: Date.now(),
    });

    // 3) Build X-PAYMENT header. clientWallet is the native chain address (G... in
    //    Stellar) so the agent can locate the escrow on-chain.
    const paymentHeader = Buffer.from(
      JSON.stringify({
        escrowId,
        signature: escrowSig,
        nonce: quote.nonce,
        clientWallet: this.ownerAddress,
      }),
      'utf8',
    ).toString('base64');

    // 4) Retry with the header → the agent verifies + serves + releases
    const tFinal = performance.now();
    let final: AxiosResponse;
    try {
      final = await axios.post(`${manifest.endpoint}/service`, payload, {
        headers: { 'X-PAYMENT': paymentHeader },
        timeout: options.timeoutMs ?? 30_000,
      });
    } catch (err) {
      if (this.chain && escrowSig !== 'NO_ONCHAIN_PROGRAM_ID') {
        throw new EscrowError(
          `service '${service}' failed after opening escrow (escrowId ${escrowId}). ` +
            `Funds are held; recover with client.refundEscrow('${escrowId}'). ` +
            `Cause: ${(err as Error).message}`,
          { recoverable: true, service, escrowId },
        );
      }
      throw err;
    }
    const responsePayment = (final.data as { _payment?: { signature?: string; amount?: string } })?._payment;
    steps.push({
      type: 'service_responded',
      status: final.status,
      claimSignature: responsePayment?.signature,
      claimedAmount: responsePayment?.amount,
      durationMs: stepStart(tFinal),
      timestamp: Date.now(),
    });

    return {
      result: final.data as TRes,
      trace: {
        service: manifest.service,
        endpoint: manifest.endpoint,
        totalDurationMs: Math.round(performance.now() - t0),
        steps,
      },
    };
  }

  /**
   * Platform-signed call (asymmetric trust): invoke a service WITHOUT opening an
   * escrow, presenting a certificate signed by the platform's private key. The agent
   * verifies it against the platform's published public key (no shared secret) and
   * serves directly; payment settles off-band in batches. For the platform/gateway,
   * which already debited the user's credit BEFORE calling. Throws {@link AgentCallError}
   * if the agent does not answer 2xx (e.g. it rejects the certificate) so the caller
   * can refund.
   */
  async callSigned<TRes = unknown>(
    endpoint: string,
    payload: unknown,
    options: { signer: PlatformCallSigner; service: string; timeoutMs?: number },
  ): Promise<TRes> {
    const { headers, body } = await buildPlatformCallHeaders({
      signer: options.signer,
      service: options.service,
      payload,
    });
    try {
      const resp = await axios.post(`${endpoint}/service`, body, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: options.timeoutMs ?? 120_000,
      });
      return resp.data as TRes;
    } catch (err) {
      const ax = err as AxiosError;
      throw new AgentCallError(
        `platform-signed call to '${options.service}' failed: ${ax.message}`,
        options.service,
        ax.response?.status,
      );
    }
  }

  /**
   * Discover a service. Reads the on-chain registry first, then falls back to the
   * configured discovery backend. Throws {@link ServiceNotFoundError} if neither has it.
   */
  async discover(service: string): Promise<ServiceManifest> {
    if (this.chain) {
      const onChain = await this.chain.fetchAgent(service);
      if (onChain) {
        const manifest: ServiceManifest = {
          service: onChain.service,
          pricePerCall: Number(onChain.pricePerCallBaseUnits) / this.chain.baseUnitsPerToken,
          description: onChain.description,
          endpoint: onChain.endpoint,
          ownerWallet: onChain.ownerAddress,
          acceptedToken: this.chain.asset,
        };
        if (this.verifyEndpoint) await this.assertEndpointOwnership(manifest);
        return manifest;
      }
    }

    if (!this.discoveryUrl) {
      throw new ServiceNotFoundError(service);
    }
    try {
      const resp = await axios.get<ServiceManifest>(`${this.discoveryUrl}/agents/${service}`, {
        timeout: 10_000,
        validateStatus: () => true,
      });
      if (resp.status >= 200 && resp.status < 300 && resp.data?.endpoint) {
        return resp.data;
      }
      throw new ServiceNotFoundError(service);
    } catch (err) {
      if (err instanceof ServiceNotFoundError) throw err;
      throw new ServiceNotFoundError(service);
    }
  }

  /**
   * Verify a discovered endpoint belongs to the registered owner: its live `/manifest`
   * must report the same `service` and `ownerWallet`. Catches a registration that points
   * a service name at someone else's endpoint (name-squatting / endpoint hijack).
   */
  private async assertEndpointOwnership(m: ServiceManifest): Promise<void> {
    let live: ServiceManifest;
    try {
      const r = await axios.get<ServiceManifest>(`${m.endpoint}/manifest`, {
        timeout: 10_000,
        validateStatus: () => true,
      });
      if (r.status < 200 || r.status >= 300 || !r.data) {
        throw new Error(`manifest returned status ${r.status}`);
      }
      live = r.data;
    } catch (err) {
      throw new EndpointVerificationError(m.service, `endpoint ${m.endpoint} did not serve a manifest (${(err as Error).message})`);
    }
    if (live.service !== m.service || live.ownerWallet !== m.ownerWallet) {
      throw new EndpointVerificationError(
        m.service,
        `endpoint ${m.endpoint} is not controlled by the registered owner ` +
          `(live manifest: service='${live.service}', owner='${live.ownerWallet}')`,
      );
    }
  }

  /**
   * Refund an unreleased escrow (e.g. if the service call failed after opening it),
   * via the Trustless Work dispute flow. Returns the transaction hash/id.
   */
  async refundEscrow(escrowId: string): Promise<string> {
    if (!this.chain) {
      throw new EscrowError('refundEscrow: no chain configured (degraded mode)');
    }
    return this.chain.refundEscrow({ escrowId });
  }
}
