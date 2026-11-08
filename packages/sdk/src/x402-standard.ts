/**
 * x402 estándar hacia dentro (lado vendedor).
 *
 * Con esto un servicio Kiba también cobra por el estándar x402 (v2, esquema `exact`, USDC en
 * Stellar), así que cualquier cliente x402 (un agente hecho con `@x402/fetch`, por ejemplo)
 * puede pagarle sin pasar por el conector de Kiba:
 *
 *   - La respuesta 402 lleva la cabecera PAYMENT-REQUIRED con los requisitos (precio de ESTA
 *     petición, cuenta del agente, red y USDC), además del cuerpo de cotización propio de Kiba.
 *   - Una petición con PAYMENT-SIGNATURE se verifica y liquida on-chain a través de un
 *     facilitador (hospedado, o el propio agente con `selfFacilitate`) y la respuesta 200 lleva
 *     PAYMENT-RESPONSE con el hash de la transacción.
 *
 * Los paquetes `@x402/core` y `@x402/stellar` son opcionales: se cargan solo si el agente
 * activa x402 (config `x402` o variable KIBA_X402_FACILITATOR).
 */
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import type { AgentConfig } from './types';
import type { WalletLike } from './chain';
import { ConfigError } from './errors';

export type X402Network = 'stellar:testnet' | 'stellar:pubnet';

/** Tipos estructurales mínimos del protocolo (los paquetes @x402/* se cargan con require). */
export interface X402Requirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}
export interface X402Payload {
  x402Version: number;
  accepted: X402Requirements;
  payload: Record<string, unknown>;
  resource?: unknown;
  extensions?: Record<string, unknown>;
}
export interface X402VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}
export interface X402SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: string;
}
export interface X402SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}
/** Quien verifica y liquida: un facilitador HTTP, el propio agente, o un doble en tests. */
export interface X402FacilitatorClient {
  verify(payload: X402Payload, requirements: X402Requirements): Promise<X402VerifyResponse>;
  settle(payload: X402Payload, requirements: X402Requirements): Promise<X402SettleResponse>;
  getSupported(): Promise<{ kinds: X402SupportedKind[]; extensions: string[]; signers: Record<string, string[]> }>;
}

export interface X402StandardConfig {
  /** Red CAIP-2. Por defecto se deriva de `network` del agente (testnet → stellar:testnet). */
  network?: X402Network;
  /** Facilitador HTTP que verifica y liquida. Default en testnet: https://x402.org/facilitator (sin clave). */
  facilitatorUrl?: string;
  /** Clave del facilitador, si la exige (p. ej. OpenZeppelin Channels). */
  facilitatorApiKey?: string;
  /**
   * Verificar y liquidar en el propio proceso con la cuenta del agente: sin terceros. El agente
   * envía la transacción y paga la comisión de red (~0,00001 XLM) con su propio XLM.
   */
  selfFacilitate?: boolean;
  /** RPC de Soroban para la autofacilitación (default: el público de la red). */
  rpcUrl?: string;
  /** Validez de los requisitos de pago en segundos (default 60). */
  maxTimeoutSeconds?: number;
  /** Tests: facilitador inyectado (ignora facilitatorUrl/selfFacilitate). */
  facilitator?: X402FacilitatorClient;
}

export const DEFAULT_TESTNET_FACILITATOR = 'https://x402.org/facilitator';
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

/**
 * Configuración por entorno (fallback cuando el agente no pasa `x402`):
 *   KIBA_X402_FACILITATOR = URL del facilitador | 'self'
 *   KIBA_X402_FACILITATOR_API_KEY, KIBA_X402_NETWORK (stellar:testnet | stellar:pubnet)
 */
