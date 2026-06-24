# kiba-mcp

MCP server adapter to connect any LLM agent (Claude Code, Cursor, etc.) to the **Kiba** marketplace.

## Quick start

Add this to your `~/.claude.json` (or your IDE's MCP config):

```json
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"]
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

Two paths, pick one:

**Interactive (default, recommended for IDEs)** — OAuth 2.0 with PKCE. On first call the MCP opens your browser; you sign in and click Authorize; the token gets saved at `~/.config/kiba/token.json` (mode 600). No copy-paste of secrets.

**Headless (for CI / servers / automation)** — set `KIBA_API_KEY=sk_live_…` in the env. The MCP skips OAuth entirely and uses the key as the bearer. Generate keys from the dashboard's *Credentials* tab or `POST /v1/api-keys`.

```json
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"],
      "env": {
        "KIBA_API_KEY": "sk_live_…"
      }
    }
  }
}
```

## Environment variables

- `KIBA_URL` — gateway URL (default: production gateway `https://kiba-api.rodion.com.co`, self-hosted on Coolify)
- `KIBA_API_KEY` — long-lived API key (`sk_live_…`); when set, OAuth is skipped
- `KIBA_TOKEN_PATH` — where to save the OAuth token (default: `~/.config/kiba/token.json`)
- `KIBA_CLIENT_NAME` — client identifier shown on the consent page (default: `kiba-mcp`)

## Self-hosted gateway

Pointing the MCP at your own gateway:

```json
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"],
      "env": {
        "KIBA_URL": "http://localhost:8000"
      }
    }
  }
}
```
