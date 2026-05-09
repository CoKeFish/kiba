import express, { type Express, type Request, type Response } from 'express';
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import type { AgentConfig, ProviderHandler } from './types';
import { AgentBazaarProgram } from './program';

const RPC_DEFAULT = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

/**
 * AgentProvider — para agentes que OFRECEN un servicio.
 *
 *   const agent = new AgentProvider({...});
 *   agent.serve(async (req) => ({ ... }));
 *   await agent.bootstrap();   // airdrop si es necesario, registro on-chain
 *   await agent.listen(5001);
 */
export class AgentProvider {
  readonly config: AgentConfig;
  readonly app: Express;
  readonly connection: Connection;
  /** null si PROGRAM_ID no está configurado — el agente sigue sirviendo en modo degradado */
  readonly program: AgentBazaarProgram | null;
  private handler: ProviderHandler | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl ?? RPC_DEFAULT, 'confirmed');

    const programIdStr =
      (typeof config.programId === 'string' ? config.programId : config.programId?.toBase58()) ??
      process.env.PROGRAM_ID;
    if (programIdStr && programIdStr.length >= 32) {
      try {
        this.program = new AgentBazaarProgram(new PublicKey(programIdStr), this.connection);
      } catch (e) {
        console.warn(`[${config.service}] PROGRAM_ID inválido, modo degradado:`, (e as Error).message);
        this.program = null;
      }
    } else {
      console.warn(
        `[${config.service}] PROGRAM_ID no configurado — modo degradado (sin verificación on-chain)`,
      );
      this.program = null;
    }

    this.app = express();
    this.app.use(express.json());

    this.app.post('/service', this.handleRequest.bind(this));

    this.app.get('/manifest', (_req, res) => {
      res.json({
        service: config.service,
        pricePerCall: config.pricePerCall,
        description: config.description,
        endpoint: config.endpoint,
        ownerWallet: config.wallet.publicKey.toBase58(),
        acceptedToken: 'SOL', // Phase 2: SOL en hackathon, USDC en prod
      });
    });

    this.app.get('/health', (_req, res) => {
      res.json({ ok: true, service: config.service });
    });
  }

  serve<TReq, TRes>(handler: ProviderHandler<TReq, TRes>) {
    this.handler = handler as ProviderHandler;
    return this;
  }

  /**
   * Asegura que el agente:
   *  1. Tiene SOL para pagar gas (auto-airdrop si balance < 0.5 SOL)
   *  2. Está registrado on-chain (registra si no existe)
   */
  async bootstrap(): Promise<void> {
    const wallet = this.config.wallet;

    // Sin program → no necesitamos SOL ni registro on-chain
    if (!this.program) {
      console.log(`[${this.config.service}] skip bootstrap (PROGRAM_ID no configurado)`);
      return;
    }

    // 1. Balance check + airdrop (single attempt, fail-fast)
    const balance = await this.connection.getBalance(wallet.publicKey);
    const minBalance = 0.5 * 1e9;
    if (balance < minBalance) {
      try {
        const sig = await this.connection.requestAirdrop(wallet.publicKey, 2 * 1e9);
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        await Promise.race([
          this.connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            'confirmed',
          ),
          new Promise((_, rej) => setTimeout(() => rej(new Error('airdrop timeout')), 15_000)),
        ]);
        console.log(`[${this.config.service}] airdropped 2 SOL → ${wallet.publicKey.toBase58()}`);
      } catch (e) {
        console.warn(`[${this.config.service}] airdrop failed (rate limit?):`, (e as Error).message);
        console.warn(`[${this.config.service}] funda manualmente: solana airdrop 2 ${wallet.publicKey.toBase58()}`);
      }
    }

    // 2. Registro on-chain
    const existing = await this.program.fetchAgent(this.config.service);
    if (existing) {
      console.log(
        `[${this.config.service}] ya registrado on-chain (owner: ${existing.owner.toBase58()})`,
      );
      return;
    }

    const ix = this.program.registerAgentInstr({
      owner: wallet.publicKey,
      service: this.config.service,
      pricePerCall: BigInt(Math.floor(this.config.pricePerCall * 1e9)),
      endpoint: this.config.endpoint ?? '',
      description: this.config.description ?? '',
    });
    const sig = await this.program.sendAndConfirm([ix], wallet);
    console.log(`[${this.config.service}] registrado on-chain: ${sig}`);
  }

  async listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, '0.0.0.0', () => {
        console.log(
          `[${this.config.service}] live on :${port} (${this.config.pricePerCall} SOL/call)`,
        );
        resolve();
      });
    });
  }

  // ─── handler con verificación x402 ──────────────────────────

  private async handleRequest(req: Request, res: Response): Promise<void> {
    if (!this.handler) {
      res.status(500).json({ error: 'service handler not configured' });
      return;
    }

    const paymentHeader = req.header('X-PAYMENT');

    // Sin pago → devolver 402 con quote
    if (!paymentHeader) {
      const nonce = generateNonce();
      const expectedAmount = BigInt(Math.floor(this.config.pricePerCall * 1e9));
      res.status(402).json({
        amount: expectedAmount.toString(),
        payTo: this.config.wallet.publicKey.toBase58(),
        asset: 'SOL',
        service: this.config.service,
        nonce: nonce.toString(),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      });
      return;
    }

    // Con pago → parsearlo y verificarlo on-chain
    let parsed: { signature: string; nonce: string; clientWallet: string };
    try {
      parsed = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    } catch {
      res.status(400).json({ error: 'invalid X-PAYMENT header (must be base64 JSON)' });
      return;
    }

    try {
      // Sin program → modo degradado: aceptar el pago sin verificar on-chain (Phase 1)
      if (!this.program) {
        const result = await this.handler(req.body);
        res.json({
          ...((typeof result === 'object' && result !== null) ? result : { result }),
          _payment: { claimed: false, mode: 'degraded-no-onchain-verification' },
        });
        return;
      }

      // Verifica que el escrow existe on-chain con el monto esperado
      const escrow = await this.program.fetchEscrow(
        new PublicKey(parsed.clientWallet),
        this.config.wallet.publicKey,
        BigInt(parsed.nonce),
      );
      if (!escrow) {
        res.status(402).json({ error: 'escrow not found on-chain' });
        return;
      }
      if (escrow.state !== 'Pending') {
        res.status(402).json({ error: `escrow already ${escrow.state.toLowerCase()}` });
        return;
      }
      const expected = BigInt(Math.floor(this.config.pricePerCall * 1e9));
      if (escrow.amount < expected) {
        res.status(402).json({
          error: `escrow amount ${escrow.amount} below price ${expected}`,
        });
        return;
      }

      // Pago verificado → ejecutar el servicio
      const result = await this.handler(req.body);

      // Después de servir → claim del pago
      const claimIx = this.program.claimPaymentInstr({
        client: new PublicKey(parsed.clientWallet),
        agentOwner: this.config.wallet.publicKey,
        nonce: BigInt(parsed.nonce),
        service: this.config.service,
      });
      const claimSig = await this.program.sendAndConfirm([claimIx], this.config.wallet);

      res.json({
        ...((typeof result === 'object' && result !== null) ? result : { result }),
        _payment: {
          claimed: true,
          signature: claimSig,
          amount: escrow.amount.toString(),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  }
}

function generateNonce(): bigint {
  // u64 nonce — combina timestamp + random
  const ts = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * 1_000_000));
  return (ts << 20n) | rand;
}
