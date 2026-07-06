/**
 * TrustlessWorkEscrowClient — capa de escrow sobre la API REST de Trustless Work.
 *
 * Trustless Work (https://www.trustlesswork.com) es escrow-as-a-service no-custodial
 * sobre Stellar/Soroban. Modelo de uso:
 *   1. POST a un endpoint de TW (con `x-api-key`) → devuelve una tx XDR SIN FIRMAR.
 *   2. Se firma localmente con el Keypair (Stellar ed25519).
 *   3. POST /helper/send-transaction con el XDR firmado → la red ejecuta.
 *
 * En Kiba esto REEMPLAZA el escrow del contrato Soroban propio (open/claim/refund).
 * El contrato de Kiba se conserva SOLO para el registro de agentes (TW no tiene
 * marketplace). Este cliente lo consume `StellarChainClient`, que delega en él sus
 * métodos de escrow y mantiene registro/cuenta contra el contrato Kiba.
 *
 * Diferencia estructural clave vs. el contrato Kiba: TW DESPLIEGA UN CONTRATO POR
 * ESCROW. La identidad del escrow es el `contractId` (no un nonce dentro de un
 * contrato único). Por eso el SDK pasa a identificar escrows por `escrowId`.
 *
 * Mapeo de roles x402 → single-release escrow (automatizado, sin humano en el loop):
 *   - receiver / serviceProvider / releaseSigner / approver = owner del agente
 *     (el agente sirve y libera hacia sí mismo, replicando el "claim" de Kiba).
 *   - approver = owner del agente también (auto-aprueba para no requerir confirmación
 *     manual del cliente en cada micro-pago).
 *   - platformAddress / disputeResolver = treasury de la plataforma (recibe el fee
 *     y resuelve disputas/refunds).
 *   - signer del deploy/fund = el que fondea (treasury en modo crédito / custodial
 *     en modo wallet) — el Keypair de este cliente.
 *
 * NOTA (Fase 2, requiere API key de testnet): varios detalles solo se confirman
 * contra la API viva y están marcados con `TODO(tw-phase2)`:
 *   - el campo exacto del que sale el `contractId` en la respuesta de send-transaction;
 *   - la coreografía de milestone (TW exige "escrow completed" antes de release):
 *     change-milestone-status → approve-milestone → release-funds;
 *   - el endpoint/shape de lectura del escrow (getEscrow);
 *   - el trustline/asset soportado en testnet (probable USDC).
 */
import { TransactionBuilder } from '@stellar/stellar-sdk';
import axios, { type AxiosInstance } from 'axios';
import type { ChainEscrowInfo, EscrowRoles, OpenEscrowResult } from './types';
import type { StellarSigner } from './signer';

/** Extrae los roles del escrow del shape del indexer de TW (sin asumir todos presentes). */
function parseRoles(raw: unknown): EscrowRoles | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const roles: EscrowRoles = {
    receiver: str(r.receiver),
    serviceProvider: str(r.serviceProvider),
    approver: str(r.approver),
    releaseSigner: str(r.releaseSigner),
    platformAddress: str(r.platformAddress),
    disputeResolver: str(r.disputeResolver),
  };
  return Object.values(roles).some((v) => v !== undefined) ? roles : undefined;
}

export interface TrustlessWorkRoles {
  approver: string;
  serviceProvider: string;
  platformAddress: string;
  releaseSigner: string;
  disputeResolver: string;
  receiver: string;
}

export interface TrustlessWorkConfig {
  /** Base URL de la API TW (testnet: https://dev.api.trustlesswork.com). */
  apiUrl: string;
  /** API key (header x-api-key). Se obtiene del BackOffice dApp de TW. */
  apiKey: string;
  /** Dirección de la plataforma: recibe el platformFee y resuelve disputas. */
  platformAddress: string;
  /** Comisión de la plataforma en porcentaje (5 = 5%, equivalente a 500 bps). */
  platformFee: number;
  /** Trustline (token) que mueve el escrow. Testnet suele ser USDC. */
  trustline: { address: string; symbol: string };
  /**
   * Fee wallet de TW (G...): tercer arg de release_funds/withdraw_remaining_funds en el
   * contrato (recibe los 30 bps de TW). La API REST lo inyecta server-side; las
   * invocaciones DIRECTAS al contrato (withdraw_remaining_funds, sin endpoint REST)
   * lo necesitan explícito.
   */
  feeAddress?: string;
  /** Network passphrase para firmar el XDR. */
  networkPassphrase: string;
  /** Unidades base por token (para convertir baseUnits ⇄ monto decimal de TW). */
  baseUnitsPerToken: number;
  /** Prefijo para logs. */
  label?: string;
}

