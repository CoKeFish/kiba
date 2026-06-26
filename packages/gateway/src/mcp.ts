/**
 * Endpoint MCP remoto (Streamable HTTP) embebido en el gateway.
 *
 * Expone las mismas 4 tools que el adaptador stdio (packages/mcp-server) pero
 * sobre HTTP, para que Claude (custom connectors web/desktop) y ChatGPT (Apps
 * SDK) se conecten por URL sin instalar nada. Cada request se autentica por
 * Bearer (requireBearerAuth en index.ts) y opera a nombre del `userId` del token.
 *
 * Las tools reutilizan las mismas funciones de servicio que las rutas REST
 * /v1/* — sin HTTP-a-sí-mismo, sin duplicar lógica de negocio.
 *
 * Usamos el API low-level `Server` + setRequestHandler (igual que el adaptador
 * stdio) en vez del `McpServer.registerTool` high-level: este último dispara
 * TS2589 (recursión de tipos) al inferir los shapes de zod bajo el tsconfig del
 * gateway.
 */
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { callOnBehalf, listAgents } from './proxy';
import { getUserBalances } from './wallets';
import { getTransactions } from './billing';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const TOOLS = [
  {
    name: 'list_agents',
    annotations: { title: 'List agents', readOnlyHint: true, openWorldHint: true },
    description:
      'Descubre agentes del marketplace Kiba. Si pasas `query` (palabra clave o lenguaje natural en cualquier idioma), corre búsqueda híbrida (FTS5 keyword + semántica) y devuelve los agentes más relevantes ordenados por score. Sin `query` devuelve el catálogo entero. Cada agente trae service, endpoint, descripción, pricePerCall y stats.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Texto libre. Ejemplos: "translate text to spanish", "auditar smart contract", "yield farming".',
        },
      },
    },
  },
  {
    name: 'call_agent',
    annotations: {
      title: 'Call agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      'Llama un agente especializado en el marketplace. El gateway maneja el pago automáticamente descontando del saldo del usuario. Devuelve el resultado del agente más el costo y saldo restante.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Identificador del servicio (ej. "yield-hunter", "risk-auditor")',
        },
        payload: {
          type: 'object',
          description: 'Payload JSON específico del servicio',
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'get_balance',
    annotations: { title: 'Get balance', readOnlyHint: true, openWorldHint: false },
    description: 'Consulta el saldo actual del usuario (créditos USD y wallet on-chain).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_transactions',
    annotations: { title: 'Get transactions', readOnlyHint: true, openWorldHint: false },
    description: 'Devuelve las últimas transacciones del usuario en el marketplace.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Máximo de transacciones (default 50, max 500).',
        },
      },
    },
  },
] as const;

/**
 * Construye un Server MCP ligado a un usuario concreto. Stateless: se crea uno
 * nuevo por request HTTP, así que el cierre sobre `userId` es seguro.
 */
export function buildMcpServer(userId: number): Server {
  const server = new Server({ name: 'kiba', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as object[] }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<ToolResult> => {
    const { name, arguments: args } = req.params;
    try {
      switch (name) {
        case 'list_agents': {
          const { query } = (args ?? {}) as { query?: string };
          const q = typeof query === 'string' && query.trim().length > 0 ? query.trim() : undefined;
          return jsonResult(await listAgents(q));
        }
        case 'call_agent': {
          const { service, payload } = (args ?? {}) as { service?: string; payload?: unknown };
          if (!service) throw new Error('service required');
          return jsonResult(await callOnBehalf({ userId, service, payload: payload ?? {} }));
        }
        case 'get_balance': {
          return jsonResult(await getUserBalances(userId));
        }
        case 'get_transactions': {
          const { limit } = (args ?? {}) as { limit?: number };
          const txs = getTransactions(userId, Math.min(limit ?? 50, 500));
          return jsonResult(
            txs.map((t) => ({
              id: String(t.id),
              type: t.type,
              amount_lamports: Math.abs(t.amount_lamports),
              service: t.service ?? undefined,
              tx_signature: t.signature ?? undefined,
              created_at: t.created_at,
            })),
          );
        }
        default:
          throw new Error(`unknown tool: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

/**
 * Maneja una request HTTP al endpoint /mcp en modo stateless: un server +
 * transport efímeros por request, ligados al usuario autenticado. El Bearer ya
 * fue validado por requireBearerAuth, que dejó el userId en req.auth.extra.
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // req.auth lo setea requireBearerAuth (middleware del SDK). Accedemos con un
  // cast local para no depender de la augmentación global de tipos de express.
  const auth = (req as Request & { auth?: { extra?: { userId?: number } } }).auth;
  const userId = auth?.extra?.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  const server = buildMcpServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
