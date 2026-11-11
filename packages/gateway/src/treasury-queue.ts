/**
 * Cola de la tesorería: todo lo que la tesorería firma en la red pasa por aquí, de a una
 * operación a la vez y en orden. Así dos transacciones suyas nunca chocan por el número de
 * secuencia de la cuenta.
 */

let queueTail: Promise<unknown> = Promise.resolve();
let queuePending = 0;

/**
 * Encola una operación de la tesorería. OJO: nunca hagas `await` de una tarea encolada DESDE
 * DENTRO de otra tarea (se bloquean); encadena con `void enqueueChainTask(...)`.
 */
export function enqueueChainTask<T>(fn: () => Promise<T>): Promise<T> {
  queuePending++;
  const p = queueTail.then(fn).finally(() => {
    queuePending--;
  });
  // Un fallo no rompe la cadena: la siguiente tarea corre igual.
  queueTail = p.catch(() => {});
  return p;
}

/** Cuántas operaciones hay esperando o en curso. */
export function chainQueuePending(): number {
  return queuePending;
}