export interface DeployAndFundArgs {
  /** Owner del agente: receiver/serviceProvider/releaseSigner/approver. */
  agentOwner: string;
  /** Servicio (para title/description/milestone). */
  service: string;
  /** Identificador único del escrow (derivado de service+nonce). */
  engagementId: string;
  /** Monto a bloquear, en unidades base del activo. */
  amountBaseUnits: bigint;
  /** Roles del escrow; por defecto `roles(agentOwner)`. Para liquidación self-release se pasan
   *  roles con la treasury como approver/serviceProvider/releaseSigner y el agente como receiver. */
  roles?: TrustlessWorkRoles;
}

export class TrustlessWorkEscrowClient {
  private readonly http: AxiosInstance;
  private readonly label: string;

  constructor(
    private readonly signer: StellarSigner,
    private readonly cfg: TrustlessWorkConfig,
  ) {
    this.label = cfg.label ?? 'tw';
    this.http = axios.create({
      baseURL: cfg.apiUrl.replace(/\/+$/, ''),
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey },
    });
  }

  /** Dirección Stellar (G...) de quien firma. */
  get address(): string {
    return this.signer.publicKey();
  }

  private toDecimal(amountBaseUnits: bigint): number {
    return Number(amountBaseUnits) / this.cfg.baseUnitsPerToken;
  }

  private roles(agentOwner: string): TrustlessWorkRoles {
    return {
      approver: agentOwner,
      serviceProvider: agentOwner,
      platformAddress: this.cfg.platformAddress,
      releaseSigner: agentOwner,
      disputeResolver: this.cfg.platformAddress,
      receiver: agentOwner,
    };
  }

  /**
   * Roles para una liquidación SELF-RELEASE: la treasury (este signer) toma
   * approver/serviceProvider/releaseSigner y el agente es solo el receiver. Permite que la
   * treasury haga deploy+fund+complete+approve+release SOLA (sin la llave del agente), para
   * pagar por lotes las ganancias acumuladas off-chain.
   */
  private selfReleaseRoles(receiver: string): TrustlessWorkRoles {
    return {
      approver: this.address,
      serviceProvider: this.address,
      platformAddress: this.cfg.platformAddress,
      releaseSigner: this.address,
      disputeResolver: this.cfg.platformAddress,
      receiver,
    };
  }

  /**
   * Firma un XDR (devuelto por la API TW) y lo envía vía /helper/send-transaction.
   * La API a veces responde "missing resultMetaXdr" (la tx SÍ se difundió pero el
   * resultado no estaba listo); en ese caso NO se debe re-enviar el mismo XDR (da
   * "Bad request"), así que devolvemos { pending: true } y el caller verifica el
   * resultado contra el indexer.
   */
  private async signAndSend(unsignedXdr: string): Promise<Record<string, unknown>> {
    const tx = TransactionBuilder.fromXDR(unsignedXdr, this.cfg.networkPassphrase);
    await this.signer.signTransaction(tx);
    const signedXdr = tx.toXDR();
    // Hash de la tx INTERNA firmada. TW fee-bumpea el envelope (el hash externo cambia),
    // pero Horizon indexa los fee-bumps también por el hash interno → es consultable.
    const innerTxHash = tx.hash().toString('hex');
    try {
      const res = await this.http.post('/helper/send-transaction', { signedXdr });
      return { ...((res.data ?? {}) as Record<string, unknown>), innerTxHash };
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? '';
      if (/resultMetaXdr|not be complete/i.test(msg)) {
        return { pending: true, innerTxHash }; // la tx pudo aterrizar; el caller verifica vía indexer
      }
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * GET indexer: escrows desplegados por un signer (para recovery por engagementId).
   * Pedimos los más NUEVOS primero (orderBy=createdAt desc) con pageSize alto: sin esto el
   * endpoint devuelve una página chica (~8) y, con cientos de escrows del signer, el recién
   * desplegado no viene y el recovery falla. (El filtro server-side ?engagementId= devuelve
   * [] en la API dev, así que filtramos en cliente.)
   */
  private async getEscrowsBySigner(signer: string): Promise<Array<Record<string, unknown>>> {
    try {
      const res = await this.http.get('/helper/get-escrows-by-signer', {
        params: { signer, orderBy: 'createdAt', orderDirection: 'desc', pageSize: 50 },
      });
      const d: unknown = res.data;
      const env = d as { data?: unknown[]; escrows?: unknown[] };
      const arr = Array.isArray(d) ? d : (env?.data ?? env?.escrows ?? []);
      return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  }

  /** GET indexer: un escrow por contractId (la API devuelve un array). */
  private async getEscrowRaw(escrowId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.http.get('/helper/get-escrow-by-contract-ids', {
        params: { contractIds: [escrowId] },
      });
      const arr = res.data as Array<Record<string, unknown>> | undefined;
      return Array.isArray(arr) && arr.length ? arr[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * POST a un endpoint de TW que SIMULA contra el escrow on-chain (fund/release/
   * milestone) y devuelve el unsignedTransaction. Reintenta si el estado on-chain
   * (deploy/fund recién enviados) todavía no confirmó → `Error(Storage, MissingValue)`.
   */
  private async postSim(
    path: string,
    body: object,
    label: string,
    method: 'post' | 'put' = 'post',
  ): Promise<string> {
    let lastErr: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        const resp = await this.http[method](path, body);
        return this.unsignedXdr(resp.data, label);
      } catch (err) {
        lastErr = err;
        const msg = String(
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            (err as Error).message ??
            '',
        );
        if (/MissingValue|non-existing|not exist|escrow not found/i.test(msg) && i < 5) {
          await this.sleep(2000); // el deploy/fund aún no confirmó on-chain (confirma en pocos s)
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  /**
   * postSim + signAndSend con reintento ante tx_bad_seq. Pasos consecutivos del mismo signer
   * (deploy→fund de la treasury; change→approve→release del agente) pueden colisionar en la
   * secuencia de la cuenta. Ante tx_bad_seq reconstruimos el XDR (postSim trae una secuencia
   * fresca) tras una pausa para que cierre el ledger. "pending" del send NO es error (la tx
   * aterrizó). Devuelve la respuesta del send (o {pending}).
   */
  private async postSimAndSend(
    path: string,
    body: object,
    label: string,
    method: 'post' | 'put' = 'post',
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const xdr = await this.postSim(path, body, label, method);
        return await this.signAndSend(xdr);
      } catch (err) {
        const msg =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (err as Error).message ??
          '';
        if (/bad_seq|rejected by stellar/i.test(msg) && attempt < 3) {
          console.warn(`[${this.label}] ${label} tx_bad_seq, reintento ${attempt + 1}`);
          await this.sleep(3000);
          continue;
        }
        throw err;
      }
    }
  }

  /** Espera (poll) a que un escrow cumpla un predicado en el indexer. */
  private async waitFor(
    escrowId: string,
    pred: (e: Record<string, unknown>) => boolean,
    label: string,
  ): Promise<void> {
    for (let i = 0; i < 8; i++) {
      const e = await this.getEscrowRaw(escrowId);
      if (e && pred(e)) return;
      await this.sleep(2500);
    }
    console.warn(`[${this.label}] waitFor(${label}) agotó el tiempo para ${escrowId}`);
  }

  /**
   * Deploy + fund de un escrow single-release. Devuelve el contractId (escrowId) y
   * el hash del fondeo.
   */
  async deployAndFund(args: DeployAndFundArgs): Promise<OpenEscrowResult> {
    const amount = this.toDecimal(args.amountBaseUnits);

    // 1) Deploy. send-transaction es flaky ("missing resultMetaXdr", y a veces la tx no
    //    aterriza), así que reintentamos el deploy completo (POST+sign+send con tx fresca)
    //    hasta que la respuesta traiga el contractId. Último recurso: recovery por engagementId.
    const deployBody = {
      signer: this.address,
      engagementId: args.engagementId,
      title: args.service,
      description: `Kiba x402 call: ${args.service}`,
      roles: args.roles ?? this.roles(args.agentOwner),
      amount,
      platformFee: this.cfg.platformFee,
      trustline: this.cfg.trustline,
      milestones: [{ description: args.service }],
    };
    // Deploy con recuperación (verificado contra la doc oficial de TW + pruebas en vivo):
    // /helper/send-transaction es SÍNCRONO y lee el contractId del resultMetaXdr de la tx;
    // si el ledger no cerró aún responde "missing resultMetaXdr" (la tx SÍ aterriza, pero el
    // contractId no viene). El contractId se genera on-chain (salt) y NO es derivable ni
    // recuperable por txHash (TW fee-bumpea la tx → el hash cambia); la ÚNICA vía es leerlo
    // del indexer por engagementId. Por eso usamos SIEMPRE el mismo engagementId (cambiarlo
    // acuñaría un contrato nuevo → escrows huérfanos/doble-fondeados) y recuperamos tras cada
    // intento; si el escrow ya existe, un re-deploy da 400 (duplicado) y lo recuperamos igual.
    let escrowId: string | null = null;
    for (let attempt = 0; attempt < 3 && !escrowId; attempt++) {
      let txBadSeq = false;
      try {
        const deployResp = await this.http.post('/deployer/single-release', deployBody);
        escrowId = this.extractContractId(
          await this.signAndSend(this.unsignedXdr(deployResp.data, 'deploy')),
        );
      } catch (err) {
        const msg =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (err as Error).message ??
          '';
        // tx_bad_seq / rechazo de Stellar = la tx NO aterrizó (colisión de secuencia de la
        // treasury, p.ej. llamadas concurrentes) → re-desplegar con seq fresco. Cualquier otro
        // error (incl. duplicado) = el escrow puede existir → recuperar, no re-desplegar.
        txBadSeq = /bad_seq|rejected by stellar/i.test(msg) && !/exist|duplicat|already/i.test(msg);
        console.warn(`[${this.label}] deploy intento ${attempt + 1}: ${msg}`);
      }
      if (escrowId) break;
      if (txBadSeq) {
        await this.sleep(3000); // deja cerrar el ledger para que avance el seq, luego re-deploy
      } else {
        // pending/duplicado → la tx aterrizó y el escrow existe; el contractId solo sale del
        // indexer (no es derivable ni recuperable por txHash). UNA recuperación larga; NO
        // re-desplegamos (daría 400 duplicado / escrows huérfanos). Si el indexer no lo refleja
        // a tiempo, fallamos y el gateway reembolsa.
        escrowId = await this.recoverEscrowId(args.engagementId);
        break;
      }
    }
    if (!escrowId) {
      throw new Error(`[${this.label}] deploy: no se pudo obtener el contractId del escrow`);
    }

    // 2) Fund (lo firma el funder). postSim reintenta hasta que el deploy confirme
    //    on-chain; luego verificamos vía indexer que el balance llegó.
    const fundTxHash = await this.fund(escrowId, args.amountBaseUnits);
    // No esperamos al indexer de TW aquí (lag ~30s): el agente verifica el fondeo
    // leyendo el balance del escrow on-chain (rápido) antes de servir.
    return { escrowId, signature: escrowId, fundTxHash };
  }

  /**
   * Fondeo incremental de un escrow existente (single-release acepta múltiples funds;
   * cada uno es una tx Stellar propia). Devuelve el hash de la tx interna firmada,
   * consultable en Horizon/stellar.expert (que indexan fee-bumps por ambos hashes).
   */
  async fund(escrowId: string, amountBaseUnits: bigint): Promise<string> {
    const resp = await this.postSimAndSend(
      '/escrow/single-release/fund-escrow',
      { contractId: escrowId, signer: this.address, amount: this.toDecimal(amountBaseUnits) },
      'fund',
    );
    return String(resp.innerTxHash ?? '');
  }

  /**
   * Deploy+fund de un escrow de liquidación SELF-RELEASE, SIN liberarlo: la treasury
   * (este signer) conserva los roles de liberación y el agente es solo receiver. Es el
   * escrow por servicio/ciclo que el gateway fondea incrementalmente con `fund()` en
   * cada llamada y libera por lotes con `release()`.
   */
  async openSettlementEscrow(args: {
    receiver: string;
    service: string;
    engagementId: string;
    amountBaseUnits: bigint;
  }): Promise<OpenEscrowResult> {
    return this.deployAndFund({
      agentOwner: args.receiver,
      service: args.service,
      engagementId: args.engagementId,
      amountBaseUnits: args.amountBaseUnits,
      roles: this.selfReleaseRoles(args.receiver),
    });
  }

  /**
   * Liquidación por lotes (self-release): la treasury (este signer) fondea Y libera un escrow
   * cuyo único receiver es el agente. Paga las ganancias acumuladas off-chain SIN la llave del
   * agente — `release()` ya firma sus 3 pasos con `this.address` (= treasury), que coincide con
   * los roles self-release. TW aplica el platformFee → ~95% al agente, ~5% de vuelta a
   * platformAddress (= treasury). Devuelve el escrowId (identidad on-chain del payout).
   */
  async settle(args: {
    receiver: string;
    service: string;
    engagementId: string;
    amountBaseUnits: bigint;
  }): Promise<string> {
    const { escrowId } = await this.openSettlementEscrow(args);
    await this.release(escrowId);
    return escrowId;
  }

  /** Ubica el contractId de un escrow recién desplegado por engagementId (recovery). */
  private async recoverEscrowId(engagementId: string): Promise<string | null> {
    // ~60s: única vía de obtener el contractId de un deploy "pending" (no viene en la respuesta
    // ni es derivable por txHash). El lag del indexer de TW es variable (típico ~15-25s, con
    // cola mayor). Devuelve apenas aparece; el tope solo aplica si el indexer va muy lento.
    for (let i = 0; i < 30; i++) {
      const escrows = await this.getEscrowsBySigner(this.address);
      const match = escrows.find((e) => e.engagementId === engagementId);
      if (typeof match?.contractId === 'string' && match.contractId) return match.contractId;
      await this.sleep(2000);
    }
    return null;
  }

  /**
   * Actualiza el `amount` DECLARADO del escrow. Crítico para el escrow por ciclo: el
   * release de un single-release paga el amount declarado (no el balance) — antes de
   * liberar un escrow fondeado incrementalmente hay que igualar el declarado al balance
   * real, o el excedente queda atrapado en el contrato (verificado en vivo: release de
   * un escrow con declarado 0.01 y balance 0.02 pagó solo ~0.0095). Firma el deployer.
   *
   * OJO (verificado en vivo 2026-07-05): la API DEV de TW rechaza cualquier cambio real
   * ("The provided escrow properties do not match the stored escrow" — solo acepta el
   * payload idéntico al almacenado). Este método queda listo para cuando TW habilite
   * updates de propiedades; hoy el gateway liquida por el settle clásico (settle()).
   */
  async updateAmount(escrowId: string, amountBaseUnits: bigint): Promise<string | null> {
    const e = await this.getEscrowRaw(escrowId);
    if (!e) {
      throw new Error(`[${this.label}] update-amount: escrow ${escrowId} no visible en el indexer`);
    }
    const current = Number(e.amount ?? 0);
    const target = this.toDecimal(amountBaseUnits);
    if (Math.abs(current - target) < 1 / this.cfg.baseUnitsPerToken) return null; // ya coincide
    // El PUT exige el escrow completo: passthrough del record del indexer con el amount nuevo.
    const escrow = {
      engagementId: e.engagementId,
      title: e.title,
      description: e.description,
      roles: e.roles,
      amount: target,
      platformFee: e.platformFee ?? this.cfg.platformFee,
      milestones: e.milestones ?? [{ description: String(e.title ?? 'kiba') }],
      flags: e.flags ?? {},
      isActive: e.isActive ?? true,
      receiverMemo: e.receiverMemo ?? 0,
      trustline: e.trustline ?? this.cfg.trustline,
    };
    const resp = await this.postSimAndSend(
      '/escrow/single-release/update-escrow',
      { contractId: escrowId, signer: this.address, escrow },
      'update-amount',
      'put',
    );
    // El caller DEBE confirmar este hash en Horizon antes de liberar: una colisión de
    // secuencia con el paso siguiente puede dejar caer esta tx sin error del send.
    return String(resp.innerTxHash ?? '') || null;
  }

  /** ¿El error dice que el paso ya se aplicó? (release reintentado tras fallo a mitad). */
  private isAlreadyDone(err: unknown): boolean {
    const msg = String(
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        (err as Error).message ??
        '',
    );
    return /already|completed|approved|released/i.test(msg);
  }

  /**
   * Libera los fondos al receiver. En single-release TW exige el milestone "completado"
   * y aprobado antes del release; el agente (que tiene los roles serviceProvider/approver/
   * releaseSigner) ejecuta la secuencia. `milestoneIndex` va como STRING.
   *
   * IDEMPOTENTE: un release reintentado (fallo a mitad de la coreografía) salta los pasos
   * ya aplicados y nunca puede pagar dos veces (released es terminal en el contrato).
   */
  async release(escrowId: string): Promise<string> {
    const existing = await this.getEscrowRaw(escrowId);
    if (((existing?.flags ?? {}) as Record<string, boolean>).released) return escrowId;
    // a) serviceProvider marca el milestone como completado.
    try {
      await this.postSimAndSend(
        '/escrow/single-release/change-milestone-status',
        {
          contractId: escrowId,
          milestoneIndex: '0',
          newStatus: 'completed',
          // la REST de TW lista newEvidence como required; mandarlo evita 400 intermitentes.
          newEvidence: 'Kiba x402: service delivered',
          serviceProvider: this.address,
        },
        'change-milestone-status',
      );
    } catch (err) {
      if (!this.isAlreadyDone(err)) throw err;
    }
    // b) approver aprueba el milestone.
    try {
      await this.postSimAndSend(
        '/escrow/single-release/approve-milestone',
        { contractId: escrowId, milestoneIndex: '0', approver: this.address },
        'approve-milestone',
      );
    } catch (err) {
      if (!this.isAlreadyDone(err)) throw err;
    }
    // c) releaseSigner libera los fondos al receiver. "already released" (el release
    //    anterior sí aterrizó pero el indexer no lo reflejaba al entrar) NO es error.
    try {
      await this.postSimAndSend(
        '/escrow/single-release/release-funds',
        { contractId: escrowId, releaseSigner: this.address },
        'release',
      );
    } catch (err) {
      if (!this.isAlreadyDone(err)) throw err;
    }
    await this.waitFor(escrowId, (e) => !!(e.flags as Record<string, boolean>)?.released, 'release');
    return escrowId;
  }

  /**
   * Refund/cancelación: ABRE una disputa sobre el escrow. OJO: en single-release esto NO
   * devuelve los fondos por sí solo — deja la disputa abierta (fondos bloqueados). Para
   * completarlo hace falta un segundo paso, POST /escrow/single-release/resolve-dispute
   * { contractId, disputeResolver, distributions:[{address, amount}] } (los montos suman el
   * balance post-fees), firmado por el disputeResolver (= cfg.platformAddress, la treasury).
   * Pendiente de cablear con pruebas en vivo del flujo de disputa. El gateway hoy reembolsa
   * el crédito off-chain del usuario (refundDebit en proxy.ts), no este escrow on-chain.
   */
  async refund(escrowId: string): Promise<string> {
    const resp = await this.http.post('/escrow/single-release/dispute-escrow', {
      contractId: escrowId,
      signer: this.address,
    });
    await this.signAndSend(this.unsignedXdr(resp.data, 'dispute'));
    return escrowId;
  }

  /**
   * Lee el escrow por contractId vía el indexer. `balance` = fondos efectivamente
   * bloqueados; `amount` = monto declarado. El estado sale de los flags. Expone los
   * `roles` (en particular `receiver`) para que el provider verifique que el escrow
   * lo nombra a él como cobrador antes de servir.
   */
  async getEscrow(escrowId: string): Promise<ChainEscrowInfo | null> {
    const e = await this.getEscrowRaw(escrowId);
    if (!e) return null;
    const decimal = Number((e.balance as number | string) ?? (e.amount as number | string) ?? 0);
    const amountBaseUnits = BigInt(Math.round(decimal * this.cfg.baseUnitsPerToken));
    const flags = (e.flags ?? {}) as Record<string, boolean>;
    // 'Refunded' solo cuando la disputa está RESUELTA (fondos devueltos). 'disputed' sola =
    // disputa abierta con fondos aún bloqueados, no es un refund completo.
    const state: ChainEscrowInfo['state'] = flags.released
      ? 'Completed'
      : flags.resolved
        ? 'Refunded'
        : 'Pending';
    const roles = parseRoles(e.roles);
    return { amountBaseUnits, state, receiver: roles?.receiver, roles };
  }

  /** Saca el XDR sin firmar de la respuesta de TW (varios endpoints lo nombran igual). */
  private unsignedXdr(data: unknown, step: string): string {
    const d = (data ?? {}) as Record<string, unknown>;
    const xdr = d.unsignedTransaction ?? d.unsignedTxXdr ?? d.xdr;
    if (typeof xdr !== 'string' || !xdr) {
      throw new Error(`[${this.label}] ${step}: respuesta sin unsignedTransaction`);
    }
    return xdr;
  }

  /** Extrae el contractId del escrow desplegado de la respuesta de deploy/send. */
  private extractContractId(...sources: unknown[]): string | null {
    for (const src of sources) {
      const d = (src ?? {}) as Record<string, unknown>;
      const id =
        d.contractId ??
        d.contract_id ??
        (d.escrow as Record<string, unknown> | undefined)?.contractId ??
        (d.data as Record<string, unknown> | undefined)?.contractId;
      if (typeof id === 'string' && id) return id;
    }
    return null;
  }
}
