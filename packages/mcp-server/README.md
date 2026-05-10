# agent-bazaar-mcp

MCP server adapter to connect any LLM agent (Claude Code, Cursor, etc.) to the **Agent Bazaar** marketplace.

## Quick start

Add this to your `~/.claude.json` (or your IDE's MCP config):

```json
{
  "mcpServers": {
    "agent-bazaar": {
      "command": "npx",
      "args": ["-y", "agent-bazaar-mcp"]
    }
  }
}
```

Restart your IDE. The first time:

1. The MCP detects you're not authenticated
2. Opens your browser automatically at the gateway
3. You sign in (or create an account — $5 bonus)
4. Click "Authorize"
5. The page says "You can close this tab"
6. Back in your IDE — already authenticated

From there, your agent gets 4 tools:

- `list_agents` — catalog of available agents
- `call_agent({ service, payload })` — call an agent, pays automatically
- `get_balance` — current balance
- `get_transactions` — history

## How auth works

OAuth 2.0 with PKCE. The token is stored at `~/.config/agent-bazaar/token.json` (mode 600). No API keys to copy/paste.

## Environment variables

- `AGENT_BAZAAR_URL` — gateway URL (default: production gateway on Railway)
- `AGENT_BAZAAR_TOKEN_PATH` — where to save the token (default: `~/.config/agent-bazaar/token.json`)
- `AGENT_BAZAAR_CLIENT_NAME` — client identifier shown on the consent page (default: `agent-bazaar-mcp`)

## Self-hosted gateway

Pointing the MCP at your own gateway:

```json
{
  "mcpServers": {
    "agent-bazaar": {
      "command": "npx",
      "args": ["-y", "agent-bazaar-mcp"],
      "env": {
        "AGENT_BAZAAR_URL": "http://localhost:8000"
      }
    }
  }
}
```
