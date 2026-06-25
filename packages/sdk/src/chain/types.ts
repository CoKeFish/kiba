/**
 * ChainClient — abstracción de la cadena de liquidación.
 *
 * Captura TODO lo que el marketplace necesita de una blockchain (registro de
 * agentes + escrow de pagos), sin filtrar detalles de una cadena concreta.
 * El resto del SDK (AgentClient, AgentProvider) depende solo de esta interfaz;
 * no sabe si por debajo hay Solana, Stellar u otra cosa.
 *
 * Convenciones neutrales a la cadena:
 *  - Direcciones: strings en el formato nativo de la cadena (base58 en Solana,
 *    G... en Stellar). Quien implementa traduce.
 *  - Montos: `bigint` en las unidades base mínimas del activo (lamports en SOL).
 *    Usa `baseUnitsPerToken` para convertir a/desde el valor decimal del token.
 *  - Identificadores de transacción: strings opacos (signature en Solana,
 *    hash en Stellar).
 */

/** Un agente tal como vive en el registro on-chain, en forma neutral. */
export interface ChainAgentInfo {
  service: string;
  /** Precio base por llamada, en unidades base del activo (ej. lamports). */
  pricePerCallBaseUnits: bigint;
  description: string;
  endpoint: string;
  /** Dirección del dueño del agente, en formato nativo de la cadena. */
  ownerAddress: string;
  /**
   * Timestamp UNIX (segundos) del registro original. El contrato lo fija en
   * `register_agent` y nunca lo modifica (las llamadas a `update_agent` lo
   * preservan), así que es estable. Opcional para back-compat con
   * implementaciones de cadena que no lo expongan todavía.
   */
  createdAt?: bigint;
}

/** Estado de un escrow de pago, en forma neutral. */
export interface ChainEscrowInfo {
  /** Monto bloqueado, en unidades base del activo. */
  amountBaseUnits: bigint;
  /** 'Pending' = abierto sin reclamar; 'Completed' = pagado; 'Refunded' = devuelto. */
  state: 'Pending' | 'Completed' | 'Refunded';
}

export interface RegisterAgentArgs {
  service: string;
  pricePerCallBaseUnits: bigint;
  endpoint: string;
  description: string;
}

export interface UpdateAgentArgs {
  service: string;
  /** null/undefined = no cambiar este campo. */
  pricePerCallBaseUnits?: bigint | null;
  endpoint?: string | null;
  description?: string | null;
}

export interface OpenEscrowArgs {
  service: string;
  /** Dirección del dueño del agente a quien se le pagará. */
  payToAddress: string;
  nonce: bigint;
  amountBaseUnits: bigint;
}

export interface FetchEscrowArgs {
  /** Dirección del cliente que abrió el escrow. */
  clientAddress: string;
  nonce: bigint;
}

export interface ClaimPaymentArgs {
  clientAddress: string;
  nonce: bigint;
  service: string;
}

export interface RefundEscrowArgs {
  /** Servicio del que se abrió el escrow (se usa para derivar el agent_owner). */
  service: string;
  nonce: bigint;
}

export interface ChainClient {
  /** Símbolo del activo de liquidación (va en el manifest y la quote x402). */
  readonly asset: 'SOL' | 'USDC' | 'XLM';
  /** Unidades base por token: 1e9 (lamports/SOL), 1e7 (stroops/XLM), etc. */
  readonly baseUnitsPerToken: number;
  /** Dirección de la wallet asociada a este cliente, formato nativo. */
  readonly ownerAddress: string;

  /**
   * Asegura que la wallet tenga fondos para operar (gas/fees).
   * `minToken`: si el saldo cae bajo este valor (en token decimal), recarga.
   * `topUpToken`: cuánto solicitar al recargar. No-op si la cadena no lo soporta.
   */
  ensureFunds(minToken: number, topUpToken: number): Promise<void>;

  /** Saldo on-chain de la wallet de este cliente, en unidades base del activo. */
  getBalanceBaseUnits(): Promise<bigint>;

  /** Lee un agente del registro. null si no existe. */
  fetchAgent(service: string): Promise<ChainAgentInfo | null>;

  /** Registra un agente nuevo. Devuelve el id/hash de la transacción. */
  registerAgent(args: RegisterAgentArgs): Promise<string>;

  /** Actualiza un agente existente. Devuelve el id/hash de la transacción. */
  updateAgent(args: UpdateAgentArgs): Promise<string>;

  /** Abre un escrow para pagar a un agente. Devuelve el id/hash de la transacción. */
  openEscrow(args: OpenEscrowArgs): Promise<string>;

  /** Lee el escrow (cliente → esta wallet, nonce). null si no existe. */
  fetchEscrow(args: FetchEscrowArgs): Promise<ChainEscrowInfo | null>;

  /** Reclama el pago de un escrow tras servir. Devuelve el id/hash de la transacción. */
  claimPayment(args: ClaimPaymentArgs): Promise<string>;

  /**
   * Reembolsa al cliente un escrow Pending tras la ventana de espera del contrato
   * (REFUND_DELAY_SECS). Útil para recuperar fondos si la llamada al servicio falló
   * después de abrir el escrow. Devuelve el id/hash de la transacción.
   */
  refundEscrow(args: RefundEscrowArgs): Promise<string>;
}
