/**
 * Depósito retirable: el usuario paga desde SU wallet dejando un depósito en un canal de pago.
 *
 * Modelo: un canal de pago de Stellar por usuario (contrato one-way-channel de
 * stellar-experimental, creado por su fábrica). El usuario deposita USDC en el canal con una
 * transacción que firma él; ese dinero sigue siendo suyo. Cada llamada sube el total consumido
 * (`spent`) sin tocar la cadena, y Kiba cobra ese total al contrato presentando un compromiso
 * firmado con la clave de gasto del canal. El contrato nunca paga más de lo depositado.
 *
 * Salidas del usuario:
 *   - Liquidar: Kiba cierra el canal; en una sola transacción el contrato le paga a Kiba lo
 *     consumido y devuelve el resto a la wallet del usuario. Es inmediato.
 *   - Retiro con espera (no depende de que Kiba coopere): el usuario pide el cierre, pasa el
 *     plazo del canal y retira todo lo que Kiba no haya cobrado.
 *
 * Cobro por tandas: cada llamada aparta su precio del depósito (`reserveChannel`) y, al
 * terminar bien, lo suma al consumo. Kiba cobra al contrato cuando lo consumido sin cobrar llega
 * a un umbral o lleva demasiado tiempo (`runChannelJob`), siempre mucho antes de la espera del
 * retiro. El mismo job detecta los retiros pedidos directamente al contrato.
 *
 * Inactividad: un depósito que nadie usa no se retiene. Pasados `CHANNEL_IDLE_DAYS` sin
 * depósitos, recargas ni llamadas, Kiba lo liquida: cobra lo pendiente y devuelve el resto a la
 * wallet. El dashboard lo avisa con días de antelación; cualquier uso reinicia la cuenta.
 *
 * Vida del canal: Stellar archiva los datos de un contrato cuando se acaba el plazo que tienen
 * pagado (al crear un canal, unos 7 días en testnet). Archivado no se pierde nada, pero no se
 * puede cobrar ni retirar hasta restaurarlo. El job renueva el plazo de cada canal vivo antes
 * de que venza y, si alguno llegó a archivarse, lo restaura. Lo paga Kiba.
 *
 * Clave de gasto: es una clave ed25519 distinta de la wallet, fijada al abrir el canal. Solo
 * autoriza cobros de ESE canal a favor de Kiba, hasta lo depositado. Con el conector web no hay
 * programa del usuario que firme cada llamada, así que la guarda Kiba: se deriva del seed de la
 * tesorería y del `salt` del canal (no se almacena en la base de datos).
 *
 * Todas las transacciones del usuario las arma el gateway y él solo las firma (mismo mecanismo
 * de spend.ts: tabla `spend_prepared`, envío con las comisiones a cargo de Kiba).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  SorobanDataBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { resolveChainConfig } from 'kiba-sdk';
import { db } from './db';
import { enqueueChainTask } from './escrows';
import { getMasterWallet } from './wallets';
import {
  ADDRESS_RE,
  collectorKeypair,
  getSpendChain,
  linkWallet,
  onPreparedSent,
  serialCollector,
  storePrepared,
  type PreparedTx,
} from './spend';

/** Fábrica publicada en testnet (packages/contracts-channel). `KIBA_CHANNEL_FACTORY_ID` la cambia; `0` la apaga. */
const TESTNET_FACTORY = 'CBV34HJF4VU4YBGMNHC2L3TKLDSTOXYN5ADZRBWCILJLHOTAAKWX75SV';
/** Espera del retiro sin Kiba, en ledgers (~5 s cada uno). Default ~1 h. */
export const CHANNEL_WAIT_LEDGERS = Number(process.env.CHANNEL_REFUND_WAIT_LEDGERS) || 720;
/** Depósito mínimo para abrir un canal (unidades base). Default 1 USDC. */
export const CHANNEL_MIN_DEPOSIT = Number(process.env.CHANNEL_MIN_DEPOSIT) || 10_000_000;
/** Consumo sin cobrar a partir del cual Kiba cobra al canal (unidades base). Default 0.10 USDC. */
export const CHANNEL_SETTLE_THRESHOLD = Number(process.env.CHANNEL_SETTLE_THRESHOLD) || 1_000_000;
/** Tiempo máximo que un consumo queda sin cobrar, aunque no llegue al umbral. Default 10 min. */
export const CHANNEL_SETTLE_MAX_AGE_S = Number(process.env.CHANNEL_SETTLE_MAX_AGE_S) || 600;
/** Si a un canal le quedan menos ledgers de vida que esto, Kiba lo renueva. Default ~3 días. */
export const CHANNEL_TTL_MIN_LEDGERS = Number(process.env.CHANNEL_TTL_MIN_LEDGERS) || 51_840;
/** Hasta cuántos ledgers de vida se renueva un canal. Default ~30 días. */
export const CHANNEL_TTL_EXTEND_LEDGERS = Number(process.env.CHANNEL_TTL_EXTEND_LEDGERS) || 518_400;
/** Días sin uso tras los que el depósito se devuelve a la wallet. `0` = nunca. Default 90. */
export const CHANNEL_IDLE_DAYS = process.env.CHANNEL_IDLE_DAYS === undefined ? 90 : Number(process.env.CHANNEL_IDLE_DAYS) || 0;
/** Con cuántos días de antelación el dashboard avisa de la devolución por inactividad. Default 7. */
export const CHANNEL_IDLE_NOTICE_DAYS = Number(process.env.CHANNEL_IDLE_NOTICE_DAYS) || 7;
const DAY_S = 86_400;
/** Una llamada tarda como mucho 2 min: lo apartado por más de esto es de un proceso que murió. */
const HOLD_TTL_S = 300;
/** Validez de una transacción preparada (igual que en spend.ts). */
const PREPARED_TTL_S = 600;

// ─── Acceso a la cadena (inyectable en tests) ───────────────────────────────

export interface ChannelChain {
  /** Cuenta de Kiba que cobra del canal (la tesorería). */
  recipient(): string;
  /** Transacciones que firma el usuario (fuente = owner), sin firmar, en XDR. */
  buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }): Promise<string>;
  buildTopUp(owner: string, channel: string, amount: bigint): Promise<string>;
  buildCloseStart(owner: string, channel: string): Promise<string>;
  buildRefund(owner: string, channel: string): Promise<string>;
  /** Dirección del canal que creó una apertura ya confirmada. */
  openedChannel(hash: string): Promise<string>;
  /** Saldo que queda en el canal y total ya cobrado por Kiba. */
  read(channel: string): Promise<{ balance: bigint; withdrawn: bigint }>;
  /**
   * Estado en la red de cada canal:
   *   - `closeEffective`: ledger en que se hace efectivo el cierre (null = nadie pidió el retiro).
   *     Sirve para enterarse de los retiros pedidos directamente al contrato, sin pasar por Kiba.
   *   - `liveUntil`: hasta qué ledger tiene pagada su vida (null = ya está archivado).
   */
  inspect(channels: string[]): Promise<Map<string, ChannelOnChain>>;
  /** Renueva la vida del canal (y lo restaura antes si está archivado). Devuelve el hash. */
  keepAlive(channel: string): Promise<string>;
  /** Mantiene viva la fábrica de canales (sin ella no se pueden abrir canales nuevos). */
  maintainFactory(): Promise<void>;
  /** Bytes del compromiso «de este canal llevo gastado `amount`» (lo que firma la clave de gasto). */
  commitment(channel: string, amount: bigint): Buffer;
  /** Cobra hasta `amount` sin cerrar el canal. Devuelve el hash. */
  settle(channel: string, amount: bigint, sig: Buffer): Promise<string>;
  /** Cobra hasta `amount`, cierra el canal y devuelve el resto al usuario. Devuelve el hash. */
  close(channel: string, amount: bigint, sig: Buffer): Promise<string>;
}

