/**
 * Planner — decide qué specialists invocar dado un intent.
 *
 * Modos:
 *   - LLM (Claude tool-calling)  — si ANTHROPIC_API_KEY está configurada
 *   - Keywords (determinista)    — fallback
 */
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

export interface Task {
  service: string;
  payload: unknown;
  reason: string;
}

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';

export async function plan(intent: string): Promise<Task[]> {
  if (anthropic) {
    try {
      return await planWithLLM(intent);
    } catch (err) {
      console.warn(
        '[planner] LLM mode failed, falling back to keywords:',
        (err as Error).message,
      );
    }
  }
  return planWithKeywords(intent);
}

// ─── Keyword fallback ──────────────────────────────────────────

function planWithKeywords(intent: string): Task[] {
  const tasks: Task[] = [];

  if (/yield|apy|rendimiento|mejor.*tasa|interés|interes/i.test(intent)) {
    tasks.push({
      service: 'yield-hunter',
      payload: { token: 'USDC' },
      reason: 'el intent menciona yield/APY/rendimiento',
    });
  }

  if (/risk|riesgo|audit|seguro|peligro|safe/i.test(intent)) {
    tasks.push({
      service: 'risk-auditor',
      payload: { protocol: 'Kamino' },
      reason: 'el intent menciona riesgo/auditoría',
    });
  }

  if (tasks.length === 0) {
    throw new Error(
      `No specialists matched intent: "${intent}". Probá mencionar yield, APY, risk, audit.`,
    );
  }

  return tasks;
}

// ─── LLM mode ──────────────────────────────────────────────────

interface AgentManifest {
  service: string;
  pricePerCall: number;
  description?: string;
  endpoint: string;
  ownerWallet: string;
  acceptedToken: string;
}

async function planWithLLM(intent: string): Promise<Task[]> {
  // 1. Lista de agentes disponibles desde el backend
  const resp = await axios.get<AgentManifest[]>(`${BACKEND_URL}/agents`);
  const available = resp.data;

  if (available.length === 0) {
    throw new Error('no agents available in marketplace');
  }

  // 2. Define una tool por cada agente disponible
  const tools = available.map((a) => ({
    name: a.service.replace(/-/g, '_'),
    description: a.description || `Call ${a.service} service. Costs ${a.pricePerCall} SOL per call.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        payload: {
          type: 'object',
          description:
            'Arbitrary JSON payload to send to the service. Look at the service description to determine the right shape.',
        },
        reason: {
          type: 'string',
          description: 'Why are we calling this service? One-sentence justification.',
        },
      },
      required: ['payload', 'reason'],
    },
  }));

  const systemPrompt = `Eres un orchestrator de agentes IA en un marketplace descentralizado en Solana.

Tu trabajo: dado un intent del usuario, decidir qué agentes especialistas llamar para resolver su pedido.

Reglas:
- Solo llama a los agentes necesarios (mínimo posible)
- Para cada llamada, define un payload concreto con valores razonables
- Si el intent no necesita ningún agente, no hagas tool calls
- No inventes información, deja que los specialists hagan su trabajo`;

  const message = await anthropic!.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages: [{ role: 'user', content: intent }],
  });

  // 3. Parsear los tool_use blocks de la respuesta
  const tasks: Task[] = [];
  const toolNameToService = new Map(available.map((a) => [a.service.replace(/-/g, '_'), a.service]));

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      const service = toolNameToService.get(block.name);
      if (!service) {
        console.warn('[planner] LLM called unknown tool:', block.name);
        continue;
      }
      const input = block.input as { payload: unknown; reason: string };
      tasks.push({
        service,
        payload: input.payload,
        reason: input.reason,
      });
    }
  }

  if (tasks.length === 0) {
    throw new Error('LLM did not select any specialist for this intent');
  }

  return tasks;
}
