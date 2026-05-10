import axios, { type AxiosError } from 'axios';
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import type { AgentConfig, CallOptions, ServiceManifest, X402Quote } from './types';
import { AgentBazaarProgram } from './program';

const RPC_DEFAULT = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

/**
 * Trace de cada paso del handshake x402.
 * Útil para inspección/UI: el dashboard renderiza este array como timeline.
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
      quote: {
        amount: string;
        payTo: string;
        asset: string;
        nonce: string;
        expiresAt: number;
      };
      durationMs: number;
      timestamp: number;
    }
  | {
      type: 'escrow_opened';
      signature: string;
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
 * AgentClient — para agentes que CONSUMEN un servicio.
 *
 *   const client = new AgentClient({ wallet: myKeypair });
 *   await client.bootstrap();  // airdrop si es necesario
 *   const result = await client.call('yield-hunter', { token: 'USDC' });
 */
export class AgentClient {
  readonly wallet: Keypair;
  readonly connection: Connection;
  readonly program: AgentBazaarProgram | null;

  constructor(config: Pick<AgentConfig, 'wallet' | 'rpcUrl' | 'programId'>) {
    this.wallet = config.wallet;
    this.connection = new Connection(config.rpcUrl ?? RPC_DEFAULT, 'confirmed');

    const programIdStr =
      (typeof config.programId === 'string' ? config.programId : config.programId?.toBase58()) ??
      process.env.PROGRAM_ID;
    if (programIdStr && programIdStr.length >= 32) {
      try {
        this.program = new AgentBazaarProgram(new PublicKey(programIdStr), this.connection);
      } catch (e) {
        console.warn('[client] PROGRAM_ID inválido, modo degradado:', (e as Error).message);
        this.program = null;
      }
    } else {
      console.warn('[client] PROGRAM_ID no configurado — modo degradado');
      this.program = null;
    }
  }

  /**
   * Pre-quote: hace un probe (POST sin pago) para obtener el precio real
   * que el agente cobrará por este payload específico.
   *
   * Útil para callers que necesitan saber el monto antes del handshake completo
   * (ej. el gateway debita USD del user antes de mover SOL on-chain).
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
        // Modo legacy: el agente respondió 200 directo, sin paywall.
        // Sintetizamos un quote a partir del manifest.
        quote = {
          amount: String(Math.floor(manifest.pricePerCall * 1e9)),
          payTo: manifest.ownerWallet,
          asset: 'SOL',
          service: manifest.service,
          nonce: '0',
          expiresAt: 0,
        };
      } else {
        throw new Error(`expected 402, got ${probe.status}: ${JSON.stringify(probe.data)}`);
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
    if (!this.program) {
      console.log('[client] skip bootstrap (PROGRAM_ID no configurado)');
      return;
    }
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    if (balance < 0.5 * 1e9) {
      try {
        const sig = await this.connection.requestAirdrop(this.wallet.publicKey, 2 * 1e9);
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        await Promise.race([
          this.connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            'confirmed',
          ),
          new Promise((_, rej) => setTimeout(() => rej(new Error('airdrop timeout')), 15_000)),
        ]);
        console.log(`[client] airdropped 2 SOL → ${this.wallet.publicKey.toBase58()}`);
      } catch (e) {
        console.warn('[client] airdrop failed (rate limit?):', (e as Error).message);
        console.warn(`[client] funda manualmente: solana airdrop 2 ${this.wallet.publicKey.toBase58()}`);
      }
    }
  }

  /**
   * Descubre y llama un servicio en el marketplace.
   * Maneja el handshake x402 automáticamente.
   *
   * Wrapper sobre callWithTrace() que descarta el trace para callers que solo
   * necesitan el resultado.
   */
  async call<TRes = unknown>(
    service: string,
    payload: unknown,
    options: CallOptions = {},
  ): Promise<TRes> {
    const { result } = await this.callWithTrace<TRes>(service, payload, options);
    return result;
  }

  /**
   * Igual que call() pero también devuelve el trace de cada paso del handshake
   * x402 (con timestamps + signatures). El dashboard usa esto para renderizar
   * el flujo del 402 → escrow → service → claim como timeline visual.
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
      throw new Error(`service '${service}' not in allowlist`);
    }
    if (options.maxPrice !== undefined && manifest.pricePerCall > options.maxPrice) {
      throw new Error(
        `service '${service}' costs ${manifest.pricePerCall} SOL, exceeds maxPrice ${options.maxPrice}`,
      );
    }

    // 1) Probe → esperamos 402 con quote
    const tProbe = performance.now();
    let quote: X402Quote;
    try {
      const probe = await axios.post(`${manifest.endpoint}/service`, payload, {
        timeout: options.timeoutMs ?? 30_000,
        validateStatus: () => true,
      });
      if (probe.status !== 402) {
        if (probe.status >= 200 && probe.status < 300) {
          // Modo legacy / sin paywall — devolvemos el resultado pero el trace queda parcial.
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
        throw new Error(`unexpected status ${probe.status}: ${JSON.stringify(probe.data)}`);
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
        asset: String(quote.asset ?? 'SOL'),
        nonce: String(quote.nonce),
        expiresAt: Number(quote.expiresAt ?? 0),
      },
      durationMs: stepStart(tProbe),
      timestamp: Date.now(),
    });

    // 2) Abrir escrow on-chain
    const tEscrow = performance.now();
    let escrowSig = 'NO_ONCHAIN_PROGRAM_ID';
    if (this.program) {
      const agentOwner = new PublicKey(quote.payTo);
      const [agentPda] = (
        await import('./anchor-helpers')
      ).getAgentPda(this.program.programId, manifest.service);

      const ix = this.program.openEscrowInstr({
        client: this.wallet.publicKey,
        agent: agentPda,
        agentOwner,
        nonce: BigInt(quote.nonce),
        amount: BigInt(quote.amount),
      });
      escrowSig = await this.program.sendAndConfirm([ix], this.wallet);
    }
    steps.push({
      type: 'escrow_opened',
      signature: escrowSig,
      amount: String(quote.amount),
      nonce: String(quote.nonce),
      durationMs: stepStart(tEscrow),
      timestamp: Date.now(),
    });

    // 3) Construir X-PAYMENT header
    const paymentHeader = Buffer.from(
      JSON.stringify({
        signature: escrowSig,
        nonce: quote.nonce,
        clientWallet: this.wallet.publicKey.toBase58(),
      }),
      'utf8',
    ).toString('base64');

    // 4) Reintentar con el header → el agente verifica + ejecuta + claim
    const tFinal = performance.now();
    const final = await axios.post(`${manifest.endpoint}/service`, payload, {
      headers: { 'X-PAYMENT': paymentHeader },
      timeout: options.timeoutMs ?? 30_000,
    });
    const responsePayment = (final.data as { _payment?: { signature?: string; amount?: string } })
      ?._payment;
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
   * Descubre un servicio. Phase 2: lee directamente del registry on-chain
   * con fallback al backend de descubrimiento.
   */
  async discover(service: string): Promise<ServiceManifest> {
    // Primero intenta on-chain (si hay program)
    if (this.program) {
      const onChain = await this.program.fetchAgent(service);
      if (onChain) {
        return {
          service: onChain.service,
          pricePerCall: Number(onChain.pricePerCall) / 1e9,
          description: onChain.description,
          endpoint: onChain.endpoint,
          ownerWallet: onChain.owner.toBase58(),
          acceptedToken: 'SOL',
        };
      }
    }

    // Fallback: backend
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
    const resp = await axios.get<ServiceManifest>(`${backendUrl}/agents/${service}`);
    return resp.data;
  }
}
