/**
 * Executor — ejecuta una lista de Tasks llamando a los specialists vía SDK.
 *
 * Las llamadas son paralelas por default (los specialists no dependen
 * entre sí en este demo).
 */
import type { AgentClient } from '@kiba/sdk';
import type { Task } from './planner';

export interface TaskResult {
  service: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export async function execute(client: AgentClient, tasks: Task[]): Promise<TaskResult[]> {
  return Promise.all(tasks.map((task) => runTask(client, task)));
}

async function runTask(client: AgentClient, task: Task): Promise<TaskResult> {
  const start = Date.now();
  try {
    const data = await client.call(task.service, task.payload, {
      maxPrice: 0.5, // cap de seguridad: nunca paga más de $0.50 USDC por tarea
      timeoutMs: 30_000,
    });
    return {
      service: task.service,
      success: true,
      data,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      service: task.service,
      success: false,
      error: err instanceof Error ? err.message : 'unknown error',
      durationMs: Date.now() - start,
    };
  }
}