export interface ChannelOnChain {
  closeEffective: number | null;
  liveUntil: number | null;
}

const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

/** Entrada de instancia de un contrato: su configuración y su plazo de vida. */
const instanceKey = (contract: string) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
/** Entrada donde el token guarda el saldo de un contrato (ahí está el depósito). */
const balanceKey = (token: string, holder: string) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(token).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), new Address(holder).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
const codeKey = (wasmHash: Buffer) => xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: wasmHash }));

/** Bytes del compromiso: ScVal::Map {amount, channel, domain: "chancmmt", network} en XDR. */
export function commitmentBytes(networkPassphrase: string, channel: string, amount: bigint): Buffer {
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    entry('amount', i128(amount)),
    entry('channel', new Address(channel).toScVal()),
    entry('domain', xdr.ScVal.scvSymbol('chancmmt')),
    entry('network', xdr.ScVal.scvBytes(createHash('sha256').update(networkPassphrase).digest())),
  ]).toXDR();
}

function treasuryKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32)));
}

class StellarChannelChain implements ChannelChain {
  private readonly cfg = resolveChainConfig();
  private readonly server = new rpc.Server(this.cfg.rpcUrl);
  private readonly factory: Contract;
  private readonly treasury = treasuryKeypair();
  private readonly collector = collectorKeypair();
  private funded = false;

  constructor(factoryId: string) {
    this.factory = new Contract(factoryId);
  }

  recipient(): string {
    return this.treasury.publicKey();
  }

  commitment(channel: string, amount: bigint): Buffer {
    return commitmentBytes(this.cfg.networkPassphrase, channel, amount);
  }

