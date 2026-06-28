import axios, { type AxiosError, type AxiosResponse } from 'axios';
import { type Keypair } from '@solana/web3.js';
import type { AgentConfig, CallOptions, ServiceManifest, X402Quote } from './types';
import { createChainClient, type ChainClient, type StellarSigner } from './chain';

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
      /** Identidad del escrow (contractId de Trustless Work). */
      escrowId?: string;
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
  /** Keypair local del cliente. Opcional: con `signer` (p.ej. Privy) no hay Keypair. */
  readonly wallet?: Keypair;
  /** Cadena de liquidación. null en modo degradado (sin cadena configurada). */
  readonly chain: ChainClient | null;

  constructor(config: { wallet?: Keypair; signer?: StellarSigner; rpcUrl?: string }) {
    this.wallet = config.wallet;
    this.chain = createChainClient({
      wallet: config.wallet,
      signer: config.signer,
      rpcUrl: config.rpcUrl,
      label: 'client',
    });
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
        // Sintetizamos un quote a partir del manifest, en las unidades de la cadena.
        quote = {
          amount: String(
            Math.floor(manifest.pricePerCall * (this.chain?.baseUnitsPerToken ?? 1e9)),
          ),
          payTo: manifest.ownerWallet,
          asset: manifest.acceptedToken,
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
    if (!this.chain) {
      console.log('[client] skip bootstrap (PROGRAM_ID no configurado)');
      return;
    }
    await this.chain.ensureFunds(0.5, 2);
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

    // Cap autoritativo: valida el PRECIO REAL del 402 (quote.amount), no solo el anunciado
    // (manifest.pricePerCall). Un provider con pricing dinámico podría cotizar por encima.
    if (options.maxPrice !== undefined) {
      const perToken = this.chain?.baseUnitsPerToken ?? 1e9;
      const quotedPrice = Number(quote.amount) / perToken;
      if (quotedPrice > options.maxPrice) {
        throw new Error(
          `service '${service}' quoted ${quotedPrice}, exceeds maxPrice ${options.maxPrice}`,
        );
      }
    }

    // 2) Abrir (deploy+fund) el escrow en Trustless Work
    const tEscrow = performance.now();
    let escrowSig = 'NO_ONCHAIN_PROGRAM_ID';
    let escrowId = '';
    if (this.chain) {
      try {
        const opened = await this.chain.openEscrow({
          service: manifest.service,
          payToAddress: quote.payTo,
          nonce: BigInt(quote.nonce),
          amountBaseUnits: BigInt(quote.amount),
        });
        escrowSig = opened.signature;
        escrowId = opened.escrowId;
      } catch (err) {
        // El deploy/fund del escrow PUDO ejecutarse parcialmente on-chain. Lanzamos un
        // error accionable; si quedó fondeado, se recupera vía disputa en Trustless Work.
        const e = new Error(
          `apertura de escrow para '${service}' (nonce ${quote.nonce}) falló o no confirmó. ` +
            `Si el escrow llegó a fondearse, recupéralo vía el flujo de disputa de Trustless Work. ` +
            `Causa: ${(err as Error).message}`,
        ) as Error & { recoverable: boolean; service: string; nonce: string };
        e.recoverable = true;
        e.service = service;
        e.nonce = String(quote.nonce);
        throw e;
      }
    }
    steps.push({
      type: 'escrow_opened',
      signature: escrowSig,
      escrowId: escrowId || undefined,
      amount: String(quote.amount),
      nonce: String(quote.nonce),
      durationMs: stepStart(tEscrow),
      timestamp: Date.now(),
    });

    // 3) Construir X-PAYMENT header. clientWallet debe ser la dirección NATIVA de
    //    la cadena (G... en Stellar, base58 en Solana): el agente la usa para
    //    localizar el escrow on-chain. En modo degradado cae al pubkey de Solana.
    const paymentHeader = Buffer.from(
      JSON.stringify({
        escrowId,
        signature: escrowSig,
        nonce: quote.nonce,
        clientWallet: this.chain?.ownerAddress ?? this.wallet?.publicKey.toBase58() ?? 'unknown',
      }),
      'utf8',
    ).toString('base64');

    // 4) Reintentar con el header → el agente verifica + ejecuta + claim
    const tFinal = performance.now();
    let final: AxiosResponse;
    try {
      final = await axios.post(`${manifest.endpoint}/service`, payload, {
        headers: { 'X-PAYMENT': paymentHeader },
        timeout: options.timeoutMs ?? 30_000,
      });
    } catch (err) {
      // El escrow ya está abierto on-chain: si la llamada al agente falla, los fondos quedan
      // retenidos. Lanzamos un error accionable indicando cómo recuperarlos (refund tras la
      // ventana del contrato). Antes esto dejaba los fondos varados sin pista de recuperación.
      if (this.chain && escrowSig !== 'NO_ONCHAIN_PROGRAM_ID') {
        const e = new Error(
          `service '${service}' falló tras abrir el escrow (escrowId ${escrowId}). ` +
            `Fondos retenidos; recupéralos con client.refundEscrow('${escrowId}'). ` +
            `Causa: ${(err as Error).message}`,
        ) as Error & { recoverable: boolean; service: string; escrowId: string };
        e.recoverable = true;
        e.service = service;
        e.escrowId = escrowId;
        throw e;
      }
      throw err;
    }
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
   * Llamada de CONFIANZA (plataforma): invoca el servicio del agente SIN abrir escrow,
   * presentando el secreto compartido `X-Platform-Auth`. El agente sirve directo y el pago se
   * concilia off-chain (liquidación por lotes vía settlement). Para uso del gateway (mismo
   * operador) que ya debitó el crédito del usuario ANTES de llamar. Lanza si el agente no
   * responde 2xx (p.ej. secreto ausente/erróneo → 402/503) para que el caller reembolse.
   */
  async callTrusted<TRes = unknown>(
    endpoint: string,
    payload: unknown,
    options: { platformAuth: string; timeoutMs?: number },
  ): Promise<TRes> {
    const resp = await axios.post(`${endpoint}/service`, payload, {
      headers: { 'X-Platform-Auth': options.platformAuth },
      timeout: options.timeoutMs ?? 120_000,
    });
    return resp.data as TRes;
  }

  /**
   * Descubre un servicio. Phase 2: lee directamente del registry on-chain
   * con fallback al backend de descubrimiento.
   */
  async discover(service: string): Promise<ServiceManifest> {
    // Primero intenta on-chain (si hay cadena configurada)
    if (this.chain) {
      const onChain = await this.chain.fetchAgent(service);
      if (onChain) {
        return {
          service: onChain.service,
          pricePerCall: Number(onChain.pricePerCallBaseUnits) / this.chain.baseUnitsPerToken,
          description: onChain.description,
          endpoint: onChain.endpoint,
          ownerWallet: onChain.ownerAddress,
          acceptedToken: this.chain.asset,
        };
      }
    }

    // Fallback: backend
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
    const resp = await axios.get<ServiceManifest>(`${backendUrl}/agents/${service}`, {
      timeout: 10_000,
    });
    return resp.data;
  }

  /**
   * Reembolsa un escrow no liberado (p.ej. si la llamada al servicio falló tras abrirlo),
   * vía el flujo de disputa de Trustless Work. Devuelve el hash/id de la transacción.
   */
  async refundEscrow(escrowId: string): Promise<string> {
    if (!this.chain) {
      throw new Error('refundEscrow: sin cadena configurada (modo degradado)');
    }
    return this.chain.refundEscrow({ escrowId });
  }
}
