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
  Asset,
  Contract,
  Operation,
  TransactionBuilder,
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
import type { StellarSigner } from './signer';

/** Unidades base por token: 7 decimales en Stellar (vale para XLM nativo y para
 *  activos clásicos emitidos como USDC). */
const STROOPS_PER_XLM = 1e7;

export interface StellarChainClientConfig {
  /** Firmante (cliente o agent owner según el rol). Local (Keypair) o remoto (Privy). */
  signer: StellarSigner;
  /** Contract ID (C...) del contrato Kiba en Soroban. */
  contractId: string;
  /** URL del RPC de Soroban (ej. https://soroban-testnet.stellar.org). */
  rpcUrl: string;
  /** Network passphrase (ej. Networks.TESTNET). */
  networkPassphrase: string;
  /** Símbolo del activo de liquidación. Default 'USDC'. */
  asset?: 'XLM' | 'USDC';
  /** Issuer (G...) del activo emitido (USDC). Necesario para leer/crear su trustline.
   *  Si el asset es 'XLM' (nativo) o falta el issuer, se opera sobre el balance nativo. */
  assetIssuer?: string;
  /** Unidades base por token. Default 1e7 (7 decimales en Stellar). */
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
  private readonly signer: StellarSigner;
  private readonly networkPassphrase: string;
  private readonly friendbotUrl?: string;
  private readonly label: string;
  /** Issuer del activo emitido (USDC). undefined → opera sobre el balance nativo (XLM). */
  private readonly assetIssuer?: string;
  /** Cliente de escrow de Trustless Work. null si no está configurado. */
  private readonly tw: TrustlessWorkEscrowClient | null;

  constructor(cfg: StellarChainClientConfig) {
    this.server = new rpc.Server(cfg.rpcUrl);
    this.horizon = new Horizon.Server(cfg.horizonUrl ?? 'https://horizon-testnet.stellar.org');
    this.contract = new Contract(cfg.contractId);
    this.signer = cfg.signer;
    this.networkPassphrase = cfg.networkPassphrase;
    this.asset = cfg.asset ?? 'USDC';
    this.baseUnitsPerToken = cfg.baseUnitsPerToken ?? STROOPS_PER_XLM;
    this.assetIssuer = cfg.assetIssuer;
    this.friendbotUrl = cfg.friendbotUrl;
    this.label = cfg.label ?? 'stellar';
    this.tw = cfg.tw
      ? new TrustlessWorkEscrowClient(this.signer, {
          ...cfg.tw,
          networkPassphrase: this.networkPassphrase,
          baseUnitsPerToken: this.baseUnitsPerToken,
          label: `${this.label}:tw`,
        })
      : null;
  }

  get ownerAddress(): string {
    return this.signer.publicKey();
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
        const source = await this.server.getAccount(this.signer.publicKey());
        const tx = new TransactionBuilder(source, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const prepared = await this.server.prepareTransaction(tx);
        await this.signer.signTransaction(prepared);

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
    const source = new Account(this.signer.publicKey(), '0');
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
    let exists = true;
    try {
      await this.server.getAccount(this.signer.publicKey());
    } catch {
      exists = false; // cuenta inexistente → friendbot (testnet/futurenet)
    }
    if (!exists) {
      if (!this.friendbotUrl) {
        console.warn(`[${this.label}] cuenta sin fondear y sin friendbot: ${this.ownerAddress}`);
        return;
      }
      const res = await fetch(`${this.friendbotUrl}?addr=${encodeURIComponent(this.ownerAddress)}`);
      if (!res.ok) {
        console.warn(`[${this.label}] friendbot falló (${res.status}) para ${this.ownerAddress}`);
        return;
      }
      console.log(`[${this.label}] cuenta fondeada vía friendbot → ${this.ownerAddress}`);
    }
    // Asegura el trustline del activo emitido (USDC) para poder recibir/retener.
    await this.ensureTrustline();
  }

  /**
   * Establece el trustline del activo emitido (USDC) si la cuenta aún no lo tiene.
   * No-op para XLM nativo o si no hay issuer configurado. El gas se paga en XLM nativo.
   */
  async ensureTrustline(): Promise<void> {
    if (this.asset === 'XLM' || !this.assetIssuer) return;
    let acct: Horizon.AccountResponse;
    try {
      acct = await this.horizon.loadAccount(this.signer.publicKey());
    } catch {
      return; // la cuenta no existe todavía (debería correr friendbot antes)
    }
    const has = acct.balances.some(
      (b) => 'asset_code' in b && b.asset_code === this.asset && b.asset_issuer === this.assetIssuer,
    );
    if (has) return;
    try {
      const source = await this.server.getAccount(this.signer.publicKey());
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(Operation.changeTrust({ asset: new Asset(this.asset, this.assetIssuer) }))
        .setTimeout(30)
        .build();
      await this.signer.signTransaction(tx);
      const sent = await this.server.sendTransaction(tx);
      if (sent.status === 'ERROR') {
        console.warn(
          `[${this.label}] changeTrust ${this.asset} rechazado: ${JSON.stringify(sent.errorResult)}`,
        );
        return;
      }
      let result = await this.server.getTransaction(sent.hash);
      const deadline = Date.now() + 20_000;
      while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        result = await this.server.getTransaction(sent.hash);
      }
      console.log(`[${this.label}] trustline ${this.asset} establecido → ${this.ownerAddress}`);
    } catch (err) {
      console.warn(`[${this.label}] ensureTrustline falló: ${(err as Error).message}`);
    }
  }

  async getBalanceBaseUnits(): Promise<bigint> {
    try {
      const acct = await this.horizon.loadAccount(this.signer.publicKey());
      // Activo emitido (USDC) → balance del trustline; sin issuer → balance nativo (XLM).
      const entry =
        this.asset !== 'XLM' && this.assetIssuer
          ? acct.balances.find(
              (b) =>
                'asset_code' in b &&
                b.asset_code === this.asset &&
                b.asset_issuer === this.assetIssuer,
            )
          : acct.balances.find((b) => b.asset_type === 'native');
      const amount = entry ? parseFloat(entry.balance) : 0;
      return BigInt(Math.floor(amount * this.baseUnitsPerToken));
    } catch {
      return 0n; // cuenta inexistente / sin trustline
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
    const info = await this.requireTw().getEscrow(args.escrowId);
    if (!info) return null;
    // El indexer de TW tarda ~30s en reflejar el fondeo (fund); el balance on-chain
    // lo refleja en ~5s. Leemos el balance USDC del contrato escrow vía RPC de Soroban
    // y usamos el mayor → el agente detecta el fondeo rápido (sin esperar al indexer).
    const chainBal = await this.escrowChainBalance(args.escrowId);
    return chainBal > info.amountBaseUnits ? { ...info, amountBaseUnits: chainBal } : info;
  }

  /** Balance USDC del contrato escrow on-chain (vía el SAC del activo), en unidades base. */
  private async escrowChainBalance(escrowId: string): Promise<bigint> {
    if (this.asset === 'XLM' || !this.assetIssuer) return 0n;
    try {
      const sac = new Asset(this.asset, this.assetIssuer).contractId(this.networkPassphrase);
      const source = new Account(this.signer.publicKey(), '0');
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(new Contract(sac).call('balance', nativeToScVal(escrowId, { type: 'address' })))
        .setTimeout(30)
        .build();
      const sim = await this.server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
      const bal = scValToNative(sim.result.retval);
      return typeof bal === 'bigint' ? bal : BigInt(Math.floor(Number(bal ?? 0)));
    } catch {
      return 0n;
    }
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