  /** Transacción de un solo llamado, fuente = el usuario; la comisión la paga Kiba al enviarla. */
  private async userTx(owner: string, op: xdr.Operation): Promise<string> {
    const build = async () =>
      new TransactionBuilder(await this.server.getAccount(owner), {
        fee: '100',
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(PREPARED_TTL_S)
        .build();
    // Si lo que toca la transacción está archivado, Kiba lo restaura antes de prepararla.
    const sim = await this.server.simulateTransaction(await build());
    if (rpc.Api.isSimulationRestore(sim)) {
      await serialCollector(() => this.footprintTx(Operation.restoreFootprint({}), sim.restorePreamble.transactionData.build()));
    }
    return (await this.server.prepareTransaction(await build())).toXDR();
  }

  /** Transacción del collector que solo renueva o restaura entradas (no llama a ningún contrato). */
  private async footprintTx(op: xdr.Operation, data: xdr.SorobanTransactionData): Promise<string> {
    await this.ensureCollectorFunded();
    let tx = new TransactionBuilder(await this.server.getAccount(this.collector.publicKey()), {
      fee: '100000',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setSorobanData(data)
      .setTimeout(60)
      .build();
    tx = await this.server.prepareTransaction(tx);
    tx.sign(this.collector);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      throw new Error(`[channel] renovación rechazada al enviar: ${sent.errorResult?.result().switch().name ?? 'ERROR'}`);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 60 });
    if (res.status !== 'SUCCESS') throw new Error(`[channel] renovación ${sent.hash} ${res.status}`);
    return sent.hash;
  }

  /**
   * Entradas propias de un contrato y hasta cuándo viven: su instancia y, si se da `token`, su
   * saldo en ese token. Con `withCode` se incluye también su código, que es compartido por todos
   * los contratos creados del mismo molde y pesa mucho más: los canales no lo renuevan cada uno,
   * lo mantiene `maintainFactory`. `liveUntil` null = alguna entrada está archivada o no existe.
   */
  private async entriesOf(
    contracts: string[],
    token?: string,
    withCode = false,
  ): Promise<Map<string, { keys: xdr.LedgerKey[]; liveUntil: number | null; closeEffective: number | null; wasm: Buffer | null }>> {
    const out = new Map<string, { keys: xdr.LedgerKey[]; liveUntil: number | null; closeEffective: number | null; wasm: Buffer | null }>();
    const latest = (await this.server.getHealth()).latestLedger;
    const live = (seq: number | undefined) => (seq !== undefined && seq >= latest ? seq : null);
    for (let i = 0; i < contracts.length; i += 50) {
      const chunk = contracts.slice(i, i + 50);
      const instances = new Map<string, { liveUntil: number | null; wasm: Buffer | null; closeEffective: number | null }>();
      const balances = new Map<string, number | null>();
      const res = await this.server.getLedgerEntries(
        ...chunk.map(instanceKey),
        ...(token ? chunk.map((c) => balanceKey(token, c)) : []),
      );
      for (const e of res.entries) {
        const data = e.val.contractData();
        const owner = Address.fromScAddress(data.contract()).toString();
        if (data.key().switch() === xdr.ScValType.scvLedgerKeyContractInstance()) {
          const inst = data.val().instance();
          let closeEffective: number | null = null;
          for (const it of inst.storage() ?? []) {
            const k = scValToNative(it.key()) as unknown;
            if (Array.isArray(k) && k[0] === 'CloseEffectiveAtLedger') closeEffective = Number(scValToNative(it.val()));
          }
          const exe = inst.executable();
          const wasm = exe.switch() === xdr.ContractExecutableType.contractExecutableWasm() ? Buffer.from(exe.wasmHash()) : null;
          instances.set(owner, { liveUntil: live(e.liveUntilLedgerSeq), wasm, closeEffective });
        } else {
          // Saldo: la entrada es del token; el titular va dentro de la clave.
          const holder = Address.fromScVal(data.key().vec()![1]).toString();
          balances.set(holder, live(e.liveUntilLedgerSeq));
        }
      }
      const hashes = withCode ? [...new Set([...instances.values()].filter((v) => v.wasm).map((v) => v.wasm!.toString('hex')))] : [];
      const codeLive = new Map<string, number | null>();
      if (hashes.length) {
        const codes = await this.server.getLedgerEntries(...hashes.map((h) => codeKey(Buffer.from(h, 'hex'))));
        for (const e of codes.entries) codeLive.set(Buffer.from(e.val.contractCode().hash()).toString('hex'), live(e.liveUntilLedgerSeq));
      }
      for (const c of chunk) {
        const inst = instances.get(c);
        const keys = [instanceKey(c)];
        if (token) keys.push(balanceKey(token, c));
        if (!inst) {
          out.set(c, { keys, liveUntil: null, closeEffective: null, wasm: null });
          continue;
        }
        const lives: (number | null)[] = [inst.liveUntil];
        if (withCode && inst.wasm) {
          keys.push(codeKey(inst.wasm));
          lives.push(codeLive.get(inst.wasm.toString('hex')) ?? null);
        }
        // Un canal sin saldo aún no tiene entrada de saldo: no cuenta.
        if (token && balances.has(c)) lives.push(balances.get(c)!);
        out.set(c, {
          keys,
          liveUntil: lives.includes(null) ? null : Math.min(...(lives as number[])),
          closeEffective: inst.closeEffective,
          wasm: inst.wasm,
        });
      }
    }
    return out;
  }

  async inspect(channels: string[]): Promise<Map<string, ChannelOnChain>> {
    const out = new Map<string, ChannelOnChain>();
    for (const [c, v] of await this.entriesOf(channels, getSpendChain().tokenContract())) {
      out.set(c, { closeEffective: v.closeEffective, liveUntil: v.liveUntil });
    }
    return out;
  }

  /** Restaura (si `archived`) y renueva el plazo de un grupo de entradas. */
  private renewKeys(keys: xdr.LedgerKey[], archived: boolean): Promise<string> {
    return serialCollector(async () => {
      if (archived) await this.footprintTx(Operation.restoreFootprint({}), new SorobanDataBuilder().setReadWrite(keys).build());
      return this.footprintTx(
        Operation.extendFootprintTtl({ extendTo: CHANNEL_TTL_EXTEND_LEDGERS }),
        new SorobanDataBuilder().setReadOnly(keys).build(),
      );
    });
  }

  async keepAlive(channel: string): Promise<string> {
    // Solo lo propio del canal: su instancia y su saldo. El código lo mantiene `maintainFactory`.
    const info = (await this.entriesOf([channel], getSpendChain().tokenContract())).get(channel)!;
    return this.renewKeys(info.keys, info.liveUntil === null);
  }

  private factoryCheckedAt = 0;
  private channelCode: Buffer | null = null;
  /** Molde de los canales: el código que la fábrica usa para crear cada uno. */
  private async channelCodeHash(): Promise<Buffer> {
    if (this.channelCode) return this.channelCode;
    const tx = new TransactionBuilder(new Account(this.collector.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(this.factory.call('wasm_hash'))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`[channel] wasm_hash: ${sim.error}`);
    return (this.channelCode = Buffer.from(scValToNative(sim.result!.retval) as Uint8Array));
  }

  /**
   * Lo compartido por todos los canales: la fábrica (instancia y código) y el molde de los
   * canales. Sin esto no se abren canales nuevos ni funcionan los existentes.
   */
  async maintainFactory(): Promise<void> {
    // Una vez por hora basta: su plazo se mide en días.
    if (Date.now() - this.factoryCheckedAt < 3_600_000) return;
    const id = this.factory.contractId();
    const latest = (await this.server.getHealth()).latestLedger;
    const info = (await this.entriesOf([id], undefined, true)).get(id)!;
    let liveUntil = info.liveUntil;
    const keys = [...info.keys];
    if (liveUntil !== null) {
      // Con la fábrica archivada no se le puede preguntar el molde: primero se restaura ella.
      const mold = codeKey(await this.channelCodeHash());
      keys.push(mold);
      const e = (await this.server.getLedgerEntries(mold)).entries[0];
      const moldLive = e?.liveUntilLedgerSeq !== undefined && e.liveUntilLedgerSeq >= latest ? e.liveUntilLedgerSeq : null;
      liveUntil = moldLive === null ? null : Math.min(liveUntil, moldLive);
    }
    if (liveUntil === null || liveUntil - latest < CHANNEL_TTL_MIN_LEDGERS) {
      const hash = await this.renewKeys(keys, liveUntil === null);
      console.log(`[channel] fábrica y molde ${liveUntil === null ? 'restaurados y renovados' : 'renovados'}: ${hash}`);
      // Si faltaba el molde por estar la fábrica archivada, la próxima pasada lo cubre.
      if (keys.length === info.keys.length) return;
    }
    this.factoryCheckedAt = Date.now();
  }

  buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }): Promise<string> {
    return this.userTx(
      a.owner,
      this.factory.call(
        'open',
        xdr.ScVal.scvBytes(a.salt),
        new Address(getSpendChain().tokenContract()).toScVal(),
        new Address(a.owner).toScVal(),
        xdr.ScVal.scvBytes(a.commitmentKey),
        new Address(this.recipient()).toScVal(),
        i128(a.amount),
        nativeToScVal(a.waitLedgers, { type: 'u32' }),
      ),
    );
  }

  buildTopUp(owner: string, channel: string, amount: bigint): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('top_up', i128(amount)));
  }

  buildCloseStart(owner: string, channel: string): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('close_start'));
  }

  buildRefund(owner: string, channel: string): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('refund'));
  }

  async openedChannel(hash: string): Promise<string> {
    const r = await this.server.getTransaction(hash);
    if (r.status !== 'SUCCESS' || !r.returnValue) throw new Error(`[channel] apertura ${hash} sin resultado`);
    return Address.fromScVal(r.returnValue).toString();
  }

  private async view(channel: string, fn: string): Promise<bigint> {
    const tx = new TransactionBuilder(new Account(this.collector.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(new Contract(channel).call(fn))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`[channel] ${fn}: ${sim.error}`);
    return BigInt(scValToNative(sim.result!.retval) as bigint);
  }

  async read(channel: string): Promise<{ balance: bigint; withdrawn: bigint }> {
    const [balance, withdrawn] = await Promise.all([this.view(channel, 'balance'), this.view(channel, 'withdrawn')]);
    return { balance, withdrawn };
  }

  private async ensureCollectorFunded(): Promise<void> {
    if (this.funded) return;
    try {
      await this.server.getAccount(this.collector.publicKey());
    } catch {
      if (!this.cfg.friendbotUrl) throw new Error(`[channel] collector ${this.collector.publicKey()} sin fondos (XLM)`);
      await fetch(`${this.cfg.friendbotUrl}?addr=${this.collector.publicKey()}`);
    }
    this.funded = true;
  }

  /**
   * Llamada de Kiba al canal (`settle` o `close`). El contrato exige la autorización de la
   * tesorería (la receptora); la transacción la envía y la paga el collector, así no compite
   * por el número de secuencia de la tesorería.
   */
  private kibaCall(channel: string, fn: 'settle' | 'close', amount: bigint, sig: Buffer): Promise<string> {
    return serialCollector(async () => {
      await this.ensureCollectorFunded();
      const source = this.collector.publicKey();
      const call = new Contract(channel).call(fn, i128(amount), xdr.ScVal.scvBytes(sig));
      let seq = (await this.server.getAccount(source)).sequenceNumber();
      const build = (op: xdr.Operation) =>
        new TransactionBuilder(new Account(source, seq), { fee: '100000', networkPassphrase: this.cfg.networkPassphrase })
          .addOperation(op)
          .setTimeout(60)
          .build();
      // 1) Simular para saber qué autorización pide; 2) firmarla con la tesorería; 3) preparar y enviar.
      let sim = await this.server.simulateTransaction(build(call));
      if (rpc.Api.isSimulationRestore(sim)) {
        // El canal está archivado: se restaura y se vuelve a simular.
        await this.footprintTx(Operation.restoreFootprint({}), sim.restorePreamble.transactionData.build());
        seq = (await this.server.getAccount(source)).sequenceNumber();
        sim = await this.server.simulateTransaction(build(call));
      }
      if (rpc.Api.isSimulationError(sim)) throw new Error(`[channel] ${fn}: ${sim.error}`);
      const auth = await Promise.all(
        (sim.result?.auth ?? []).map((e) => authorizeEntry(e, this.treasury, sim.latestLedger + 100, this.cfg.networkPassphrase)),
      );
      const func = call.body().invokeHostFunctionOp().hostFunction();
      const tx = await this.server.prepareTransaction(build(Operation.invokeHostFunction({ func, auth })));
      tx.sign(this.collector);
      const sent = await this.server.sendTransaction(tx);
      if (sent.status === 'ERROR') {
        throw new Error(`[channel] ${fn} rechazada al enviar: ${sent.errorResult?.result().switch().name ?? 'ERROR'}`);
      }
      const res = await this.server.pollTransaction(sent.hash, { attempts: 60 });
      if (res.status !== 'SUCCESS') throw new Error(`[channel] ${fn} ${sent.hash} ${res.status}`);
      return sent.hash;
    });
  }

  settle(channel: string, amount: bigint, sig: Buffer): Promise<string> {
    return this.kibaCall(channel, 'settle', amount, sig);
  }

  close(channel: string, amount: bigint, sig: Buffer): Promise<string> {
    return this.kibaCall(channel, 'close', amount, sig);
  }
}

