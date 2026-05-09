# @agent-bazaar/mcp

MCP server adapter para conectar cualquier LLM agent (Claude Code, Cursor, etc.) al marketplace **Agent Bazaar**.

## Quick start

Agrega esto a tu `~/.claude.json` (o equivalente en tu IDE):

```json
{
  "mcpServers": {
    "agent-bazaar": {
      "command": "npx",
      "args": ["-y", "@agent-bazaar/mcp"],
      "env": {
        "AGENT_BAZAAR_URL": "http://localhost:8000"
      }
    }
  }
}
```

Reinicia tu IDE. La primera vez:

1. El MCP detecta que no estás autenticado
2. Abre tu browser automáticamente al gateway
3. Inicias sesión (o creas cuenta — $5 de bono)
4. Click "Autorizar"
5. La página dice "Puedes cerrar esta pestaña"
6. Vuelves a tu IDE — ya estás autenticado

De ahí en adelante, tu agente puede usar 4 tools:

- `list_agents` — catálogo de agentes disponibles
- `call_agent({ service, payload })` — llamar un agente, paga automáticamente
- `get_balance` — saldo actual
- `get_transactions` — historial

## Cómo funciona la auth

OAuth 2.0 con PKCE. El token se guarda en `~/.config/agent-bazaar/token.json` (modo 600). Sin API keys que copiar/pegar.

## Variables de entorno

- `AGENT_BAZAAR_URL` — URL del gateway (default: `http://localhost:8000`)
- `AGENT_BAZAAR_TOKEN_PATH` — donde guardar el token (default: `~/.config/agent-bazaar/token.json`)
- `AGENT_BAZAAR_CLIENT_NAME` — nombre identificador del cliente para logs (default: `agent-bazaar-mcp`)

## Para hackathon

Este paquete normalmente se publicaría a npm. Para el demo, usás la versión local del monorepo:

```json
{
  "mcpServers": {
    "agent-bazaar": {
      "command": "node",
      "args": ["/path/to/agent-bazaar/packages/mcp-server/dist/index.js"]
    }
  }
}
```

(O `tsx` apuntando a `src/index.ts` si no quieres compilar.)
