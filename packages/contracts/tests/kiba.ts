import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Kiba } from "../target/types/kiba";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("kiba", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Kiba as Program<Kiba>;

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

  // Debe coincidir con `PLATFORM_TREASURY` en lib.rs (master wallet del Gateway).
  const PLATFORM_TREASURY = new PublicKey("3JcShJD9boEZQhXb515MDfMwX34muLzyQj8QyysKXuEF");
  const PLATFORM_FEE_BPS = 500;
  const BPS_DENOMINATOR = 10_000;
  const computeSplit = (amount: BN) => {
    const fee = amount.muln(PLATFORM_FEE_BPS).divn(BPS_DENOMINATOR);
    return { ownerAmount: amount.sub(fee), platformFee: fee };
  };

  before(async () => {
    // Fund agentOwner and client
    for (const kp of [agentOwner, client]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
    // La treasury también necesita existir on-chain para poder recibir lamports.
    // Si no existe, el primer claim_payment fallará por SystemAccount no-init.
    // En localnet con --reset arranca vacía, así que la fundamos con rent-exempt.
    const treasuryInfo = await provider.connection.getAccountInfo(PLATFORM_TREASURY);
    if (!treasuryInfo) {
      const sig = await provider.connection.requestAirdrop(
        PLATFORM_TREASURY,
        0.01 * LAMPORTS_PER_SOL,
      );
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

  it("open_escrow + claim_payment hacen el flow completo y mueven los lamports con split 95/5", async () => {
    const pda = agentPda(SERVICE);
    const nonce = new BN(1);
    const escrow = escrowPda(client.publicKey, agentOwner.publicKey, nonce);
    const amount = new BN(0.05 * LAMPORTS_PER_SOL);
    const { ownerAmount, platformFee } = computeSplit(amount);

    const ownerBalBefore = await provider.connection.getBalance(agentOwner.publicKey);
    const treasuryBalBefore = await provider.connection.getBalance(PLATFORM_TREASURY);

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

    // claim_payment con la treasury
    await program.methods
      .claimPayment()
      .accounts({
        escrow,
        agent: pda,
        agentOwner: agentOwner.publicKey,
        platformTreasury: PLATFORM_TREASURY,
      } as any)
      .signers([agentOwner])
      .rpc();

    const ownerBalAfter = await provider.connection.getBalance(agentOwner.publicKey);
    const treasuryBalAfter = await provider.connection.getBalance(PLATFORM_TREASURY);

    // Owner pagó tx fee por la firma, así que el delta es ownerAmount - feeTx.
    // Verificamos que sea mayor que ownerAmount - 0.001 SOL (fee razonable).
    const ownerDelta = ownerBalAfter - ownerBalBefore;
    expect(ownerDelta).to.be.greaterThan(Number(ownerAmount) - 1_000_000);
    expect(ownerDelta).to.be.lessThanOrEqual(Number(ownerAmount));

    // La treasury recibe exactamente el fee (no firma, no paga gas).
    const treasuryDelta = treasuryBalAfter - treasuryBalBefore;
    expect(treasuryDelta).to.equal(Number(platformFee));

    const escrowAfter = await program.account.escrow.fetch(escrow);
    expect(escrowAfter.state).to.deep.equal({ completed: {} });

    const agent = await program.account.agent.fetch(pda);
    expect(agent.totalCalls.toNumber()).to.equal(1);
    // total_earned ahora refleja el net del owner, no el bruto.
    expect(agent.totalEarned.toString()).to.equal(ownerAmount.toString());
  });

  it("claim_payment rechaza una treasury distinta a PLATFORM_TREASURY (InvalidTreasury)", async () => {
    const pda = agentPda(SERVICE);
    const nonce = new BN(99);
    const escrow = escrowPda(client.publicKey, agentOwner.publicKey, nonce);
    const amount = new BN(0.05 * LAMPORTS_PER_SOL);

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

    const fakeTreasury = Keypair.generate().publicKey;
    let threw = false;
    try {
      await program.methods
        .claimPayment()
        .accounts({
          escrow,
          agent: pda,
          agentOwner: agentOwner.publicKey,
          platformTreasury: fakeTreasury,
        } as any)
        .signers([agentOwner])
        .rpc();
    } catch (err: any) {
      threw = true;
      // Anchor lanza ConstraintAddress cuando la `address = ...` constraint no matchea.
      expect(err.toString()).to.match(/InvalidTreasury|ConstraintAddress|address/i);
    }
    expect(threw, "claim debió rechazar una treasury falsa").to.equal(true);
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