/** Fábrica de canales configurada, o null si los depósitos están apagados. */
export function channelFactoryId(): string | null {
  const v = process.env.KIBA_CHANNEL_FACTORY_ID;
  if (v === '0') return null;
  if (v) return v;
  return resolveChainConfig().networkPassphrase === Networks.TESTNET ? TESTNET_FACTORY : null;
}

let chain: ChannelChain | null = null;
let injected = false;
function getChain(): ChannelChain {
  if (chain) return chain;
  const id = channelFactoryId();
  if (!id) throw new Error('los depósitos no están disponibles');
  return (chain = new StellarChannelChain(id));
}
/** Pruebas contra la red real: el acceso a la cadena en uso. */
export const chainForTests = (): ChannelChain => getChain();
/** Tests: sustituye el acceso a la cadena (null = el real). */
export function setChannelChain(c: ChannelChain | null): void {
  chain = c;
  injected = c !== null;
}
const enabled = () => injected || channelFactoryId() !== null;
/** true si este gateway acepta depósitos. */
export const channelsEnabled = enabled;

// ─── Clave de gasto ─────────────────────────────────────────────────────────

/** Clave de gasto del canal, derivada del seed de la tesorería y del `salt` del canal. */
function commitmentKeypair(salt: string): Keypair {
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return Keypair.fromRawEd25519Seed(
    createHash('sha256').update('kiba:channel-commitment:').update(seed).update(Buffer.from(salt, 'hex')).digest(),
  );
}

function signCommitment(row: ChannelRow, amount: number): Buffer {
  return commitmentKeypair(row.salt).sign(getChain().commitment(row.channel!, BigInt(amount)));
}

// ─── Estado por usuario ─────────────────────────────────────────────────────

export type ChannelState = 'preparing' | 'open' | 'closing' | 'liquidating' | 'closed';
const LIVE = `('open','closing','liquidating')`;

interface ChannelRow {
  id: number;
  user_id: number;
  address: string;
  kind: string;
  salt: string;
  channel: string | null;
  wait_ledgers: number;
  deposited: number;
  spent: number;
  settled: number;
  held: number;
  unsettled_since: number | null;
  last_active_at: number | null;
  closed_reason: string | null;
  owed: number;
  status: ChannelState;
  close_effective_ledger: number | null;
  refunded: number | null;
  created_at: number;
  closed_at: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);
const num = (r: ChannelRow): ChannelRow => ({
  ...r,
  id: Number(r.id),
  deposited: Number(r.deposited),
  spent: Number(r.spent),
  settled: Number(r.settled),
  held: Number(r.held ?? 0),
  unsettled_since: r.unsettled_since == null ? null : Number(r.unsettled_since),
  last_active_at: r.last_active_at == null ? null : Number(r.last_active_at),
  owed: Number(r.owed ?? 0),
  close_effective_ledger: r.close_effective_ledger === null ? null : Number(r.close_effective_ledger),
  refunded: r.refunded === null ? null : Number(r.refunded),
  created_at: Number(r.created_at),
  closed_at: r.closed_at === null ? null : Number(r.closed_at),
});

async function liveChannel(userId: number): Promise<ChannelRow | undefined> {
  const r = (await db.prepare(`SELECT * FROM pay_channels WHERE user_id = ? AND status IN ${LIVE}`).get(userId)) as
    | ChannelRow
    | undefined;
  return r && num(r);
}

async function channelById(id: number): Promise<ChannelRow> {
  return num((await db.prepare('SELECT * FROM pay_channels WHERE id = ?').get(id)) as ChannelRow);
}