export function x402ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): X402StandardConfig | undefined {
  const f = env.KIBA_X402_FACILITATOR?.trim();
  if (!f) return undefined;
  const cfg: X402StandardConfig = {};
  if (f === 'self') cfg.selfFacilitate = true;
  else cfg.facilitatorUrl = f;
  if (env.KIBA_X402_FACILITATOR_API_KEY) cfg.facilitatorApiKey = env.KIBA_X402_FACILITATOR_API_KEY;
  if (env.KIBA_X402_NETWORK === 'stellar:pubnet' || env.KIBA_X402_NETWORK === 'stellar:testnet') {
    cfg.network = env.KIBA_X402_NETWORK;
  }
  if (env.KIBA_X402_RPC_URL) cfg.rpcUrl = env.KIBA_X402_RPC_URL;
  return cfg;
}

// Los paquetes son peer deps opcionales: se piden al activar x402, con un error que dice qué instalar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function load(name: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name);
  } catch (err) {
    throw new ConfigError(
      `x402 estándar necesita los paquetes @x402/core y @x402/stellar (npm i @x402/core @x402/stellar; Node >= 22): ` +
        `no se pudo cargar ${name}: ${(err as Error).message}`,
    );
  }
}

interface AgentIdentity {
  network?: 'testnet' | 'mainnet';
  secret?: string;
  wallet?: WalletLike;
  /** Cuenta G... que cobra. */
  payTo: string;
  service: string;
  endpoint?: string;
  description?: string;
}

export class X402Standard {
  readonly network: X402Network;
  private ready?: Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private http: any;
  private usdc = '';

