/**
 * Almacén de resultados por cuenta.
 *
 * Cada call_agent deja una fila en `call_results` ANTES de llamar al servicio y la completa
 * cuando el servicio responde (o falla). La llamada corre desacoplada de la request HTTP:
 * si el chat de IA corta por timeout, la llamada sigue, se cobra igual que antes y su
 * resultado queda guardado — recuperable por MCP (get_result / list_results) o en el
 * dashboard (/app/results/:id).
 *
 * call_agent espera hasta `waitMs` (CALL_WAIT_MS, 40 s por defecto — por debajo del timeout
 * típico de los clientes MCP); si el servicio no ha terminado devuelve `status: 'pending'`
 * con el `resultId` y el link, en vez de dejar que el cliente corte sin saber nada.
 */
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { callOnBehalf } from './proxy';
import { attachSettlement, issueLicenseForCall, licenseDto, licenseForCall, referenceOf, type LicenseRow } from './licenses';
import { fileDto, keepResultFiles, type ResultFileRow } from './files';
import { lamportsToUsd } from './billing';

export const CALL_WAIT_MS = Number(process.env.CALL_WAIT_MS) || 40_000;
/** Tope del long-poll de get_result (el cliente MCP también tiene timeout). */
const MAX_POLL_WAIT_MS = 30_000;

