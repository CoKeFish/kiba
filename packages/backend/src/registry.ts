/**
 * RegistryReader — lectura del registro de agentes, agnóstica a la cadena.
 *
 * El indexer ya no habla con Solana directo: pide los agentes a un RegistryReader
 * que se elige por `CHAIN`. Así, `CHAIN=stellar` cambia la fuente de discovery
 * sin tocar el indexer.
 *
 *   - Solana: enumera el registry on-chain (getProgramAccounts).
 *   - Stellar: Soroban no tiene enumeración → lee una lista conocida de servicios
 *     (env STELLAR_SERVICES) con get_agent vía la abstracción ChainClient del SDK.
 */
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import {
  AgentBazaarProgram,
  createChainClient,
  type ChainClient,
} from '@agent-bazaar/sdk';
import type { AgentRecord } from './db';

export interface RegistryReader {
  /** Unidades base por token del activo (1e9 SOL, 1e7 XLM). */
  readonly baseUnitsPerToken: number;
  readonly asset: string;
  readonly label: string;
  /** Enumera todos los agentes visibles del registro. */
  listAgents(): Promise<AgentRecord[]>;
  /** Suscripción opcional a cambios live. Devuelve un unsubscribe. */
  subscribe?(onChange: () => void): () => void;
}

const DEFAULT_SERVICES = [
  'yield-hunter',
  'risk-auditor',
  'translator-pro',
  'price-oracle',
  'code-reviewer',
];

const PROGRAM_INSTR_REGEX =
  /Program log: Instruction: (RegisterAgent|UpdateAgent|DeregisterAgent|ClaimPayment|RefundEscrow)/i;

class SolanaRegistryReader implements RegistryReader {
  readonly baseUnitsPerToken = 1e9;
  readonly asset = 'SOL';
  readonly label = 'solana';

  constructor(
    private readonly program: AgentBazaarProgram,
    private readonly connection: Connection,
  ) {}

  async listAgents(): Promise<AgentRecord[]> {
    const now = Math.floor(Date.now() / 1000);
    const onChain = await this.program.fetchAllAgents();
    return onChain.map(({ pda, data }) => ({
      pda: pda.toBase58(),
      service: data.service,
      owner_wallet: data.owner.toBase58(),
      price_per_call: Number(data.pricePerCall),
      endpoint: data.endpoint,
      description: data.description,
      total_calls: Number(data.totalCalls),
      total_earned: Number(data.totalEarned),
      created_at: Number(data.createdAt),
      updated_at: now,
      source: 'chain',
      deleted: 0,
    }));
  }

  subscribe(onChange: () => void): () => void {
    const id = this.connection.onLogs(
      this.program.programId,
      (logs) => {
        if (logs.logs.some((l) => PROGRAM_INSTR_REGEX.test(l))) onChange();
      },
      'confirmed',
    );
    return () => {
      void this.connection.removeOnLogsListener(id);
    };
  }
}

class StellarRegistryReader implements RegistryReader {
  readonly baseUnitsPerToken: number;
  readonly asset: string;
  readonly label = 'stellar';

  constructor(
    private readonly chain: ChainClient,
    private readonly services: string[],
  ) {
    this.baseUnitsPerToken = chain.baseUnitsPerToken;
    this.asset = chain.asset;
  }

  async listAgents(): Promise<AgentRecord[]> {
    const now = Math.floor(Date.now() / 1000);
    const out: AgentRecord[] = [];
    for (const service of this.services) {
      try {
        const a = await this.chain.fetchAgent(service);
        if (!a) continue;
        out.push({
          pda: `stellar:${a.service}`,
          service: a.service,
          owner_wallet: a.ownerAddress,
          price_per_call: Number(a.pricePerCallBaseUnits),
          endpoint: a.endpoint,
          description: a.description,
          total_calls: 0,
          total_earned: 0,
          // `createdAt` viene del contrato (register_agent lo fija una vez;
          // update_agent lo preserva). Fallback al timestamp del indexer si el
          // cliente de cadena no lo expone — preserva el comportamiento previo.
          created_at: a.createdAt != null ? Number(a.createdAt) : now,
          updated_at: now,
          source: 'chain',
          deleted: 0,
        });
      } catch (err) {
        console.warn(`[registry:stellar] get_agent(${service}) falló:`, (err as Error).message);
      }
    }
    return out;
  }
  // Sin subscribe: el heartbeat del indexer re-snapshotea periódicamente.
}

/**
 * Construye el RegistryReader según `CHAIN`. Devuelve null en modo demo
 * (sin cadena configurada) → el indexer siembra FALLBACK_AGENTS.
 */
export function createRegistryReader(): RegistryReader | null {
  const chain = (process.env.CHAIN ?? '').toLowerCase();

  if (chain === 'stellar') {
    if (!process.env.STELLAR_CONTRACT_ID) {
      console.warn('[registry] CHAIN=stellar pero falta STELLAR_CONTRACT_ID — modo demo');
      return null;
    }
    // Keypair efímero: las lecturas Soroban no requieren cuenta fondeada.
    const cc = createChainClient({ wallet: Keypair.generate(), label: 'backend' });
    if (!cc) return null;
    const services = (process.env.STELLAR_SERVICES ?? DEFAULT_SERVICES.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`[registry] Stellar reader sobre ${services.length} servicios`);
    return new StellarRegistryReader(cc, services);
  }

  const programId = process.env.PROGRAM_ID;
  if (!programId) return null;
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    'confirmed',
  );
  try {
    const program = new AgentBazaarProgram(new PublicKey(programId), connection);
    return new SolanaRegistryReader(program, connection);
  } catch (err) {
    console.error('[registry] PROGRAM_ID inválido:', (err as Error).message);
    return null;
  }
}