async function addMove(channelId: number, kind: string, amount: number, hash: string | null): Promise<void> {
  await db
    .prepare('INSERT INTO pay_channel_moves (channel_id, kind, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(channelId, kind, amount, hash, nowS());
}

/** true si el usuario tiene un depósito abierto con el que pagar. */
export async function hasOpenChannel(userId: number): Promise<boolean> {
  return (await liveChannel(userId))?.status === 'open';
}

// ─── Transacciones que firma el usuario ─────────────────────────────────────

/**
 * Prepara la apertura del canal con su depósito inicial. La wallet debe existir y aceptar USDC
 * (ver `prepareActivation` en spend.ts) y tener el monto.
 */
export async function prepareChannelOpen(
  userId: number,
  args: { address: string; amount: number; kind?: 'privy' | 'external' },
): Promise<PreparedTx & { amountBaseUnits: number; waitLedgers: number }> {
  const c = getChain();
  const sc = getSpendChain();
  if (!ADDRESS_RE.test(args.address)) throw new Error('dirección Stellar inválida');
  if (!Number.isInteger(args.amount) || args.amount < CHANNEL_MIN_DEPOSIT) {
    throw new Error(`el depósito mínimo es ${CHANNEL_MIN_DEPOSIT / 1e7} USDC`);
  }
  if (await liveChannel(userId)) throw new Error('ya tienes un depósito abierto; recárgalo o liquídalo');
  const taken =
    (await db.prepare(`SELECT 1 FROM pay_channels WHERE address = ? AND user_id <> ? AND status IN ${LIVE}`).get(args.address, userId)) ||
    (await db.prepare('SELECT 1 FROM users WHERE spend_address = ? AND id <> ?').get(args.address, userId));
  if (taken) throw new Error('esa wallet ya está vinculada a otra cuenta');
  const state = await sc.accountState(args.address);
  if (!state.exists || !state.trustline) throw new Error('activa la wallet primero');
  const { balance } = await sc.read(args.address);
  if (balance < BigInt(args.amount)) throw new Error('la wallet no tiene ese monto en USDC');

  // Aperturas preparadas y nunca firmadas no dejan rastro.
  await db.prepare(`DELETE FROM pay_channels WHERE user_id = ? AND status = 'preparing'`).run(userId);
  const salt = randomBytes(32).toString('hex');
  const row = (await db
    .prepare(
      `INSERT INTO pay_channels (user_id, address, kind, salt, wait_ledgers, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'preparing', ?) RETURNING id`,
    )
    .get(userId, args.address, args.kind ?? 'external', salt, CHANNEL_WAIT_LEDGERS, nowS())) as { id: number };
  const built = await c.buildOpen({
    owner: args.address,
    salt: Buffer.from(salt, 'hex'),
    commitmentKey: commitmentKeypair(salt).rawPublicKey(),
    amount: BigInt(args.amount),
    waitLedgers: CHANNEL_WAIT_LEDGERS,
  });
  const p = await storePrepared(userId, 'channel_open', args.address, built, { channelId: Number(row.id), amount: args.amount });
  return { ...p, amountBaseUnits: args.amount, waitLedgers: CHANNEL_WAIT_LEDGERS };
}

/** Prepara una recarga del canal abierto. */
export async function prepareChannelTopUp(userId: number, amount: number): Promise<PreparedTx & { amountBaseUnits: number }> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') throw new Error('no tienes un depósito abierto');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('monto inválido');
  const { balance } = await getSpendChain().read(ch.address);
  if (balance < BigInt(amount)) throw new Error('la wallet no tiene ese monto en USDC');
  const built = await c.buildTopUp(ch.address, ch.channel!, BigInt(amount));
  const p = await storePrepared(userId, 'channel_topup', ch.address, built, { channelId: ch.id, amount });
  return { ...p, amountBaseUnits: amount };
}

/**
 * Retiro con espera, paso 1: el usuario pide el cierre. Desde ese momento no se anota más
 * consumo y Kiba cobra lo pendiente; pasado el plazo del canal, el usuario retira el resto.
 */
export async function prepareChannelCloseStart(userId: number): Promise<PreparedTx> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') throw new Error('no tienes un depósito abierto');
  const built = await c.buildCloseStart(ch.address, ch.channel!);
  return storePrepared(userId, 'channel_close_start', ch.address, built, { channelId: ch.id });
}

/** Retiro con espera, paso 2: pasado el plazo, el usuario retira lo que queda en el canal. */
export async function prepareChannelRefund(userId: number): Promise<PreparedTx & { amountBaseUnits: number }> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'closing') throw new Error('primero pide el retiro');
  const latest = await getSpendChain().latestLedger();
  if (ch.close_effective_ledger !== null && latest < ch.close_effective_ledger) {
    const mins = Math.ceil(((ch.close_effective_ledger - latest) * 5) / 60);
    throw new Error(`el retiro estará disponible en unos ${mins} min`);
  }
  // Lo consumido se cobra antes: el retiro se lleva TODO lo que quede en el canal.
  await settleChannel(userId);
  const { balance } = await c.read(ch.channel!);
  const built = await c.buildRefund(ch.address, ch.channel!);
  const p = await storePrepared(userId, 'channel_refund', ch.address, built, { channelId: ch.id, amount: Number(balance) });
  return { ...p, amountBaseUnits: Number(balance) };
}

onPreparedSent('channel_open', async ({ userId, address, meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount);
  const channel = await getChain().openedChannel(hash);
  // Firmó la apertura con esta wallet: queda como la wallet de la cuenta.
  const kind = ((await db.prepare('SELECT kind FROM pay_channels WHERE id = ?').get(id)) as { kind: string } | undefined)?.kind;
  await linkWallet(userId, address, kind === 'privy' ? 'privy' : 'external');
  await db
    .prepare(`UPDATE pay_channels SET channel = ?, deposited = ?, status = 'open', last_active_at = ? WHERE id = ? AND status = 'preparing'`)
    .run(channel, amount, nowS(), id);
  await addMove(id, 'open', amount, hash);
});

onPreparedSent('channel_topup', async ({ meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount);
  await db.prepare('UPDATE pay_channels SET deposited = deposited + ?, last_active_at = ? WHERE id = ?').run(amount, nowS(), id);
  await addMove(id, 'top_up', amount, hash);
});

onPreparedSent('channel_close_start', async ({ userId, meta, hash }) => {
  const id = Number(meta.channelId);
  const ch = await channelById(id);
  // El cierre se hace efectivo `wait_ledgers` después del ledger de la transacción, que ya pasó:
  // contar desde el último ledger da un momento igual o posterior (el contrato decide el real).
  const effective = (await getSpendChain().latestLedger()) + ch.wait_ledgers;
  await db
    .prepare(`UPDATE pay_channels SET status = 'closing', close_effective_ledger = ? WHERE id = ? AND status = 'open'`)
    .run(effective, id);
  await addMove(id, 'close_start', 0, hash);
  // Kiba cobra lo consumido dentro de la espera; si falla aquí, se reintenta al preparar el retiro.
  await settleChannel(userId).catch((err) => console.error('[channel] cobro tras pedir retiro:', (err as Error).message));
});

onPreparedSent('channel_refund', async ({ meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount ?? 0);
  await db
    .prepare(`UPDATE pay_channels SET status = 'closed', refunded = ?, closed_at = ? WHERE id = ? AND status = 'closing'`)
    .run(amount, nowS(), id);
  await countOverCollected(id);
  await addMove(id, 'refund', amount, hash);
});

// ─── Consumo por llamada ────────────────────────────────────────────────────

export type ChannelReserve =
  | { ok: true; holdId: number; channelId: number; amount: number; /** Lo que queda para gastar tras apartar. */ left: number }
  | { ok: false; reason: 'none' | 'insufficient'; available: number };