  constructor(
    private readonly cfg: X402StandardConfig,
    private readonly agent: AgentIdentity,
  ) {
    this.network = cfg.network ?? (agent.network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet');
  }

  /** null si el agente no activa x402 (ni por config ni por entorno). */
  static from(config: AgentConfig, payTo: string): X402Standard | null {
    const cfg = config.x402 ?? x402ConfigFromEnv();
    if (!cfg) return null;
    return new X402Standard(cfg, {
      network: config.network,
      secret: config.secret,
      wallet: config.wallet,
      payTo,
      service: config.service,
      endpoint: config.endpoint,
      description: config.description,
    });
  }

  /** Dirección del contrato USDC (SAC) que se cobra. */
  get asset(): string {
    return this.usdc;
  }

  init(): Promise<void> {
    return (this.ready ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    const serverMod = load('@x402/core/server');
    this.http = load('@x402/core/http');
    const stellar = load('@x402/stellar');
    const { ExactStellarScheme } = load('@x402/stellar/exact/server');
    this.usdc = stellar.getUsdcAddress(this.network);
    const facilitator =
      this.cfg.facilitator ?? (this.cfg.selfFacilitate ? this.selfFacilitator(stellar) : this.hostedFacilitator(serverMod));
    this.server = new serverMod.x402ResourceServer(facilitator).register(this.network, new ExactStellarScheme());
    await this.server.initialize();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hostedFacilitator(serverMod: any): X402FacilitatorClient {
    const url = this.cfg.facilitatorUrl ?? (this.network === 'stellar:testnet' ? DEFAULT_TESTNET_FACILITATOR : undefined);
    if (!url) throw new ConfigError('x402: en mainnet hay que indicar facilitatorUrl (o selfFacilitate)');
    const key = this.cfg.facilitatorApiKey;
    return new serverMod.HTTPFacilitatorClient({
      url,
      ...(key
        ? {
            createAuthHeaders: async () => {
              const h = { Authorization: `Bearer ${key}` };
              return { verify: h, settle: h, supported: h };
            },
          }
        : {}),
    });
  }

  /** El agente verifica y envía él mismo la transacción (paga la comisión con su XLM). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private selfFacilitator(stellar: any): X402FacilitatorClient {
    const { ExactStellarScheme } = load('@x402/stellar/exact/facilitator');
    const signer = stellar.createEd25519Signer(this.agentSecret(), this.network);
    const scheme = new ExactStellarScheme([signer], {
      rpcConfig: this.cfg.rpcUrl ? { url: this.cfg.rpcUrl } : undefined,
      areFeesSponsored: true,
    });
    const network = this.network;
    return {
      verify: (p, r) => scheme.verify(p, r),
      settle: (p, r) => scheme.settle(p, r),
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: 'exact', network, extra: scheme.getExtra(network) }],
        extensions: [],
        signers: { 'stellar:*': scheme.getSigners(network) },
      }),
    };
  }

  private agentSecret(): string {
    if (this.agent.secret) return this.agent.secret;
    const w: WalletLike | undefined = this.agent.wallet;
    if (w) {
      if ('secretKey' in w) return StellarKeypair.fromRawEd25519Seed(Buffer.from(w.secretKey.slice(0, 32))).secret();
      return w.secret();
    }
    throw new ConfigError('x402 selfFacilitate necesita la clave del agente (secret o wallet)');
  }

  /** Requisitos de pago para cobrar `amountBaseUnits` (USDC, 7 decimales) a la cuenta del agente. */
  async requirements(amountBaseUnits: bigint): Promise<X402Requirements[]> {
    await this.init();
    return this.server.buildPaymentRequirements({
      scheme: 'exact',
      payTo: this.agent.payTo,
      network: this.network,
      price: { amount: amountBaseUnits.toString(), asset: this.usdc },
      maxTimeoutSeconds: this.cfg.maxTimeoutSeconds ?? 60,
    });
  }

  /** Cabecera PAYMENT-REQUIRED para una respuesta 402. */
  async paymentRequiredHeader(requirements: X402Requirements[], error?: string): Promise<Record<string, string>> {
    await this.init();
    const resource = {
      url: this.agent.endpoint ?? `https://api.kiba.tools/services/${this.agent.service}`,
      description: this.agent.description ?? this.agent.service,
      mimeType: 'application/json',
    };
    const pr = await this.server.createPaymentRequiredResponse(requirements, resource, error ?? 'Payment required');
    return { [PAYMENT_REQUIRED_HEADER]: this.http.encodePaymentRequiredHeader(pr) };
  }

  async decodePayload(header: string): Promise<X402Payload> {
    await this.init();
    return this.http.decodePaymentSignatureHeader(header);
  }

  /**
   * Lo que el cliente aceptó tiene que ser lo que este agente cobra: su cuenta, su red, USDC y al
   * menos el precio de ESTA petición. Devuelve el motivo del rechazo o null si vale.
   */
  checkAccepted(accepted: X402Requirements | undefined, expectedBaseUnits: bigint): string | null {
    if (!accepted) return 'payload sin requisitos aceptados';
    if (accepted.scheme !== 'exact') return `esquema no soportado: ${accepted.scheme}`;
    if (accepted.network !== this.network) return `red distinta: ${accepted.network} (este servicio cobra en ${this.network})`;
    if (accepted.asset !== this.usdc) return `activo distinto: ${accepted.asset} (este servicio cobra USDC ${this.usdc})`;
    if (accepted.payTo !== this.agent.payTo) return 'payTo no es la cuenta de este servicio';
    let amount: bigint;
    try {
      amount = BigInt(accepted.amount);
    } catch {
      return `monto inválido: ${accepted.amount}`;
    }
    if (amount < expectedBaseUnits) return `monto ${amount} por debajo del precio ${expectedBaseUnits}`;
    return null;
  }

  async verify(payload: X402Payload, requirements: X402Requirements): Promise<X402VerifyResponse> {
    await this.init();
    return this.server.verifyPayment(payload, requirements);
  }

  async settle(payload: X402Payload, requirements: X402Requirements): Promise<X402SettleResponse> {
    await this.init();
    return this.server.settlePayment(payload, requirements);
  }

  settlementHeader(settle: X402SettleResponse): Record<string, string> {
    return { [PAYMENT_RESPONSE_HEADER]: this.http.encodePaymentResponseHeader(settle) };
  }

  /** Resumen para el manifest del servicio. */
  manifestEntry(): Record<string, unknown> {
    return {
      standard: 'x402',
      version: 2,
      scheme: 'exact',
      network: this.network,
      payTo: this.agent.payTo,
      ...(this.cfg.selfFacilitate ? { facilitator: 'self' } : {}),
    };
  }
}
