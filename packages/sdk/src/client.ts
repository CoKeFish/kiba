import axios, { type AxiosError } from 'axios';
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import type { AgentConfig, CallOptions, ServiceManifest, X402Quote } from './types';
import { AgentBazaarProgram } from './program';

const RPC_DEFAULT = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

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
   */
  async call<TRes = unknown>(
    service: string,
    payload: unknown,
    options: CallOptions = {},
  ): Promise<TRes> {
    const manifest = await this.discover(service);

    if (options.allowlist && !options.allowlist.includes(service)) {
      throw new Error(`service '${service}' not in allowlist`);
    }
    if (options.maxPrice !== undefined && manifest.pricePerCall > options.maxPrice) {
      throw new Error(
        `service '${service}' costs ${manifest.pricePerCall} SOL, exceeds maxPrice ${options.maxPrice}`,
      );
    }

    // 1) Probe → esperamos 402 con quote
    let quote: X402Quote;
    try {
      const probe = await axios.post(`${manifest.endpoint}/service`, payload, {
        timeout: options.timeoutMs ?? 30_000,
        validateStatus: () => true, // no tirar excepción por 402
      });
      if (probe.status !== 402) {
        // Si responde 200 directo, devolverlo (modo legacy / sin paywall)
        if (probe.status >= 200 && probe.status < 300) return probe.data as TRes;
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

    // 2) Abrir escrow on-chain (firma + envía + espera confirm)
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

    // 3) Construir X-PAYMENT header con prueba del pago
    const paymentHeader = Buffer.from(
      JSON.stringify({
        signature: escrowSig,
        nonce: quote.nonce,
        clientWallet: this.wallet.publicKey.toBase58(),
      }),
      'utf8',
    ).toString('base64');

    // 4) Reintentar con el header
    const final = await axios.post(`${manifest.endpoint}/service`, payload, {
      headers: { 'X-PAYMENT': paymentHeader },
      timeout: options.timeoutMs ?? 30_000,
    });
    return final.data as TRes;
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
