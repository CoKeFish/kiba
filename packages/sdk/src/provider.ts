import express, { type Express, type Request, type Response } from 'express';
import type { AgentConfig, ProviderHandler } from './types';
import { createChainClient, type ChainClient } from './chain';

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
  /** null si no hay cadena configurada — el agente sigue sirviendo en modo degradado */
  readonly chain: ChainClient | null;
  private handler: ProviderHandler | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.chain = createChainClient({
      wallet: config.wallet,
      rpcUrl: config.rpcUrl,
      programId: config.programId,
      label: config.service,
    });

    this.app = express();
    this.app.use(express.json());

    this.app.post('/service', this.handleRequest.bind(this));

    this.app.get('/manifest', (_req, res) => {
      res.json({
        service: config.service,
        pricePerCall: config.pricePerCall,
        dynamicPricing: !!config.priceFn,
        pricingNote: config.pricingNote,
        description: config.description,
        endpoint: config.endpoint,
        ownerWallet: config.wallet.publicKey.toBase58(),
        acceptedToken: this.asset,
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
   * Unidades base por token de la cadena activa (lamports/SOL, stroops/XLM…).
   * En modo degradado (sin cadena) cae a 1e9 (SOL), preservando el comportamiento
   * histórico. Toda conversión de precio decimal → on-chain pasa por aquí.
   */
  private get baseUnitsPerToken(): number {
    return this.chain?.baseUnitsPerToken ?? 1e9;
  }

  /** Símbolo del activo de la cadena activa. 'SOL' por defecto en modo degradado. */
  private get asset(): 'SOL' | 'USDC' | 'XLM' {
    return this.chain?.asset ?? 'SOL';
  }

  /**
   * Asegura que el agente:
   *  1. Tiene SOL para pagar gas (auto-airdrop si balance < 0.5 SOL)
   *  2. Está registrado on-chain (registra si no existe)
   */
  async bootstrap(): Promise<void> {
    // Sin cadena → no necesitamos fondos ni registro on-chain
    if (!this.chain) {
      console.log(`[${this.config.service}] skip bootstrap (PROGRAM_ID no configurado)`);
      return;
    }

    // 1. Asegurar fondos para fees (recarga si el saldo < 0.5)
    await this.chain.ensureFunds(0.5, 2);

    const expectedPrice = BigInt(
      Math.floor(this.config.pricePerCall * this.chain.baseUnitsPerToken),
    );

    // 2. Registro on-chain (o reconcilia config si ya existe)
    const existing = await this.chain.fetchAgent(this.config.service);
    if (existing) {
      const priceDrift = existing.pricePerCallBaseUnits !== expectedPrice;
      const descDrift = (existing.description ?? '') !== (this.config.description ?? '');
      const endpointDrift = (existing.endpoint ?? '') !== (this.config.endpoint ?? '');

      if (priceDrift || descDrift || endpointDrift) {
        // Importante para pricing dinámico: el contrato valida amount >= price_per_call.
        // Si el config bajó el floor para usar priceFn, el on-chain debe reflejarlo o
        // open_escrow rechazará por AmountBelowPrice.
        console.log(
          `[${this.config.service}] config drift detected → updating on-chain (price=${priceDrift}, desc=${descDrift}, endpoint=${endpointDrift})`,
        );
        const sig = await this.chain.updateAgent({
          service: this.config.service,
          pricePerCallBaseUnits: priceDrift ? expectedPrice : null,
          description: descDrift ? this.config.description ?? '' : null,
          endpoint: endpointDrift ? this.config.endpoint ?? '' : null,
        });
        console.log(`[${this.config.service}] updated on-chain: ${sig}`);
      } else {
        console.log(
          `[${this.config.service}] ya registrado on-chain (owner: ${existing.ownerAddress})`,
        );
      }
      return;
    }

    const sig = await this.chain.registerAgent({
      service: this.config.service,
      pricePerCallBaseUnits: expectedPrice,
      endpoint: this.config.endpoint ?? '',
      description: this.config.description ?? '',
    });
    console.log(`[${this.config.service}] registrado on-chain: ${sig}`);
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

  // ─── handler con verificación x402 ──────────────────────────

  /**
   * Computa cuántas unidades base del activo cobrar por una request específica.
   * - Si `priceFn` está definido: lo invoca con el payload, eleva al floor si fuera menor
   * - Si no: usa siempre `pricePerCall` (modelo flat)
   *
   * El precio decimal se convierte a unidades base según la cadena activa
   * (`baseUnitsPerToken`): lamports en Solana, stroops en Stellar.
   *
   * El piso garantiza que el on-chain `open_escrow` (que valida amount >= price_per_call
   * del registry) nunca rechace por una mala configuración del priceFn.
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

  private async handleRequest(req: Request, res: Response): Promise<void> {
    if (!this.handler) {
      res.status(500).json({ error: 'service handler not configured' });
      return;
    }

    const paymentHeader = req.header('X-PAYMENT');

    // Sin pago → devolver 402 con quote (eventualmente dinámico)
    if (!paymentHeader) {
      const nonce = generateNonce();
      const expectedAmount = await this.computeAmountBaseUnits(req.body);
      res.status(402).json({
        amount: expectedAmount.toString(),
        payTo: this.chain?.ownerAddress ?? this.config.wallet.publicKey.toBase58(),
        asset: this.asset,
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
      // Sin cadena → modo degradado: aceptar el pago sin verificar on-chain (Phase 1)
      if (!this.chain) {
        const result = await this.handler(req.body);
        res.json({
          ...((typeof result === 'object' && result !== null) ? result : { result }),
          _payment: { claimed: false, mode: 'degraded-no-onchain-verification' },
        });
        return;
      }

      // Verifica que el escrow existe on-chain con el monto esperado
      const escrow = await this.chain.fetchEscrow({
        clientAddress: parsed.clientWallet,
        nonce: BigInt(parsed.nonce),
      });
      if (!escrow) {
        res.status(402).json({ error: 'escrow not found on-chain' });
        return;
      }
      if (escrow.state !== 'Pending') {
        res.status(402).json({ error: `escrow already ${escrow.state.toLowerCase()}` });
        return;
      }
      // El precio para esta request — debe coincidir con el que cotizamos en el 402.
      // priceFn debe ser determinista en el payload para que el doble cálculo
      // (quote + verify) dé el mismo número.
      const expected = await this.computeAmountBaseUnits(req.body);
      if (escrow.amountBaseUnits < expected) {
        res.status(402).json({
          error: `escrow amount ${escrow.amountBaseUnits} below price ${expected}`,
        });
        return;
      }

      // Pago verificado → ejecutar el servicio
      const result = await this.handler(req.body);

      // Después de servir → claim del pago
      const claimSig = await this.chain.claimPayment({
        clientAddress: parsed.clientWallet,
        nonce: BigInt(parsed.nonce),
        service: this.config.service,
      });

      res.json({
        ...((typeof result === 'object' && result !== null) ? result : { result }),
        _payment: {
          claimed: true,
          signature: claimSig,
          amount: escrow.amountBaseUnits.toString(),
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