/** Suelta lo apartado por llamadas que nunca terminaron (el proceso murió a mitad). */
async function sweepStaleHolds(): Promise<void> {
  await db
    .prepare(
      `WITH h AS (DELETE FROM pay_channel_holds WHERE created_at < ? RETURNING channel_id, amount),
            s AS (SELECT channel_id, SUM(amount) AS total FROM h GROUP BY channel_id)
       UPDATE pay_channels c SET held = GREATEST(0, c.held - s.total) FROM s WHERE c.id = s.channel_id`,
    )
    .run(nowS() - HOLD_TTL_S);
}

/**
 * Aparta `amount` del depósito para una llamada. Es una sola sentencia atómica: dos llamadas
 * simultáneas nunca apartan más de lo disponible (depositado − consumido − apartado).
 * `reason: 'none'` = el usuario no tiene un depósito abierto.
 */
export async function reserveChannel(userId: number, amount: number): Promise<ChannelReserve> {
  if (!enabled()) return { ok: false, reason: 'none', available: 0 };
  const row = (await db
    .prepare(
      `WITH gate AS (
         UPDATE pay_channels SET held = held + ?
         WHERE user_id = ? AND status = 'open' AND deposited - spent - held >= ?
         RETURNING id, deposited - spent - held AS left_after
       )
       INSERT INTO pay_channel_holds (channel_id, amount, created_at)
       SELECT id, ?, ? FROM gate
       RETURNING id, channel_id, (SELECT left_after FROM gate) AS left_after`,
    )
    .get(amount, userId, amount, amount, nowS())) as { id: number; channel_id: number; left_after: number } | undefined;
  if (row) return { ok: true, holdId: Number(row.id), channelId: Number(row.channel_id), amount, left: Number(row.left_after) };
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') return { ok: false, reason: 'none', available: 0 };
  return { ok: false, reason: 'insufficient', available: Math.max(0, ch.deposited - ch.spent - ch.held) };
}

/** La llamada falló: lo apartado vuelve a estar disponible. */
export async function releaseChannel(r: { holdId: number }): Promise<void> {
  await db
    .prepare(
      `WITH h AS (DELETE FROM pay_channel_holds WHERE id = ? RETURNING channel_id, amount)
       UPDATE pay_channels c SET held = GREATEST(0, c.held - h.amount) FROM h WHERE c.id = h.channel_id`,
    )
    .run(r.holdId);
}

/**
 * La llamada se sirvió: lo apartado pasa a consumido. Si lo consumido sin cobrar llega al
 * umbral, Kiba lo cobra al canal en segundo plano.
 */
export async function confirmChannel(r: { holdId: number; channelId: number; amount: number }): Promise<void> {
  const now = nowS();
  let row = (await db
    .prepare(
      `WITH h AS (DELETE FROM pay_channel_holds WHERE id = ? RETURNING channel_id, amount)
       UPDATE pay_channels c
          SET held = GREATEST(0, c.held - h.amount), spent = c.spent + h.amount,
              unsettled_since = COALESCE(c.unsettled_since, ?), last_active_at = ?
         FROM h WHERE c.id = h.channel_id
       RETURNING c.user_id, c.spent, c.settled`,
    )
    .get(r.holdId, now, now)) as { user_id: number; spent: number; settled: number } | undefined;
  if (!row) {
    // Lo apartado ya se había soltado por viejo (la llamada tardó de más): el consumo cuenta igual.
    row = (await db
      .prepare(
        `UPDATE pay_channels SET spent = spent + ?, unsettled_since = COALESCE(unsettled_since, ?), last_active_at = ?
         WHERE id = ? RETURNING user_id, spent, settled`,
      )
      .get(r.amount, now, now, r.channelId)) as { user_id: number; spent: number; settled: number } | undefined;
  }
  if (row && Number(row.spent) - Number(row.settled) >= CHANNEL_SETTLE_THRESHOLD) {
    void settleChannel(Number(row.user_id)).catch((err) => console.error('[channel] cobro por umbral:', (err as Error).message));
  }
}

/**
 * Devuelve `amount` al depósito por un reclamo aceptado. Con el canal abierto, lo consumido baja
 * y vuelve a estar disponible. Si Kiba ya había cobrado ese consumo al contrato, o el canal ya
 * no está abierto, Kiba le queda debiendo ese monto a la wallet y se lo paga (`payOwed`).
 */
export async function refundToChannel(channelId: number, amount: number): Promise<void> {
  const open = await db
    .prepare(`UPDATE pay_channels SET spent = GREATEST(0, spent - ?) WHERE id = ? AND status = 'open' RETURNING id`)
    .get(amount, channelId);
  if (open) return;
  await db.prepare('UPDATE pay_channels SET owed = owed + ? WHERE id = ?').run(amount, channelId);
}

/**
 * Al cerrarse un canal: si Kiba cobró más de lo que al final quedó consumido (por devoluciones
 * de reclamos hechas después de cobrar), esa diferencia pasa a ser deuda de Kiba con la wallet.
 * Se cuenta una sola vez por canal.
 */
