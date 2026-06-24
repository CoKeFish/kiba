/**
 * KibaProgram — cliente high-level del programa Anchor.
 *
 * Construye instrucciones, deriva PDAs, decodifica accounts.
 * No depende del IDL — encoders manuales en anchor-helpers.ts.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Keypair,
} from '@solana/web3.js';
import {
  ACCOUNT_DISCRIMINATORS,
  INSTR_DISCRIMINATORS,
  PLATFORM_TREASURY,
  decodeAgent,
  decodeEscrow,
  encodeOptionString,
  encodeOptionU64,
  encodeString,
  encodeU64,
  getAgentPda,
  getEscrowPda,
  type AgentAccount,
  type EscrowAccount,
} from './anchor-helpers';

export class KibaProgram {
  readonly programId: PublicKey;
  readonly connection: Connection;

  constructor(programId: PublicKey | string, connection: Connection) {
    this.programId = typeof programId === 'string' ? new PublicKey(programId) : programId;
    this.connection = connection;
  }

  // ─── Builders de instrucciones ──────────────────────────────

  registerAgentInstr(args: {
    owner: PublicKey;
    service: string;
    pricePerCall: bigint | number;
    endpoint: string;
    description: string;
  }): TransactionInstruction {
    const [agentPda] = getAgentPda(this.programId, args.service);

    const data = Buffer.concat([
      INSTR_DISCRIMINATORS.registerAgent(),
      encodeString(args.service),
      encodeU64(args.pricePerCall),
      encodeString(args.endpoint),
      encodeString(args.description),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: agentPda, isSigner: false, isWritable: true },
        { pubkey: args.owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  updateAgentInstr(args: {
    owner: PublicKey;
    service: string;
    pricePerCall?: bigint | number | null;
    endpoint?: string | null;
    description?: string | null;
  }): TransactionInstruction {
    const [agentPda] = getAgentPda(this.programId, args.service);
    const data = Buffer.concat([
      INSTR_DISCRIMINATORS.updateAgent(),
      encodeOptionU64(args.pricePerCall),
      encodeOptionString(args.endpoint),
      encodeOptionString(args.description),
    ]);
    return new TransactionInstruction({
      keys: [
        { pubkey: agentPda, isSigner: false, isWritable: true },
        { pubkey: args.owner, isSigner: true, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  deregisterAgentInstr(args: {
    owner: PublicKey;
    service: string;
  }): TransactionInstruction {
    const [agentPda] = getAgentPda(this.programId, args.service);
    return new TransactionInstruction({
      keys: [
        { pubkey: agentPda, isSigner: false, isWritable: true },
        { pubkey: args.owner, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data: Buffer.from(INSTR_DISCRIMINATORS.deregisterAgent()),
    });
  }

  openEscrowInstr(args: {
    client: PublicKey;
    agent: PublicKey;
    agentOwner: PublicKey;
    nonce: bigint | number;
    amount: bigint | number;
  }): TransactionInstruction {
    const [escrowPda] = getEscrowPda(
      this.programId,
      args.client,
      args.agentOwner,
      args.nonce,
    );

    const data = Buffer.concat([
      INSTR_DISCRIMINATORS.openEscrow(),
      encodeU64(args.nonce),
      encodeU64(args.amount),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: args.agent, isSigner: false, isWritable: false },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: args.client, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  claimPaymentInstr(args: {
    client: PublicKey;
    agentOwner: PublicKey;
    nonce: bigint | number;
    service: string;
    /** Override de la treasury — por defecto usa PLATFORM_TREASURY del contrato. */
    platformTreasury?: PublicKey;
  }): TransactionInstruction {
    const [escrowPda] = getEscrowPda(this.programId, args.client, args.agentOwner, args.nonce);
    const [agentPda] = getAgentPda(this.programId, args.service);
    const treasury = args.platformTreasury ?? PLATFORM_TREASURY;

    return new TransactionInstruction({
      keys: [
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: agentPda, isSigner: false, isWritable: true },
        { pubkey: args.agentOwner, isSigner: true, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: Buffer.from(INSTR_DISCRIMINATORS.claimPayment()),
    });
  }

  refundEscrowInstr(args: {
    client: PublicKey;
    agentOwner: PublicKey;
    nonce: bigint | number;
  }): TransactionInstruction {
    const [escrowPda] = getEscrowPda(this.programId, args.client, args.agentOwner, args.nonce);
    return new TransactionInstruction({
      keys: [
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: args.client, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data: Buffer.from(INSTR_DISCRIMINATORS.refundEscrow()),
    });
  }

  // ─── Senders (firman + envían + esperan confirmación) ───────

  async sendAndConfirm(
    instructions: TransactionInstruction[],
    payer: Keypair,
    extraSigners: Keypair[] = [],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([payer, ...extraSigners]);
    const sig = await this.connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    await this.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  }

  // ─── Account fetchers ──────────────────────────────────────

  async fetchAgent(service: string): Promise<AgentAccount | null> {
    const [pda] = getAgentPda(this.programId, service);
    const acc = await this.connection.getAccountInfo(pda, 'confirmed');
    if (!acc) return null;
    return decodeAgent(acc.data);
  }

  async fetchAllAgents(): Promise<{ pda: PublicKey; data: AgentAccount }[]> {
    const disc = ACCOUNT_DISCRIMINATORS.agent();
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: 0, bytes: disc.toString('base64'), encoding: 'base64' } }],
    });
    return accounts.map((a) => ({ pda: a.pubkey, data: decodeAgent(a.account.data) }));
  }

  async fetchEscrow(
    client: PublicKey,
    agentOwner: PublicKey,
    nonce: bigint | number,
  ): Promise<EscrowAccount | null> {
    const [pda] = getEscrowPda(this.programId, client, agentOwner, nonce);
    const acc = await this.connection.getAccountInfo(pda, 'confirmed');
    if (!acc) return null;
    return decodeEscrow(acc.data);
  }

  async fetchEscrowByPda(pda: PublicKey): Promise<EscrowAccount | null> {
    const acc = await this.connection.getAccountInfo(pda, 'confirmed');
    if (!acc) return null;
    return decodeEscrow(acc.data);
  }
}
