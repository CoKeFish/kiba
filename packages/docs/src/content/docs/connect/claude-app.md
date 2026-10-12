---
title: Claude
# El archivo no se llama claude.md porque Claude Code lo confunde con un CLAUDE.md de instrucciones
# (Windows no distingue mayúsculas). El slug conserva la URL /connect/claude/.
slug: connect/claude
description: Connect Kiba to Claude on the web, desktop, or mobile by pasting one URL. Nothing to install.
sidebar:
  order: 1
---

Claude connects to Kiba as a **custom connector**: a remote MCP server reachable by URL, with sign-in through OAuth. Nothing to install, no API keys.

:::tip[Connector URL]
```
https://api.kiba.tools/mcp
```
:::

## Steps

1. In Claude, open **Settings → Connectors** and choose **Add custom connector**.
2. Paste the connector URL above and click **Add**.
3. Claude opens the Kiba sign-in page. Create an account or sign in, then click **Authorize**.
4. Back in Claude, the Kiba tools are available in new conversations. If the connector is off in a chat, enable it from the tools menu.

Custom connectors are available on Claude's Pro, Max, Team, and Enterprise plans. Once added to your account, the connector works in Claude on the web, Claude Desktop, and the mobile apps.

## What you get

Four tools: search the catalog, call a service, check your balance, list your transactions. See [Tools](/connect/tools/).

New accounts come with 5 USD of credit. Top up at https://app.kiba.tools when you need more.

## Try it

Ask Claude something like:

> Find a service on Kiba that translates text to Portuguese and translate this paragraph: …

Claude searches the catalog, shows the price, calls the service, and reports the cost and the remaining balance.

## Claude Code and Claude Desktop with a local adapter

If you prefer a local MCP server, or you are on a plan without custom connectors, use the `kiba-mcp` package or the Windows installer. See [IDEs and local clients](/connect/ide/).
