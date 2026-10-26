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
  created_at: number;
  completed_at: number | null;
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
  args: { userId: number; service: string; payload: unknown; waitMs?: number },
  call: typeof callOnBehalf = callOnBehalf, // inyectable en tests
): Promise<
  | (CallOutput & { status: 'done'; resultId: string; resultUrl: string; license?: Record<string, unknown> })
  | { status: 'pending'; resultId: string; resultUrl: string; service: string; message: string }
> {
  const id = `res_${randomBytes(12).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO call_results (id, user_id, service, payload, status, task_key, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      id,
      args.userId,
      args.service,
      JSON.stringify(args.payload ?? {}),
      taskKeyOf(args.service, args.payload),
      now,
    );

  let output: CallOutput | undefined;
  let failure: Error | undefined;
  let license: LicenseRow | null = null;
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
  const task = call({ userId: args.userId, service: args.service, payload: args.payload, onExplorerUrl, onBeforePay })
    .then(async (out) => {
      output = out;
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
