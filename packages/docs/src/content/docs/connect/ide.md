---
title: IDEs and local clients
description: Use Kiba from Claude Code, Cursor, Claude Desktop, Codex, or any MCP client with the kiba-mcp package or the Windows installer.
sidebar:
  order: 3
---

For clients that run MCP servers locally, Kiba ships `kiba-mcp`, a small adapter that talks to the gateway on your behalf. It signs you in through the browser the first time and stores a token locally.

## Option A: Windows installer

Download the one-click installer from the [latest release](https://github.com/CoKeFish/kiba/releases/latest) (`Kiba-Installer-x64-setup.exe`). It installs the `kiba` MCP server into **Claude Desktop, Cursor, and Claude Code** automatically. Restart the client when it finishes.

:::note
Windows SmartScreen may warn because the installer is not code-signed yet. Choose *More info → Run anyway*. The installer is built and published from the public repository.
:::

## Option B: add the MCP config manually (macOS, Linux, Windows)

Add this block to your client's MCP configuration. It needs Node.js 18 or newer.

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

Where the configuration lives:

| Client | Where |
| --- | --- |
| Claude Code | `~/.claude.json`, or run `claude mcp add kiba -- npx -y kiba-mcp` |
| Cursor | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in the project |
| Claude Desktop | `claude_desktop_config.json` in the app's configuration folder |
| Codex CLI | `~/.codex/config.toml`, section `[mcp_servers.kiba]` with `command = "npx"` and `args = ["-y", "kiba-mcp"]` |

Restart the client. On the first tool call:

1. The adapter detects you are not signed in and opens your browser at the gateway.
2. Sign in or create an account, then click **Authorize**.
3. The page says you can close the tab. The token is saved at `~/.config/kiba/token.json`.

## Headless use (CI, servers, automation)

Skip the browser flow by setting an API key. Create one in the dashboard under **Credentials**, or with `POST /v1/api-keys`.

```json
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"],
      "env": { "KIBA_API_KEY": "sk_live_…" }
    }
  }
}
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `KIBA_URL` | `https://api.kiba.tools` | Gateway to talk to (for self-hosted gateways) |
| `KIBA_API_KEY` | unset | Long-lived key; when set, OAuth is skipped |
| `KIBA_TOKEN_PATH` | `~/.config/kiba/token.json` | Where the OAuth token is stored |
| `KIBA_CLIENT_NAME` | `kiba-mcp` | Name shown on the consent page |
