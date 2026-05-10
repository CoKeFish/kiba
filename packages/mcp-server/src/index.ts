#!/usr/bin/env node
/**
 * @agent-bazaar/mcp
 *
 * MCP server que conecta cualquier LLM agent (Claude Code, Cursor, etc.) al
 * marketplace Agent Bazaar.
 *
 * En el primer arranque, dispara OAuth 2.0 con PKCE — abre el browser del
 * usuario, recibe el token cuando autoriza, lo persiste en disco. De ahí en
 * adelante, las tools list_agents y call usan ese token automáticamente.
 *
 * Cero API keys. Cero copy-paste. UX tipo Notion/Linear MCP.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import open from 'open';

const GATEWAY_URL = process.env.AGENT_BAZAAR_URL || 'https://gateway-production-a12f.up.railway.app';
const TOKEN_PATH = process.env.AGENT_BAZAAR_TOKEN_PATH || join(homedir(), '.config', 'agent-bazaar', 'token.json');
const CLIENT_NAME = process.env.AGENT_BAZAAR_CLIENT_NAME || 'agent-bazaar-mcp';
// Headless / CI / server-side: si AGENT_BAZAAR_API_KEY está seteado, lo usamos
// como bearer y saltamos el OAuth flow entero. El gateway acepta tanto tokens
// OAuth como API keys (sk_live_…) en el mismo header Authorization.
const API_KEY = process.env.AGENT_BAZAAR_API_KEY;

// ─── Token persistence ─────────────────────────────────────────

interface SavedToken {
  access_token: string;
  expires_at: number;
  saved_at: number;
}

function loadToken(): SavedToken | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as SavedToken;
    if (data.expires_at < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveToken(token: { access_token: string; expires_in: number }) {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const data: SavedToken = {
    access_token: token.access_token,
    expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
    saved_at: Math.floor(Date.now() / 1000),
  };
  writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── PKCE helpers ──────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ─── OAuth flow ────────────────────────────────────────────────

async function authorize(): Promise<string> {
  const { verifier, challenge } = generatePkce();

  // Levantar local server para recibir callback
  const port = 49152 + Math.floor(Math.random() * 1000);
  const redirectUri = `http://localhost:${port}/callback`;

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><title>Autorizado</title>
          <style>body{background:#0a0a0a;color:#f5f5f5;font-family:system-ui;text-align:center;padding:80px 20px}h1{color:#14F195}</style>
          </head><body>
          <h1>✓ Autorizado</h1>
          <p>Tu agente IA ahora puede usar Agent Bazaar.</p>
          <p style="color:#888">Puedes cerrar esta pestaña.</p>
          </body></html>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Missing code');
      }
    });

    server.on('error', reject);
    server.listen(port, () => {
      // Browser
      const authUrl = new URL(`${GATEWAY_URL}/auth/connect`);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('client_name', CLIENT_NAME);

      console.error(`\n[agent-bazaar] Autorización requerida.`);
      console.error(`[agent-bazaar] Abriendo browser: ${authUrl.toString()}\n`);
      console.error(`[agent-bazaar] Si no abre automáticamente, copia el link a tu browser.\n`);

      open(authUrl.toString()).catch(() => {/* user opens manually */});
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout (5 min)'));
    }, 5 * 60 * 1000);
  });

  const code = await codePromise;

  // Intercambia code por token
  const tokenResp = await axios.post(`${GATEWAY_URL}/oauth/token`, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
  });

  saveToken(tokenResp.data);
  console.error('[agent-bazaar] ✓ Token guardado en', TOKEN_PATH, '\n');
  return tokenResp.data.access_token;
}

async function getValidToken(): Promise<string> {
  if (API_KEY) return API_KEY;
  const saved = loadToken();
  if (saved) return saved.access_token;
  return await authorize();
}

// ─── HTTP wrappers ─────────────────────────────────────────────

async function gatewayGet(path: string): Promise<unknown> {
  const token = await getValidToken();
  const r = await axios.get(`${GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

async function gatewayPost(path: string, body: unknown): Promise<unknown> {
  const token = await getValidToken();
  const r = await axios.post(`${GATEWAY_URL}${path}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

// ─── MCP server ────────────────────────────────────────────────

const server = new Server(
  { name: 'agent-bazaar', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_agents',
        description:
          'Descubre agentes del marketplace Agent Bazaar. Si pasas `query` (palabra clave o lenguaje natural en cualquier idioma), corre búsqueda híbrida (FTS5 keyword + semántica) y devuelve los agentes más relevantes ordenados por score. Sin `query` devuelve el catálogo entero. Cada agente trae service, endpoint, descripción, pricePerCall y stats.',
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
        description: 'Consulta el saldo actual del usuario (en USD y lamports).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_transactions',
        description: 'Devuelve las últimas transacciones del usuario en el marketplace.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'list_agents': {
        const { query } = (args ?? {}) as { query?: string };
        const path =
          typeof query === 'string' && query.trim().length > 0
            ? `/v1/agents?q=${encodeURIComponent(query.trim())}`
            : '/v1/agents';
        const data = await gatewayGet(path);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'call_agent': {
        const { service, payload } = (args ?? {}) as { service: string; payload?: unknown };
        if (!service) throw new Error('service required');
        const data = await gatewayPost('/v1/call', { service, payload: payload ?? {} });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'get_balance': {
        const data = await gatewayGet('/v1/balance');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'get_transactions': {
        const data = await gatewayGet('/v1/transactions');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ─── Start ─────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error(`[agent-bazaar-mcp] connected to ${GATEWAY_URL}`);
});