const DASHBOARD_URL = (process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3020').replace(/\/$/, '');

type CallOutput = Awaited<ReturnType<typeof callOnBehalf>>;

export type ResultStatus = 'pending' | 'done' | 'error';

export interface CallResultRow {
  id: string;
  user_id: number;
  service: string;
  payload: string;
  status: ResultStatus;
  result: string | null;
  error: string | null;
  cost_lamports: number | null;
  explorer_url: string | null;
  task_key: string | null;
  /** La llamada del usuario a la que pertenece esta, cuando la hizo un servicio mientras la servía. */
  parent_id: string | null;
  created_at: number;
  completed_at: number | null;
}

/** Un pago que un servicio hizo a otro (o a una API x402) mientras servía una llamada del usuario. */
export interface SubCallDto {
  resultId: string;
  service: string;
  status: ResultStatus;
  costBaseUnits?: number;
  costUsd?: number;
  explorerUrl?: string;
  createdAt: number;
  completedAt?: number;
}

export function resultUrl(id: string): string {
  return `${DASHBOARD_URL}/app/results/${id}`;
}

/**
 * Servicios de varios pasos (p.ej. Meshy: crear → consultar con `taskId`) reparten un mismo
 * pedido en varias llamadas. La convención `taskId` (en el payload de la consulta o en la
 * respuesta de la creación) las une bajo una clave, para mostrar el pedido como uno solo.
 */
function taskKeyOf(service: string, value: unknown): string | null {
  const taskId = (value as { taskId?: unknown } | null)?.taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? `${service}:${taskId}` : null;
}

/** Llamadas en vuelo en ESTE proceso — get_result puede esperarlas sin sondear la DB. */
const inflight = new Map<string, Promise<void>>();

/**
 * Registra la llamada y la lanza en background. Devuelve la salida completa si termina dentro
 * de `waitMs`; si no, `{ status: 'pending', resultId, resultUrl }`. Los errores del servicio
 * se propagan igual que antes cuando ocurren dentro de la espera.
 */
export async function callAndStore(
  args: {
    userId: number;
    service: string;
    payload: unknown;
    waitMs?: number;
    /** Llamada padre ya validada (resolveParentCall): esta llamada la hace un servicio mientras la sirve. */
    parentId?: string | null;
  },
  call: typeof callOnBehalf = callOnBehalf, // inyectable en tests
): Promise<
  | (CallOutput & {
      status: 'done';
      resultId: string;
      resultUrl: string;
      license?: Record<string, unknown>;
      /** Archivos de la respuesta copiados a la cuenta (files.ts); sus enlaces ya van reescritos en `result`. */
      files?: Record<string, unknown>[];
      /** Lo que el servicio pagó a otros servicios o APIs mientras servía esta llamada. */
      subCalls?: SubCallDto[];
    })
  | { status: 'pending'; resultId: string; resultUrl: string; service: string; message: string }
> {
  const id = `res_${randomBytes(12).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO call_results (id, user_id, service, payload, status, task_key, parent_id, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(
      id,
      args.userId,
      args.service,
      JSON.stringify(args.payload ?? {}),
      taskKeyOf(args.service, args.payload),
      args.parentId ?? null,
      now,
    );

  let output: CallOutput | undefined;
  let failure: Error | undefined;
  let license: LicenseRow | null = null;
  let files: ResultFileRow[] = [];
  // Si el servicio entregó un archivo con licencia, el documento se escribe ANTES de pagar y su
  // huella viaja en el pago por llamada (modo crédito). Nunca falla la llamada.
  const issue = async (result: unknown, costLamports: number | null, payTo?: string, explorerUrl?: string) => {
    license ??= await issueLicenseForCall({
      callId: id,
      userId: args.userId,
      service: args.service,
      result,
      costLamports,
      payTo,
      explorerUrl,
    });
    return license;
  };
  const onBeforePay = async (result: unknown, info: { lamports: number; payTo: string }) => {
    const row = await issue(result, info.lamports, info.payTo);
    return row ? referenceOf(row.doc_sha256) : undefined;
  };
  // El link on-chain del modo crédito llega después de la respuesta: se guarda en el resultado.
  const onExplorerUrl = (url: string) =>
    void db
      .prepare('UPDATE call_results SET explorer_url = ? WHERE id = ?')
      .run(url, id)
      .then(() => attachSettlement(id, url))
      .catch((err: Error) => console.log(`[results] no se pudo guardar el link de ${id}:`, err.message));
  const task = call({
    userId: args.userId,
    service: args.service,
    payload: args.payload,
    onExplorerUrl,
    onBeforePay,
    callId: id,
  })
    .then(async (out) => {
      output = out;
      // Los archivos que trae la respuesta (modelo, texturas, audio, medios comprados) se copian a
      // Kiba y sus enlaces se reescriben ANTES de guardar y de responder: lo guardado es lo que se
      // entrega, y no caduca cuando el proveedor borre el original.
      const kept = await keepResultFiles({ resultId: id, userId: args.userId, result: out.result }).catch(
        (err: Error) => {
          console.log(`[results] ${id}: no se copiaron los archivos:`, err.message);
          return null;
        },
      );
      if (kept && kept.files.length > 0) {
        files = kept.files;
        out = { ...out, result: kept.result };
        output = out;
      }
      await db
        .prepare(
          `UPDATE call_results SET status = 'done', result = ?, cost_lamports = ?,
           explorer_url = COALESCE(?, explorer_url),
           task_key = COALESCE(task_key, ?), completed_at = ? WHERE id = ?`,
        )
        .run(
          JSON.stringify(out.result ?? null),
          out.cost.lamports,
          out.explorerUrl ?? null,
          taskKeyOf(args.service, out.result),
          Math.floor(Date.now() / 1000),
          id,
        );
      // Si la llamada no pasó por onBeforePay (otros modos de pago), el documento se escribe aquí;
      // si el pago ya confirmó en línea, se ancla.
      await issue(out.result, out.cost.lamports, undefined, out.explorerUrl);
      if (license && out.explorerUrl) await attachSettlement(id, out.explorerUrl);
      // El hash on-chain puede haber llegado antes de que existiera la fila de la licencia
      // (attachSettlement no encontró nada): se recupera de call_results.
      if (license && !license.tx_hash) {
        const row = await db
          .prepare('SELECT explorer_url FROM call_results WHERE id = ?')
          .get<{ explorer_url: string | null }>(id);
        if (row?.explorer_url) {
          await attachSettlement(id, row.explorer_url);
          license = (await licenseForCall(id)) ?? license;
        }
      }
    })
    .catch(async (err) => {
      // El servicio respondió pero falló el UPDATE: la llamada no es un error para el cliente.
      if (output) return console.log(`[results] no se pudo guardar el resultado de ${id}:`, err);
      failure = err instanceof Error ? err : new Error(String(err));
      await db
        .prepare(`UPDATE call_results SET status = 'error', error = ?, completed_at = ? WHERE id = ?`)
        .run(failure.message, Math.floor(Date.now() / 1000), id)
        .catch((e) => console.log(`[results] no se pudo guardar el error de ${id}:`, e));
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, task);

  const finished = await waitFor(task, args.waitMs ?? CALL_WAIT_MS);
  if (finished && failure) throw failure;
  if (finished && output) {
    return {
      ...output,
      status: 'done',
      resultId: id,
      resultUrl: resultUrl(id),
      ...(license ? { license: licenseDto(license) } : {}),
      ...(files.length > 0 ? { files: files.map(fileDto) } : {}),
      ...(await subCallsField(id)),
    };
  }
  return {
    status: 'pending',
    resultId: id,
    resultUrl: resultUrl(id),
    service: args.service,
    message:
      'El servicio sigue trabajando. El resultado se guardará en la cuenta: consúltalo con get_result(resultId) en unos segundos, o ábrelo en resultUrl.',
  };
}

async function waitFor(task: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const done = await Promise.race([
    task.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return done;
}

/** Un resultado de la cuenta (null si no existe o es de otro usuario). Long-poll opcional. */
export async function getResult(
  userId: number,
  id: string,
  waitMs = 0,
): Promise<CallResultRow | null> {
  const row = await db
    .prepare('SELECT * FROM call_results WHERE id = ? AND user_id = ?')
    .get<CallResultRow>(id, userId);
  if (!row || row.status !== 'pending' || waitMs <= 0) return row ?? null;
  const task = inflight.get(id);
  if (task) await waitFor(task, Math.min(waitMs, MAX_POLL_WAIT_MS));
  return (await db
    .prepare('SELECT * FROM call_results WHERE id = ? AND user_id = ?')
    .get<CallResultRow>(id, userId)) ?? null;
}

/** Las demás llamadas del mismo pedido (mismo task_key), en orden cronológico. */
export async function relatedResults(row: CallResultRow): Promise<CallResultRow[]> {
  if (!row.task_key) return [];
  return db
    .prepare(
      `SELECT * FROM call_results WHERE user_id = ? AND task_key = ? AND id <> ?
       ORDER BY created_at ASC LIMIT 50`,
    )
    .all<CallResultRow>(row.user_id, row.task_key, row.id);
}

export async function listResults(userId: number, limit = 20): Promise<CallResultRow[]> {
  return db
    .prepare('SELECT * FROM call_results WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all<CallResultRow>(userId, Math.min(Math.max(limit, 1), 200));
}

// ─── Servicios que pagan servicios ─────────────────────────────
//
// Mientras sirve una llamada, un servicio puede pagar a otros servicios o a APIs x402 con el
// saldo de su publicador (ctx.kiba en el SDK). Esas llamadas llegan con la cabecera
// `X-Kiba-Parent-Call: <id de la llamada del usuario>` y quedan ligadas a ella como hijas, así
// el usuario ve la cascada entera: lo que pagó él y lo que el servicio pagó a sus proveedores.

/**
 * La llamada padre a la que se puede ligar una hija: existe y sigue en curso. El id lo conoce
 * solo el gateway y el servicio al que se lo entregó (`X-Kiba-Call-Id`); una llamada que ya
 * terminó no admite hijas nuevas. Cualquier otra cosa → sin padre (la llamada sigue normal).
 */
export async function resolveParentCall(parentId: unknown): Promise<string | null> {
  if (typeof parentId !== 'string' || !/^res_[0-9a-f]{24}$/.test(parentId)) return null;
  const row = await db
    .prepare('SELECT status FROM call_results WHERE id = ?')
    .get<{ status: ResultStatus }>(parentId);
  return row?.status === 'pending' ? parentId : null;
}

/**
 * Los pagos que el servicio hizo a otros mientras servía esta llamada, en orden. Solo lo que el
 * usuario necesita ver (servicio, costo, transacción): los cuerpos pertenecen a la cuenta del
 * servicio, no a la suya.
 */
export async function subCallsDto(parentId: string): Promise<SubCallDto[]> {
  const rows = await db
    .prepare(
      `SELECT id, service, status, cost_lamports, explorer_url, created_at, completed_at
       FROM call_results WHERE parent_id = ? ORDER BY created_at ASC, id ASC LIMIT 100`,
    )
    .all<Pick<CallResultRow, 'id' | 'service' | 'status' | 'cost_lamports' | 'explorer_url' | 'created_at' | 'completed_at'>>(
      parentId,
    );
  return rows.map((r) => ({
    resultId: r.id,
    service: r.service,
    status: r.status,
    costBaseUnits: r.cost_lamports ?? undefined,
    costUsd: r.cost_lamports != null ? lamportsToUsd(r.cost_lamports) : undefined,
    explorerUrl: r.explorer_url ?? undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  }));
}

/** `{ subCalls }` para añadir a un DTO, o `{}` si la llamada no pagó a nadie. */
export async function subCallsField(id: string): Promise<{ subCalls?: SubCallDto[] }> {
  const subCalls = await subCallsDto(id);
  return subCalls.length > 0 ? { subCalls } : {};
}

/** La licencia emitida para una llamada, en formato DTO (o undefined). */
export async function licenseDtoForCall(callId: string): Promise<Record<string, unknown> | undefined> {
  const row = await licenseForCall(callId);
  return row ? licenseDto(row) : undefined;
}

/** DTO común a MCP y REST. `full: false` omite el cuerpo (listados). */
export function resultDto(row: CallResultRow, full = true): Record<string, unknown> {
  const parse = (s: string | null) => {
    if (s == null) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };
  return {
    resultId: row.id,
    service: row.service,
    status: row.status,
    resultUrl: resultUrl(row.id),
    ...(full ? { payload: parse(row.payload), result: parse(row.result) } : {}),
    error: row.error ?? undefined,
    costBaseUnits: row.cost_lamports ?? undefined,
    explorerUrl: row.explorer_url ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

/**
 * Al arrancar: las filas que quedaron 'pending' de un proceso anterior ya no tienen quién las
 * complete (la llamada murió con el proceso). Se marcan como error para no quedar colgadas.
 */
export async function failOrphanedResults(): Promise<void> {
  await db
    .prepare(
      `UPDATE call_results SET status = 'error', error = 'interrumpido: el gateway se reinició durante la llamada',
       completed_at = ? WHERE status = 'pending'`,
    )
    .run(Math.floor(Date.now() / 1000));
}