async function countOverCollected(channelId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE pay_channels SET owed = owed + GREATEST(0, settled - spent), over_counted = 1
       WHERE id = ? AND over_counted = 0`,
    )
    .run(channelId);
}

/** Paga desde la tesorería lo que Kiba les debe a las wallets de canales ya cerrados. */
async function payOwed(): Promise<void> {
  const rows = (
    (await db.prepare(`SELECT * FROM pay_channels WHERE status = 'closed' AND owed > 0`).all()) as ChannelRow[]
  ).map(num);
  const sc = getSpendChain();
  const treasury = treasuryKeypair();
  for (const ch of rows) {
    // Apartar antes de pagar: dos pasadas a la vez no pagan dos veces.
    const taken = await db
      .prepare('UPDATE pay_channels SET owed = owed - ? WHERE id = ? AND owed >= ? RETURNING id')
      .get(ch.owed, ch.id, ch.owed);
    if (!taken) continue;
    try {
      const hash = await enqueueChainTask(async () => {
        const tx = TransactionBuilder.fromXDR(
          await sc.buildPayment(treasury.publicKey(), ch.address, BigInt(ch.owed)),
          sc.passphrase(),
        );
        tx.sign(treasury);
        return sc.submitSponsored(tx.toXDR());
      });
      await addMove(ch.id, 'claim_refund', ch.owed, hash);
    } catch (err) {
      await db.prepare('UPDATE pay_channels SET owed = owed + ? WHERE id = ?').run(ch.owed, ch.id);
      console.error(`[channel] pagar devolución del canal ${ch.id}:`, (err as Error).message);
    }
  }
}

/** Lo que el usuario puede gastar de su depósito ahora, o null si no tiene uno abierto. */
export async function channelAvailable(userId: number): Promise<number | null> {
  if (!enabled()) return null;
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') return null;
  return Math.max(0, ch.deposited - ch.spent - ch.held);
}

// ─── Cobros de Kiba ─────────────────────────────────────────────────────────

const settling = new Map<number, Promise<string | null>>();

/**
 * Cobra al canal lo consumido que aún no se ha cobrado, sin cerrarlo. Devuelve el hash, o null
 * si no había nada que cobrar. Un solo cobro en vuelo por usuario.
 */
export function settleChannel(userId: number): Promise<string | null> {
  const running = settling.get(userId);
  if (running) return running;
  const p = (async () => {
    const ch = await liveChannel(userId);
    if (!ch || !ch.channel || ch.status === 'liquidating' || ch.spent <= ch.settled) return null;
    const amount = ch.spent;
    const hash = await getChain().settle(ch.channel, BigInt(amount), signCommitment(ch, amount));
    // Si entró consumo nuevo mientras se cobraba, sigue contando desde ahora.
    await db
      .prepare(
        `UPDATE pay_channels SET settled = GREATEST(settled, ?),
                unsettled_since = CASE WHEN spent > ?::bigint THEN ?::bigint ELSE NULL END
         WHERE id = ?`,
      )
      .run(amount, amount, nowS(), ch.id);
    await addMove(ch.id, 'settle', amount - ch.settled, hash);
    return hash;
  })().finally(() => settling.delete(userId));
  settling.set(userId, p);
  return p;
}

export interface Liquidation {
  hash: string;
  /** Lo que Kiba cobró en esta transacción. */
  paidBaseUnits: number;
  /** Lo que volvió a la wallet del usuario. */
  refundedBaseUnits: number;
  /** Lo que quedó en el canal porque la devolución automática falló (el usuario lo retira aparte). */
  pendingBaseUnits: number;
}

/**
 * Liquida el canal: en una transacción el contrato le paga a Kiba lo consumido y devuelve el
 * resto a la wallet del usuario. El canal queda cerrado; para seguir pagando se abre otro.
 */
export async function liquidateChannel(userId: number, reason?: 'idle'): Promise<Liquidation> {
  const c = getChain();
  await sweepStaleHolds();
  const before = await liveChannel(userId);
  if (!before || !before.channel || before.status === 'liquidating') throw new Error('no tienes un depósito abierto');
  if (before.held > 0) throw new Error('hay una llamada en curso; inténtalo en unos segundos');
  await settling.get(userId)?.catch(() => null);
  // Reclamar el canal: desde aquí no se anota más consumo ni entra otra liquidación.
  const claimed = (await db
    .prepare(`UPDATE pay_channels SET status = 'liquidating' WHERE id = ? AND status = ? AND held = 0 RETURNING *`)
    .get(before.id, before.status)) as ChannelRow | undefined;
  if (!claimed) throw new Error('el depósito cambió; vuelve a intentarlo');
  const ch = num(claimed);
  // Lo que se le presenta al contrato nunca baja de lo ya cobrado: si un reclamo aceptado dejó
  // lo consumido por debajo, la diferencia se le paga a la wallet aparte (`payOwed`).
  const total = Math.max(ch.spent, ch.settled);
  let hash: string;
  try {
    hash = await c.close(ch.channel!, BigInt(total), signCommitment(ch, total));
  } catch (err) {
    await db.prepare(`UPDATE pay_channels SET status = ? WHERE id = ? AND status = 'liquidating'`).run(before.status, ch.id);
    throw new Error(String((err as Error).message).split('\n')[0]);
  }
  // Si la lectura falla, la transacción ya entró: se asume la devolución completa.
  const pending = Number((await c.read(ch.channel!).catch(() => ({ balance: 0n }))).balance);
  const paid = total - ch.settled;
  const refunded = Math.max(0, ch.deposited - total - pending);
  if (pending > 0) {
    // La wallet no pudo recibir la devolución (p. ej. dejó de aceptar USDC): el resto sigue en el
    // canal, que ya está cerrado en la red. Queda como retiro pendiente, disponible de inmediato.
    const effective = await getSpendChain().latestLedger();
    await db
      .prepare(
        `UPDATE pay_channels SET status = 'closing', settled = ?, unsettled_since = NULL, close_effective_ledger = ?, closed_reason = ? WHERE id = ?`,
      )
      .run(total, effective, reason ?? null, ch.id);
  } else {
    await db
      .prepare(
        `UPDATE pay_channels SET status = 'closed', settled = ?, unsettled_since = NULL, refunded = ?, closed_at = ?, closed_reason = ? WHERE id = ?`,
      )
      .run(total, refunded, nowS(), reason ?? null, ch.id);
    await countOverCollected(ch.id);
  }
  if (paid > 0) await addMove(ch.id, 'settle', paid, hash);
  await addMove(ch.id, 'close', refunded, hash);
  return { hash, paidBaseUnits: paid, refundedBaseUnits: refunded, pendingBaseUnits: pending };
}

// ─── Trabajo periódico ──────────────────────────────────────────────────────

/**
 * Mantiene los canales al día. Corre cada minuto:
 *   - suelta lo apartado por llamadas que nunca terminaron;
 *   - renueva la vida de los canales a los que les queda poco y restaura los archivados;
 *   - detecta los retiros pedidos directamente al contrato y los marca;
 *   - cobra lo consumido que llegó al umbral, lleva demasiado sin cobrar o está en un canal
 *     con retiro pedido (hay que cobrarlo antes de que venza la espera);
 *   - cierra los canales cuyo retiro ya se hizo por fuera.
 */
export async function runChannelJob(): Promise<void> {
  if (!enabled()) return;
  await sweepStaleHolds();
  await payOwed().catch((err) => console.error('[channel] devoluciones:', (err as Error).message));
  const rows = (
    (await db.prepare(`SELECT * FROM pay_channels WHERE status IN ('open','closing') AND channel IS NOT NULL`).all()) as ChannelRow[]
  ).map(num);
  if (rows.length === 0) return;
  const c = getChain();
  const now = nowS();
  await c.maintainFactory().catch((err) => console.error('[channel] fábrica:', (err as Error).message));

  const onchain = await c.inspect(rows.map((r) => r.channel!));
  let latest: number | null = null;
  for (const ch of rows) {
    const info = onchain.get(ch.channel!);
    if (!info) continue;
    latest ??= await getSpendChain().latestLedger();
    if (info.liveUntil !== null && info.liveUntil - latest >= CHANNEL_TTL_MIN_LEDGERS) continue;
    // Un retiro que lleva mucho disponible sin que nadie lo recoja deja de renovarse: si se
    // archiva, el dinero sigue ahí y se restaura cuando el usuario lo retire.
    if (ch.status === 'closing' && ch.close_effective_ledger !== null && latest > ch.close_effective_ledger + CHANNEL_TTL_EXTEND_LEDGERS) continue;
    try {
      const hash = await c.keepAlive(ch.channel!);
      console.log(`[channel] canal ${ch.id} ${info.liveUntil === null ? 'restaurado y renovado' : 'renovado'}: ${hash}`);
    } catch (err) {
      console.error(`[channel] renovar canal ${ch.id}:`, (err as Error).message);
    }
  }

  // Depósitos sin uso: se devuelven a la wallet.
  if (CHANNEL_IDLE_DAYS > 0) {
    for (const ch of rows) {
      if (ch.status !== 'open' || ch.held > 0) continue;
      if (now - (ch.last_active_at ?? ch.created_at) < CHANNEL_IDLE_DAYS * DAY_S) continue;
      try {
        const r = await liquidateChannel(ch.user_id, 'idle');
        ch.status = 'closed';
        console.log(`[channel] canal ${ch.id} devuelto por inactividad: ${r.hash}`);
      } catch (err) {
        console.error(`[channel] devolver canal ${ch.id} por inactividad:`, (err as Error).message);
      }
    }
  }

  for (const ch of rows.filter((r) => r.status === 'open')) {
    const eff = onchain.get(ch.channel!)?.closeEffective;
    if (eff == null) continue;
    const marked = await db
      .prepare(`UPDATE pay_channels SET status = 'closing', close_effective_ledger = ? WHERE id = ? AND status = 'open' RETURNING id`)
      .get(eff, ch.id);
    if (marked) {
      await addMove(ch.id, 'close_start', 0, null);
      ch.status = 'closing';
      ch.close_effective_ledger = eff;
    }
  }

  for (const ch of rows) {
    if (ch.status === 'closed') continue; // devuelto en esta misma pasada
    try {
      const unsettled = ch.spent - ch.settled;
      const due =
        unsettled > 0 &&
        (ch.status === 'closing' ||
          unsettled >= CHANNEL_SETTLE_THRESHOLD ||
          (ch.unsettled_since !== null && now - ch.unsettled_since >= CHANNEL_SETTLE_MAX_AGE_S));
      if (due) await settleChannel(ch.user_id);
      if (ch.status === 'closing' && ch.close_effective_ledger !== null) {
        latest ??= await getSpendChain().latestLedger();
        if (latest < ch.close_effective_ledger) continue;
        // Pasó la espera: si el canal ya está vacío, el usuario retiró por fuera.
        const { balance, withdrawn } = await c.read(ch.channel!);
        if (balance > 0n) continue;
        const refunded = Math.max(0, ch.deposited - Number(withdrawn));
        const closed = await db
          .prepare(
            `UPDATE pay_channels SET status = 'closed', settled = ?, unsettled_since = NULL, refunded = ?, closed_at = ?
             WHERE id = ? AND status = 'closing' RETURNING id`,
          )
          .get(Number(withdrawn), refunded, nowS(), ch.id);
        if (closed) {
          await countOverCollected(ch.id);
          await addMove(ch.id, 'refund', refunded, null);
        }
      }
    } catch (err) {
      console.error(`[channel] job canal ${ch.id}:`, (err as Error).message);
    }
  }
}

// ─── Estado ─────────────────────────────────────────────────────────────────

export interface ChannelStatus {
  /** false si los depósitos están apagados en este gateway. */
  enabled: boolean;
  minDepositBaseUnits: number;
  /** Espera del retiro sin Kiba para canales nuevos, en ledgers (~5 s). */
  waitLedgers: number;
  latestLedger: number | null;
  channel: null | {
    address: string;
    kind: 'privy' | 'external';
    /** Contrato del canal (C...). */
    channel: string;
    state: Exclude<ChannelState, 'preparing'>;
    depositedBaseUnits: number;
    spentBaseUnits: number;
    settledBaseUnits: number;
    /** Lo que queda para gastar o retirar: depositado − consumido. */
    availableBaseUnits: number;
    waitLedgers: number;
    closeEffectiveLedger: number | null;
    /** Estimación (unix s) de cuándo se puede retirar tras pedir el retiro, a 5 s por ledger. */
    refundAt: number | null;
    /** Cuándo se devolverá a la wallet si nadie lo usa (unix s); null si no aplica. */
    idleReturnAt: number | null;
    /** 'idle' si Kiba lo devolvió por inactividad. */
    closedReason: 'idle' | null;
  };
  /** Días de antelación con que se avisa de la devolución por inactividad. */
  idleNoticeDays: number;
  moves: { kind: string; amount: number; txHash: string | null; createdAt: number }[];
}

export async function getChannelStatus(userId: number): Promise<ChannelStatus> {
  const base = {
    enabled: enabled(),
    minDepositBaseUnits: CHANNEL_MIN_DEPOSIT,
    waitLedgers: CHANNEL_WAIT_LEDGERS,
    idleNoticeDays: CHANNEL_IDLE_NOTICE_DAYS,
  };
  if (!base.enabled) return { ...base, latestLedger: null, channel: null, moves: [] };
  // El canal vivo o, si no hay, el último cerrado (para mostrar cómo terminó).
  const row = (await db
    .prepare(
      `SELECT * FROM pay_channels WHERE user_id = ? AND status <> 'preparing'
       ORDER BY (status IN ${LIVE}) DESC, id DESC LIMIT 1`,
    )
    .get(userId)) as ChannelRow | undefined;
  if (!row) return { ...base, latestLedger: null, channel: null, moves: [] };
  const ch = num(row);
  const latest = await getSpendChain().latestLedger();
  const moves = (await db
    .prepare('SELECT kind, amount, tx_hash, created_at FROM pay_channel_moves WHERE channel_id = ? ORDER BY id DESC LIMIT 20')
    .all(ch.id)) as { kind: string; amount: number; tx_hash: string | null; created_at: number }[];
  const eff = ch.close_effective_ledger;
  return {
    ...base,
    latestLedger: latest,
    channel: {
      address: ch.address,
      kind: ch.kind as 'privy' | 'external',
      channel: ch.channel!,
      state: ch.status as Exclude<ChannelState, 'preparing'>,
      depositedBaseUnits: ch.deposited,
      spentBaseUnits: ch.spent,
      settledBaseUnits: ch.settled,
      availableBaseUnits: ch.status === 'closed' ? 0 : Math.max(0, ch.deposited - ch.spent - ch.held),
      waitLedgers: ch.wait_ledgers,
      closeEffectiveLedger: eff,
      refundAt: ch.status === 'closing' && eff !== null ? nowS() + Math.max(0, eff - latest) * 5 : null,
      idleReturnAt:
        ch.status === 'open' && CHANNEL_IDLE_DAYS > 0 ? (ch.last_active_at ?? ch.created_at) + CHANNEL_IDLE_DAYS * DAY_S : null,
      closedReason: ch.closed_reason === 'idle' ? 'idle' : null,
    },
    moves: moves.map((m) => ({ kind: m.kind, amount: Number(m.amount), txHash: m.tx_hash, createdAt: Number(m.created_at) })),
  };
}
