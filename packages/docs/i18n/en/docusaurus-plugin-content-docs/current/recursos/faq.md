---
title: "FAQ and troubleshooting"
sidebar_label: "FAQ"
description: "Frequently asked questions and fixes for connection and call issues."
---

# FAQ and troubleshooting

## Frequently asked questions

### Do I need crypto to use Kiba?

No. You sign in with an email, start with 5 USD in credit (testnet) and top up in USD. On-chain settlement happens behind the gateway.

### Do I need crypto to publish a service?

Your service needs a Stellar account (the SDK creates it on testnet) and a Trustless Work API key <TW />. Earnings arrive as USDC on Stellar.

### Is it on mainnet?

Not yet. Kiba runs on Stellar testnet: the flow is complete end to end, but balances have no real value.

### What does Kiba charge?

5 % of every call, applied at settlement; the publisher receives 95 %. No subscriptions or monthly fees.

### Which assistants work?

Claude (web, desktop, mobile) and ChatGPT with the [remote connector](/conecta-tu-asistente). Claude Code, Cursor, Claude Desktop, Codex and any MCP client with `kiba-mcp` or the Windows installer.

### Can my service be called without going through Kiba?

Yes. Any `AgentClient` can pay any registered service directly through an escrow. The registry is public and anyone can run an indexer.

### Where is the money when I publish?

In the Stellar account that owns the on-chain registration: the keypair your service started with, or your Kiba wallet if you registered from the dashboard. See [Publisher panel](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero).

### Can I self-host the gateway?

Yes, the whole platform is open source. `docker compose up` starts the gateway, discovery, dashboard and demo services against testnet. Point `kiba-mcp` at it with `KIBA_URL`. See [Self-hosting and development](/recursos/self-hosting).

### Where do I report a bug or get help?

Reproducible bugs go to [GitHub Issues](https://github.com/CoKeFish/kiba/issues). For help, message `andre.yf` on Discord or write to andrelanfor@gmail.com. See [Community and support](/recursos/soporte).

## Connection {/* #conexión */}

| Problem | Fix |
|---|---|
| **Claude can't add the connector** | Check that the URL is exactly `https://api.kiba.tools/mcp` and that your plan supports custom connectors (Pro, Max, Team, Enterprise). Otherwise, use [`kiba-mcp`](/conecta-tu-asistente/ides-y-clientes-locales). |
| **ChatGPT rejects the connector** | Developer mode must be turned on first and the URL must be HTTPS. |
| **The browser never opens with `kiba-mcp`** | Restart the client after editing the MCP configuration and trigger any Kiba tool. On a headless machine, use `KIBA_API_KEY`. |
| **"Unauthorized" after it was working** | Disconnect the app in the dashboard (**Credentials**) and connect it again. Tokens last 30 days. |

## Calls {/* #llamadas */}

| Problem | Fix |
|---|---|
| **`insufficient balance`** | Top up credits in the dashboard's **Billing** or fund your wallet with USDC. |
| **The call takes a long time** | Platform-signed calls come back in under a second. Direct escrow calls (SDK) wait for the network and can take 15 to 150 s. |
| **The service returned an error** | The gateway refunds the debit to your credits. Check the payload against the service description: the assistant may have guessed the fields. |
| **Unknown field error in `POST /v1/call`** | Put the service input inside `payload`; only `service` and `payload` are allowed at the top level. |

For publishers, see [Common publishing issues](/publica-un-servicio/problemas-frecuentes).
