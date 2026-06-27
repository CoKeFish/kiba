/**
 * StellarChainClient — implementación de ChainClient sobre Soroban (Stellar).
 *
 * Habla con el contrato Kiba desplegado en Soroban vía @stellar/stellar-sdk:
 * simula/prepara/firma/envía invocaciones de contrato y parsea sus retornos.
 * El resto del SDK (AgentClient/AgentProvider) no cambia: opera contra la misma
 * interfaz ChainClient, sin saber que por debajo hay Stellar en vez de Solana.
 *
 * El mismo par de claves cubre los dos roles, como en Solana:
 *  - en AgentClient (consumidor) → `this` es el cliente/pagador (open_escrow).
 *  - en AgentProvider (proveedor) → `this` es el agent owner (fetch/claim).
 */
import {
  rpc,
  Horizon,
  Account,
  Contract,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import type {
  ChainClient,
  ChainAgentInfo,
  ChainEscrowInfo,
  RegisterAgentArgs,
  UpdateAgentArgs,
  OpenEscrowArgs,
  OpenEscrowResult,
  FetchEscrowArgs,
  ClaimPaymentArgs,
  RefundEscrowArgs,
} from './types';
import { TrustlessWorkEscrowClient, type TrustlessWorkConfig } from './trustless-work';

/** Stroops por XLM (7 decimales). Análogo a lamports/SOL en Solana. */
const STROOPS_PER_XLM = 1e7;

export interface StellarChainClientConfig {
  /** Par de claves que firma (cliente o agent owner según el rol). */
  keypair: Keypair;
  /** Contract ID (C...) del contrato Kiba en Soroban. */
  contractId: string;
  /** URL del RPC de Soroban (ej. https://soroban-testnet.stellar.org). */
  rpcUrl: string;
  /** Network passphrase (ej. Networks.TESTNET). */
  networkPassphrase: string;
  /** Símbolo del activo de liquidación. Default 'XLM'. */
  asset?: 'XLM' | 'USDC';
  /** Unidades base por token. Default 1e7 (stroops/XLM). */
  baseUnitsPerToken?: number;
  /** URL de friendbot para fondear en testnet (opcional). */
  friendbotUrl?: string;
  /** URL de Horizon para consultar saldos (default testnet). */
  horizonUrl?: string;
  /** Prefijo para logs. */
  label?: string;
  /**
   * Config de Trustless Work para el escrow. Si está presente, las ops de escrow
   * (open/fetch/claim/refund) se liquidan vía la API de TW en vez del contrato Kiba.
   * El registro de agentes sigue en el contrato Kiba.
   */
  tw?: Pick<
    TrustlessWorkConfig,
    'apiUrl' | 'apiKey' | 'platformAddress' | 'platformFee' | 'trustline'
  >;
}

export class StellarChainClient implements ChainClient {
  readonly asset: 'XLM' | 'USDC';
  readonly baseUnitsPerToken: number;

  private readonly server: rpc.Server;
  private readonly horizon: Horizon.Server;
  private readonly contract: Contract;
  private readonly keypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly friendbotUrl?: string;
  private readonly label: string;
  /** Cliente de escrow de Trustless Work. null si no está configurado. */
  private readonly tw: TrustlessWorkEscrowClient | null;

  constructor(cfg: StellarChainClientConfig) {
    this.server = new rpc.Server(cfg.rpcUrl);
    this.horizon = new Horizon.Server(cfg.horizonUrl ?? 'https://horizon-testnet.stellar.org');
    this.contract = new Contract(cfg.contractId);
    this.keypair = cfg.keypair;
    this.networkPassphrase = cfg.networkPassphrase;
    this.asset = cfg.asset ?? 'XLM';
    this.baseUnitsPerToken = cfg.baseUnitsPerToken ?? STROOPS_PER_XLM;
    this.friendbotUrl = cfg.friendbotUrl;
    this.label = cfg.label ?? 'stellar';
    this.tw = cfg.tw
      ? new TrustlessWorkEscrowClient(this.keypair, {
          ...cfg.tw,
          networkPassphrase: this.networkPassphrase,
          baseUnitsPerToken: this.baseUnitsPerToken,
          label: `${this.label}:tw`,
        })
      : null;
  }

  get ownerAddress(): string {
    return this.keypair.publicKey();
  }

  // ─── helpers de invocación ─────────────────────────────────

  /** Método que cambia estado: prepara (simula + footprint + auth), firma, envía y espera. */
  private async invoke(method: string, args: xdr.ScVal[]): Promise<string> {
    // Reintentos: en testnet, submit/confirm falla por races transitorios
    // (txBadSeq con sequence stale, fee de recurso bajo bajo carga, NOT_FOUND
    // por lag de confirmación). Re-leemos la cuenta (sequence fresco) en cada
    // intento. Es SEGURO reintentar: el nonce del escrow es fijo por llamada, así
    // que un open/claim que ya aterrizó rebota con EscrowExists/NotPending (no
    // duplica). Backoff entre intentos.
    const ATTEMPTS = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const source = await this.server.getAccount(this.keypair.publicKey());
        const tx = new TransactionBuilder(source, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const prepared = await this.server.prepareTransaction(tx);
        prepared.sign(this.keypair);

        const sent = await this.server.sendTransaction(prepared);
        if (sent.status === 'ERROR') {
          throw new Error(
            `[${this.label}] ${method} rechazada: ${JSON.stringify(sent.errorResult)}`,
          );
        }

        let result = await this.server.getTransaction(sent.hash);
        const deadline = Date.now() + 30_000;
        while (
          result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          result = await this.server.getTransaction(sent.hash);
        }
        if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
          throw new Error(`[${this.label}] ${method} no confirmó: ${result.status}`);
        }
        return sent.hash;
      } catch (err) {
        lastErr = err;
        if (attempt < ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`[${this.label}] ${method} falló tras reintentos`);
  }

  /** Método read-only: solo simula y devuelve el valor nativo del retorno.
   *  Usa una cuenta efímera (seq 0) como fuente: la simulación no requiere que
   *  exista ni esté fondeada, así cualquier keypair puede leer (p.ej. el backend). */
  private async read(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(this.keypair.publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`[${this.label}] simulación de ${method} falló`);
    }
    return scValToNative(sim.result.retval);
  }

  // conversores a ScVal (los tipos del contrato: Address, String, i128, u64, Option)
  private addr(a: string): xdr.ScVal {
    return nativeToScVal(a, { type: 'address' });
  }
  private str(v: string): xdr.ScVal {
    return nativeToScVal(v, { type: 'string' });
  }
  private i128(n: bigint): xdr.ScVal {
    return nativeToScVal(n, { type: 'i128' });
  }
  private optI128(n?: bigint | null): xdr.ScVal {
    return n == null ? xdr.ScVal.scvVoid() : this.i128(n);
  }
  private optStr(v?: string | null): xdr.ScVal {
    return v == null ? xdr.ScVal.scvVoid() : this.str(v);
  }

  // ─── ChainClient ───────────────────────────────────────────

  async ensureFunds(_minToken: number, _topUpToken: number): Promise<void> {
    try {
      await this.server.getAccount(this.keypair.publicKey());
      return; // cuenta existe y está fondeada
    } catch {
      // cuenta inexistente → intentar friendbot (testnet/futurenet)
    }
    if (!this.friendbotUrl) {
      console.warn(
        `[${this.label}] cuenta sin fondear y sin friendbot: ${this.ownerAddress}`,
      );
      return;
    }
    const res = await fetch(
      `${this.friendbotUrl}?addr=${encodeURIComponent(this.ownerAddress)}`,
    );
    if (!res.ok) {
      console.warn(`[${this.label}] friendbot falló (${res.status}) para ${this.ownerAddress}`);
    } else {
      console.log(`[${this.label}] cuenta fondeada vía friendbot → ${this.ownerAddress}`);
    }
  }

  async getBalanceBaseUnits(): Promise<bigint> {
    try {
      const acct = await this.horizon.loadAccount(this.keypair.publicKey());
      const native = acct.balances.find((b) => b.asset_type === 'native');
      const xlm = native ? parseFloat(native.balance) : 0;
      return BigInt(Math.floor(xlm * this.baseUnitsPerToken));
    } catch {
      return 0n; // cuenta inexistente / no fondeada
    }
  }

  async fetchAgent(service: string): Promise<ChainAgentInfo | null> {
    const a = (await this.read('get_agent', [this.str(service)])) as
      | {
          service: string;
          price_per_call: bigint;
          description: string;
          endpoint: string;
          owner: string;
          created_at?: bigint | number;
          total_calls?: bigint | number;
          total_earned?: bigint | number;
        }
      | null
      | undefined;
    if (a == null) return null;
    return {
      service: a.service,
      pricePerCallBaseUnits: BigInt(a.price_per_call),
      description: a.description,
      endpoint: a.endpoint,
      ownerAddress: a.owner,
      createdAt: a.created_at != null ? BigInt(a.created_at) : undefined,
      totalCalls: a.total_calls != null ? BigInt(a.total_calls) : undefined,
      totalEarnedBaseUnits: a.total_earned != null ? BigInt(a.total_earned) : undefined,
    };
  }

  async registerAgent(args: RegisterAgentArgs): Promise<string> {
    return this.invoke('register_agent', [
      this.addr(this.ownerAddress),
      this.str(args.service),
      this.i128(args.pricePerCallBaseUnits),
      this.str(args.endpoint),
      this.str(args.description),
    ]);
  }

  async updateAgent(args: UpdateAgentArgs): Promise<string> {
    return this.invoke('update_agent', [
      this.str(args.service),
      this.optI128(args.pricePerCallBaseUnits),
      this.optStr(args.endpoint),
      this.optStr(args.description),
    ]);
  }

  async deregisterAgent(service: string): Promise<string> {
    // El contrato deriva el owner del registro y exige owner.require_auth() → firma el custodial.
    return this.invoke('deregister_agent', [this.str(service)]);
  }

  private requireTw(): TrustlessWorkEscrowClient {
    if (!this.tw) {
      throw new Error(
        `[${this.label}] escrow no disponible: falta config de Trustless Work ` +
          `(TRUSTLESS_WORK_API_KEY). El escrow x402 se liquida vía Trustless Work.`,
      );
    }
    return this.tw;
  }

  async openEscrow(args: OpenEscrowArgs): Promise<OpenEscrowResult> {
    // 'this' es el cliente/pagador (funder). El escrow se despliega+fondea en Trustless
    // Work con el owner del agente como receiver/serviceProvider/releaseSigner/approver.
    return this.requireTw().deployAndFund({
      agentOwner: args.payToAddress,
      service: args.service,
      engagementId: `${args.service}-${args.nonce}`,
      amountBaseUnits: args.amountBaseUnits,
    });
  }

  async fetchEscrow(args: FetchEscrowArgs): Promise<ChainEscrowInfo | null> {
    return this.requireTw().getEscrow(args.escrowId);
  }

  async claimPayment(args: ClaimPaymentArgs): Promise<string> {
    // 'this' es el agent owner (releaseSigner): libera los fondos al receiver.
    return this.requireTw().release(args.escrowId);
  }

  async refundEscrow(args: RefundEscrowArgs): Promise<string> {
    // 'this' es el cliente/pagador: recupera fondos vía el flujo de disputa de TW.
    return this.requireTw().refund(args.escrowId);
  }
}
