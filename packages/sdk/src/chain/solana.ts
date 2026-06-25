/**
 * SolanaChainClient — implementación de ChainClient sobre Solana.
 *
 * Concentra TODO el acoplamiento a Solana que antes vivía disperso en
 * client.ts y provider.ts: Connection, airdrop, PDAs, instr builders y
 * sendAndConfirm. El resto del SDK ya no importa @solana/web3.js para operar
 * la cadena — habla con la interfaz ChainClient.
 */
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import { KibaProgram } from '../program';
import { getAgentPda } from '../anchor-helpers';
import type {
  ChainClient,
  ChainAgentInfo,
  ChainEscrowInfo,
  RegisterAgentArgs,
  UpdateAgentArgs,
  OpenEscrowArgs,
  FetchEscrowArgs,
  ClaimPaymentArgs,
  RefundEscrowArgs,
} from './types';

const LAMPORTS_PER_SOL = 1e9;

export class SolanaChainClient implements ChainClient {
  readonly asset = 'SOL' as const;
  readonly baseUnitsPerToken = LAMPORTS_PER_SOL;

  private readonly connection: Connection;
  private readonly program: KibaProgram;
  private readonly wallet: Keypair;
  private readonly label: string;

  constructor(args: {
    connection: Connection;
    program: KibaProgram;
    wallet: Keypair;
    /** Prefijo para los logs (ej. 'client' o el nombre del servicio). */
    label?: string;
  }) {
    this.connection = args.connection;
    this.program = args.program;
    this.wallet = args.wallet;
    this.label = args.label ?? 'chain';
  }

  get ownerAddress(): string {
    return this.wallet.publicKey.toBase58();
  }

  async ensureFunds(minToken: number, topUpToken: number): Promise<void> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    if (balance >= minToken * LAMPORTS_PER_SOL) return;
    try {
      const sig = await this.connection.requestAirdrop(
        this.wallet.publicKey,
        topUpToken * LAMPORTS_PER_SOL,
      );
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      await Promise.race([
        this.connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          'confirmed',
        ),
        new Promise((_, rej) => setTimeout(() => rej(new Error('airdrop timeout')), 15_000)),
      ]);
      console.log(`[${this.label}] airdropped ${topUpToken} SOL → ${this.ownerAddress}`);
    } catch (e) {
      console.warn(`[${this.label}] airdrop failed (rate limit?):`, (e as Error).message);
      console.warn(`[${this.label}] funda manualmente: solana airdrop ${topUpToken} ${this.ownerAddress}`);
    }
  }

  async getBalanceBaseUnits(): Promise<bigint> {
    return BigInt(await this.connection.getBalance(this.wallet.publicKey, 'confirmed'));
  }

  async fetchAgent(service: string): Promise<ChainAgentInfo | null> {
    const onChain = await this.program.fetchAgent(service);
    if (!onChain) return null;
    return {
      service: onChain.service,
      pricePerCallBaseUnits: BigInt(onChain.pricePerCall),
      description: onChain.description,
      endpoint: onChain.endpoint,
      ownerAddress: onChain.owner.toBase58(),
      createdAt: BigInt(onChain.createdAt),
    };
  }

  async registerAgent(args: RegisterAgentArgs): Promise<string> {
    const ix = this.program.registerAgentInstr({
      owner: this.wallet.publicKey,
      service: args.service,
      pricePerCall: args.pricePerCallBaseUnits,
      endpoint: args.endpoint,
      description: args.description,
    });
    return this.program.sendAndConfirm([ix], this.wallet);
  }

  async updateAgent(args: UpdateAgentArgs): Promise<string> {
    const ix = this.program.updateAgentInstr({
      owner: this.wallet.publicKey,
      service: args.service,
      pricePerCall: args.pricePerCallBaseUnits ?? null,
      endpoint: args.endpoint ?? null,
      description: args.description ?? null,
    });
    return this.program.sendAndConfirm([ix], this.wallet);
  }

  async openEscrow(args: OpenEscrowArgs): Promise<string> {
    const agentOwner = new PublicKey(args.payToAddress);
    const [agentPda] = getAgentPda(this.program.programId, args.service);
    const ix = this.program.openEscrowInstr({
      client: this.wallet.publicKey,
      agent: agentPda,
      agentOwner,
      nonce: args.nonce,
      amount: args.amountBaseUnits,
    });
    return this.program.sendAndConfirm([ix], this.wallet);
  }

  async fetchEscrow(args: FetchEscrowArgs): Promise<ChainEscrowInfo | null> {
    const escrow = await this.program.fetchEscrow(
      new PublicKey(args.clientAddress),
      this.wallet.publicKey,
      args.nonce,
    );
    if (!escrow) return null;
    return {
      amountBaseUnits: BigInt(escrow.amount),
      state: escrow.state,
    };
  }

  async claimPayment(args: ClaimPaymentArgs): Promise<string> {
    const ix = this.program.claimPaymentInstr({
      client: new PublicKey(args.clientAddress),
      agentOwner: this.wallet.publicKey,
      nonce: args.nonce,
      service: args.service,
    });
    return this.program.sendAndConfirm([ix], this.wallet);
  }

  async refundEscrow(_args: RefundEscrowArgs): Promise<string> {
    // Esta versión es Stellar-only. El programa Anchor soporta refund_escrow on-chain,
    // pero el wiring del refund vía SDK para Solana es un follow-up (no se usa aquí).
    throw new Error('[solana] refundEscrow no implementado (versión Stellar-only)');
  }
}
