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
import { explorerTxUrl } from './chain';

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
      additionalProperties: false,
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

    // call_agent ahora es off-chain (~1s): devolvemos JSON directo (enableJsonResponse en el
    // transport), sin streaming/keep-alive. Antes emitíamos progreso por SSE cada 2s para que
    // call_agent (lento, ~40s on-chain) no cortara en ChatGPT/proxies; ese ticker enviaba un
    // progressToken sintético no solicitado que algunos clientes rechazan (→ 500). Ya no aplica.
    try {
      switch (name) {
        case 'list_agents': {
          const { query } = (args ?? {}) as { query?: string };
          const q = typeof query === 'string' && query.trim().length > 0 ? query.trim() : undefined;
          return jsonResult(await listAgents(q));
        }
        case 'call_agent': {
          const a = (args ?? {}) as Record<string, unknown>;
          // Validación de schema: rechaza campos desconocidos (p.ej. `input` en vez de `payload`)
          // ANTES de cobrar. Sin esto, un campo mal escrito pasaba con payload vacío y cobraba.
          const unknown = Object.keys(a).filter((k) => k !== 'service' && k !== 'payload');
          if (unknown.length > 0) {
            throw new Error(
              `campo(s) no reconocido(s): ${unknown.join(', ')}. Los datos del servicio van en 'payload'.`,
            );
          }
          const { service, payload } = a as { service?: string; payload?: unknown };
          if (!service) throw new Error('service required');
          const out = (await callOnBehalf({ userId, service, payload: payload ?? {} })) as unknown as {
            cost?: { lamports: number; usd: number };
            newBalance?: { lamports: number; usd: number };
            [k: string]: unknown;
          };
          // Normaliza los nombres heredados de Solana (lamports) a unidades base:
          // la cadena activa es Stellar/XLM (stroops).
          const clean: Record<string, unknown> = { ...out };
          if (out.cost) clean.cost = { baseUnits: out.cost.lamports, usd: out.cost.usd };
          if (out.newBalance) {
            clean.newBalance = { baseUnits: out.newBalance.lamports, usd: out.newBalance.usd };
          }
          return jsonResult(clean);
        }
        case 'get_balance': {
          const b = await getUserBalances(userId);
          // Solo campos Stellar-correctos (sin los aliases legacy lamports/sol).
          return jsonResult({
            asset: b.asset,
            baseUnitName: b.baseUnitName,
            credit: { baseUnits: b.creditBaseUnits, usd: b.creditUsd },
            wallet: { baseUnits: b.walletBaseUnits, assetAmount: b.walletAssetAmount, usd: b.walletUsd },
            total: { baseUnits: b.totalBaseUnits, assetAmount: b.totalAssetAmount, usd: b.totalUsd },
          });
        }
        case 'get_transactions': {
          const { limit } = (args ?? {}) as { limit?: number };
          const txs = await getTransactions(userId, Math.min(limit ?? 50, 500));
          return jsonResult(
            txs.map((t) => ({
              id: String(t.id),
              type: t.type,
              amount_base_units: Math.abs(t.amount_lamports),
              service: t.service ?? undefined,
              tx_signature: t.signature ?? undefined,
              explorer_url: t.signature ? explorerTxUrl(t.signature) : undefined,
              created_at: t.created_at,
            })),
          );
        }
        default:
          throw new Error(`unknown tool: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[mcp-error] tool=${name}:`, err instanceof Error ? (err.stack ?? err.message) : err);
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
  // enableJsonResponse: respuesta JSON directa (no SSE). call_agent ya es rápido (off-chain),
  // así que no necesitamos streaming/keep-alive; JSON es más simple y compatible con todos los
  // clientes (evita el 500 del conector por la respuesta SSE + progress no solicitado).
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.log('[mcp-transport-error]', err instanceof Error ? (err.stack ?? err.message) : err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  }
}
