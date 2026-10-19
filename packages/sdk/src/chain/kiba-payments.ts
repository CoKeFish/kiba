/**
 * Cliente del contrato de pagos de Kiba (packages/contracts-payments) sobre Soroban.
 *
 * Reemplaza a los escrows de Trustless Work: cada operación es UNA invocación del contrato
 * (~5 s, un ledger), sin API externa ni indexer.
 *   - pay          pago directo con el split (liquidaciones y pago por llamada).
 *   - open/claim/refund   escrow por llamada para x402.
 *
 * Envío único: a diferencia del reintento genérico del cliente del registro, aquí NO se
 * reintenta una tx que pudo haber entrado (un `pay` repetido pagaría dos veces). Se espera
 * hasta saber con certeza si entró (la tx caduca a los TX_TIMEOUT_S) y solo se reintenta si
 * la red la rechazó al enviarla, que garantiza que no se incluyó.
 */
import { randomBytes } from 'node:crypto';
import {
  rpc,
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import type { StellarSigner } from './signer';

const TX_TIMEOUT_S = 30;
/** Vida por defecto de un escrow x402: ~1 h (el servicio cobra en segundos). */
const DEFAULT_ESCROW_TTL_LEDGERS = 720;

export interface KibaPaymentsConfig {
  contractId: string;
  server: rpc.Server;
  signer: StellarSigner;
  networkPassphrase: string;
  label?: string;
}

export interface KibaEscrow {
  payer: string;
  receiver: string;
  amountBaseUnits: bigint;
  expiresLedger: number;
}

/**
 * La tx se envió pero no se pudo saber si entró (la red no respondió hasta su caducidad).
 * El llamador NO debe reintentar: debe consultar `txHash` más tarde (`transactionStatus`).
 */
export class PaymentPendingError extends Error {
  constructor(
    message: string,
    readonly txHash: string,
  ) {
    super(message);
    this.name = 'PaymentPendingError';
  }
}

/** Los escrows del contrato de Kiba se identifican con 32 bytes en hex (los de TW son C...). */
export function isKibaEscrowId(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

export class KibaPaymentsClient {
  readonly contractId: string;
  private readonly contract: Contract;
  private readonly server: rpc.Server;
  private readonly signer: StellarSigner;
  private readonly passphrase: string;
  private readonly label: string;

  constructor(cfg: KibaPaymentsConfig) {
    this.contractId = cfg.contractId;
    this.contract = new Contract(cfg.contractId);
    this.server = cfg.server;
    this.signer = cfg.signer;
    this.passphrase = cfg.networkPassphrase;
    this.label = cfg.label ?? 'kiba-payments';
  }

  /**
   * Paga `amount` del firmante a `to` con el split del contrato. Devuelve el hash.
   * `onSent` recibe el hash ANTES de enviar (para guardarlo y poder reconciliar si se pierde
   * la respuesta). Lanza {@link PaymentPendingError} si no se pudo saber si entró.
   */
  pay(
    args: { to: string; amountBaseUnits: bigint; reference?: bigint },
    onSent?: (hash: string) => Promise<void> | void,
  ): Promise<string> {
    return this.submit(
      'pay',
      [
        addr(this.signer.publicKey()),
        addr(args.to),
        i128(args.amountBaseUnits),
        nativeToScVal(args.reference ?? 0n, { type: 'u64' }),
      ],
      onSent,
    );
  }

  /** Estado definitivo de una tx: 'success', 'failed' o 'not_found' (no entró o aún no se ve). */
  async transactionStatus(hash: string): Promise<'success' | 'failed' | 'not_found'> {
    const r = await this.server.getTransaction(hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return 'success';
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) return 'failed';
    return 'not_found';
  }

  /** Bloquea `amount` del firmante para `receiver`. Devuelve el id (hex) y el hash. */
  async open(args: {
    receiver: string;
    amountBaseUnits: bigint;
    ttlLedgers?: number;
  }): Promise<{ escrowId: string; hash: string }> {
    const id = randomBytes(32);
    const hash = await this.submit('open', [
      addr(this.signer.publicKey()),
      addr(args.receiver),
      i128(args.amountBaseUnits),
      xdr.ScVal.scvBytes(id),
      nativeToScVal(args.ttlLedgers ?? DEFAULT_ESCROW_TTL_LEDGERS, { type: 'u32' }),
    ]);
    return { escrowId: id.toString('hex'), hash };
  }

  /** El firmante (receiver del escrow) cobra con el split. */
  claim(escrowId: string): Promise<string> {
    return this.submit('claim', [xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'))]);
  }

  /** Devuelve al pagador un escrow expirado sin cobrar. */
  refund(escrowId: string): Promise<string> {
    return this.submit('refund', [xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'))]);
  }

  /** Escrow abierto (sin cobrar ni devolver), o null si no existe o ya se cerró. */
  async getEscrow(escrowId: string): Promise<KibaEscrow | null> {
    const v = (await this.read('get_escrow', [xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'))])) as
      | { payer: string; receiver: string; amount: bigint; expires: number }
      | null
      | undefined;
    if (!v) return null;
    return {
      payer: v.payer,
      receiver: v.receiver,
      amountBaseUnits: BigInt(v.amount),
      expiresLedger: Number(v.expires),
    };
  }

  // ─── envío y lectura ───────────────────────────────────────

  private async submit(
    method: string,
    args: xdr.ScVal[],
    onSent?: (hash: string) => Promise<void> | void,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const source = await this.server.getAccount(this.signer.publicKey());
      const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase })
        .addOperation(this.contract.call(method, ...args))
        .setTimeout(TX_TIMEOUT_S)
        .build();
      const prepared = await this.server.prepareTransaction(tx);
      await this.signer.signTransaction(prepared);
      const hash = prepared.hash().toString('hex');
      await onSent?.(hash);
      let sent: rpc.Api.SendTransactionResponse;
      try {
        sent = await this.server.sendTransaction(prepared);
      } catch {
        // Sin respuesta del RPC: pudo haberla recibido.
        return this.awaitFinal(method, hash);
      }
      if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
        // Rechazada al enviar: seguro que no entró → se puede reintentar con secuencia fresca.
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new Error(`[${this.label}] ${method} rechazada: ${JSON.stringify(sent.errorResult ?? sent.status)}`);
      }
      return this.awaitFinal(method, hash);
    }
  }

  /**
   * Espera el resultado definitivo. Tras la caducidad de la tx (+ margen), NOT_FOUND visto
   * por el RPC significa que no entró nunca; si el RPC no respondió, no se sabe → pendiente.
   */
  private async awaitFinal(method: string, hash: string): Promise<string> {
    const deadline = Date.now() + (TX_TIMEOUT_S + 15) * 1000;
    let lastSeen: 'not_found' | 'unknown' = 'unknown';
    while (Date.now() < deadline) {
      try {
        const res = await this.server.getTransaction(hash);
        if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return hash;
        if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
          throw new Error(`[${this.label}] ${method} falló on-chain: ${hash}`);
        }
        lastSeen = 'not_found';
      } catch (err) {
        if ((err as Error).message.includes('falló on-chain')) throw err;
        lastSeen = 'unknown';
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (lastSeen === 'not_found') {
      throw new Error(`[${this.label}] ${method} no entró (caducó sin incluirse): ${hash}`);
    }
    throw new PaymentPendingError(`[${this.label}] ${method} sin confirmación: ${hash}`, hash);
  }

  private async read(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(new Account(this.signer.publicKey(), '0'), {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_S)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`[${this.label}] simulación de ${method} falló`);
    }
    return scValToNative(sim.result.retval);
  }
}

function addr(a: string): xdr.ScVal {
  return nativeToScVal(a, { type: 'address' });
}
function i128(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: 'i128' });
}
