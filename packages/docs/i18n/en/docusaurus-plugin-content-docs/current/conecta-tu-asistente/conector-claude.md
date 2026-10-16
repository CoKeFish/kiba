---
title: "Claude"
slug: /conecta-tu-asistente/claude
description: "Connect Kiba to Claude as a custom connector by URL."
---

# Claude

Claude connects to Kiba as a **custom connector**: a remote MCP server by URL, with OAuth sign-in. Nothing to install.

**Connector URL:**

```text
https://api.kiba.tools/mcp
```

## Steps

1. In Claude, open **Settings → Connectors** and choose **Add custom connector**.
2. Paste the URL and click **Add**.
3. Claude opens the Kiba sign-in page. Create an account or sign in and click **Authorize**.
4. Back in Claude, Kiba's tools are available in new conversations. If the connector is off in a chat, turn it on from the tools menu.

:::info[Plans]
Custom connectors are available on Claude's **Pro, Max, Team and Enterprise** plans. Once added to your account, it works on the web, Claude Desktop and the mobile apps.
:::

## What you get

Four tools: search the catalog, call a service, check your balance and list your transactions. See [MCP tools](/conecta-tu-asistente/herramientas-mcp).

New accounts come with 5 USD in credit (testnet). Top up at [app.kiba.tools](https://app.kiba.tools) when you need more.

## Try it

> *"Find a service on Kiba that tells me the time in Tokyo and Bogotá, and the best slot for a meeting between both cities."*

Claude searches the catalog, shows the price, calls the service and reports the cost and the remaining balance.

## Claude Code and Claude Desktop with a local adapter

If you prefer a local MCP server, or your plan doesn't include custom connectors, use the `kiba-mcp` package or the [Windows installer](/conecta-tu-asistente/instalador-windows). See [IDEs and local clients](/conecta-tu-asistente/ides-y-clientes-locales).

Something not working? See [Connection troubleshooting](/recursos/faq#conexión).
