import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentBazaar } from "../target/types/agent_bazaar";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("agent-bazaar", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.AgentBazaar as Program<AgentBazaar>;

  // Wallets
  const agentOwner = Keypair.generate();
  const client = Keypair.generate();

  // Helpers
  const agentPda = (service: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), Buffer.from(service)],
      program.programId,
    )[0];

  const escrowPda = (clientPk: PublicKey, agentOwnerPk: PublicKey, nonce: BN) => {
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(nonce.toString()), 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), clientPk.toBuffer(), agentOwnerPk.toBuffer(), nonceBuf],
      program.programId,
    )[0];
  };

  const SERVICE = "test-service";
  const PRICE = new BN(0.01 * LAMPORTS_PER_SOL); // 10M lamports
  const ENDPOINT = "http://localhost:5000";
  const DESCRIPTION = "test agent for unit tests";

  before(async () => {
    // Fund agentOwner and client
    for (const kp of [agentOwner, client]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("register_agent crea la PDA con los datos correctos", async () => {
    const pda = agentPda(SERVICE);

    await program.methods
      .registerAgent(SERVICE, PRICE, ENDPOINT, DESCRIPTION)
      .accounts({
        agent: pda,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    const acct = await program.account.agent.fetch(pda);
    expect(acct.owner.toBase58()).to.equal(agentOwner.publicKey.toBase58());
    expect(acct.service).to.equal(SERVICE);
    expect(acct.pricePerCall.toString()).to.equal(PRICE.toString());
    expect(acct.endpoint).to.equal(ENDPOINT);
    expect(acct.description).to.equal(DESCRIPTION);
    expect(acct.totalCalls.toNumber()).to.equal(0);
    expect(acct.totalEarned.toNumber()).to.equal(0);
  });

  it("update_agent cambia el precio y la descripción", async () => {
    const pda = agentPda(SERVICE);
    const newPrice = new BN(0.02 * LAMPORTS_PER_SOL);
    const newDesc = "updated description";

    await program.methods
      .updateAgent(newPrice, null, newDesc)
      .accounts({
        agent: pda,
        owner: agentOwner.publicKey,
      } as any)
      .signers([agentOwner])
      .rpc();

    const acct = await program.account.agent.fetch(pda);
    expect(acct.pricePerCall.toString()).to.equal(newPrice.toString());
    expect(acct.description).to.equal(newDesc);
    expect(acct.endpoint).to.equal(ENDPOINT); // sin cambios
  });

  it("open_escrow + claim_payment hacen el flow completo y mueven los lamports", async () => {
    const pda = agentPda(SERVICE);
    const nonce = new BN(1);
    const escrow = escrowPda(client.publicKey, agentOwner.publicKey, nonce);
    const amount = new BN(0.05 * LAMPORTS_PER_SOL);

    const ownerBalBefore = await provider.connection.getBalance(agentOwner.publicKey);

    // open_escrow
    await program.methods
      .openEscrow(nonce, amount)
      .accounts({
        agent: pda,
        escrow,
        client: client.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([client])
      .rpc();

    const escrowAcct = await program.account.escrow.fetch(escrow);
    expect(escrowAcct.client.toBase58()).to.equal(client.publicKey.toBase58());
    expect(escrowAcct.amount.toString()).to.equal(amount.toString());
    expect(escrowAcct.state).to.deep.equal({ pending: {} });

    // claim_payment
    await program.methods
      .claimPayment()
      .accounts({
        escrow,
        agent: pda,
        agentOwner: agentOwner.publicKey,
      } as any)
      .signers([agentOwner])
      .rpc();

    const ownerBalAfter = await provider.connection.getBalance(agentOwner.publicKey);
    const delta = ownerBalAfter - ownerBalBefore;
    // Owner pagó fees por el claim, así que delta = amount - fees. Verificar > 90% del amount.
    expect(delta).to.be.greaterThan(Number(amount) * 0.9);

    const escrowAfter = await program.account.escrow.fetch(escrow);
    expect(escrowAfter.state).to.deep.equal({ completed: {} });

    const agent = await program.account.agent.fetch(pda);
    expect(agent.totalCalls.toNumber()).to.equal(1);
    expect(agent.totalEarned.toString()).to.equal(amount.toString());
  });

  it("refund_escrow falla si se llama antes de los 5 minutos (RefundTooEarly)", async () => {
    const pda = agentPda(SERVICE);
    const nonce = new BN(2);
    const escrow = escrowPda(client.publicKey, agentOwner.publicKey, nonce);
    const amount = new BN(0.03 * LAMPORTS_PER_SOL);

    await program.methods
      .openEscrow(nonce, amount)
      .accounts({
        agent: pda,
        escrow,
        client: client.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([client])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .refundEscrow()
        .accounts({
          escrow,
          client: client.publicKey,
        } as any)
        .signers([client])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.include("RefundTooEarly");
    }
    expect(threw, "refund debió fallar antes de la ventana").to.equal(true);
  });

  it("open_escrow rechaza un amount menor al precio del agente (AmountBelowPrice)", async () => {
    const pda = agentPda(SERVICE);
    const nonce = new BN(3);
    const escrow = escrowPda(client.publicKey, agentOwner.publicKey, nonce);
    // El precio actual es 0.02 SOL (lo seteamos en update). Mandamos 0.001.
    const tooLittle = new BN(0.001 * LAMPORTS_PER_SOL);

    let threw = false;
    try {
      await program.methods
        .openEscrow(nonce, tooLittle)
        .accounts({
          agent: pda,
          escrow,
          client: client.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([client])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.include("AmountBelowPrice");
    }
    expect(threw, "open_escrow debió rechazar amount < price").to.equal(true);
  });

  it("deregister_agent cierra la PDA y devuelve el rent", async () => {
    const pda = agentPda(SERVICE);
    const ownerBalBefore = await provider.connection.getBalance(agentOwner.publicKey);

    await program.methods
      .deregisterAgent()
      .accounts({
        agent: pda,
        owner: agentOwner.publicKey,
      } as any)
      .signers([agentOwner])
      .rpc();

    // La cuenta debería haberse cerrado
    const acctInfo = await provider.connection.getAccountInfo(pda);
    expect(acctInfo).to.equal(null);

    // El owner debería haber recibido los lamports del rent (~0.003 SOL para Agent)
    const ownerBalAfter = await provider.connection.getBalance(agentOwner.publicKey);
    expect(ownerBalAfter).to.be.greaterThan(ownerBalBefore);
  });
});
