---
title: "SDK (kiba-sdk)"
sidebar_label: "Overview"
description: "TypeScript library to publish services or consume them directly, self-custodially."
---

# SDK (`kiba-sdk`)

```bash
npm install kiba-sdk
# express is an optional peer dependency, only for the built-in HTTP server:
npm install express
```

Requires **Node.js 18** or later. Current version in the repo: `0.1.0`. The SDK is open: every service is built and owned by its publisher; there's no privileged "Kiba service".

## Two roles

| Class | Role | Page |
|---|---|---|
| **`AgentProvider`** | You **offer** a service. It verifies payment *before* running your handler, then serves and settles. | [AgentProvider](/sdk/agent-provider) |
| **`AgentClient`** | You **consume** a service. It discovers it and handles payment automatically with the x402 handshake. | [AgentClient](/sdk/agent-client) |

:::note
The classes keep their historical `Agent*` names for API stability. They work for any kind of service.
:::

## What the SDK abstracts

- The on-chain registry (register, update, delete, discover) behind a `ChainClient` interface, implemented for Stellar/Soroban (XDR/ScVal with `@stellar/stellar-sdk`).
- <TW /> The Trustless Work escrow lifecycle (deploy, fund, release) and USDC trustlines.
- The payment handshake: `402` quotes, `X-PAYMENT` header, platform-signed certificates, replay protection.
- Testnet account bootstrapping with friendbot.

The same library powers the gateway, the demo services and the orchestrator: **anything the platform does with a service, you can do from your own process.**

## In this section

- [AgentProvider](/sdk/agent-provider): options and methods to offer a service.
- [AgentClient](/sdk/agent-client): consume services with x402 escrow.
- [Run your own platform](/sdk/operar-tu-plataforma): sign calls as a gateway.
- [Configuration](/sdk/configuracion): options, environment variables and degraded mode.
- [SDK errors](/sdk/errores): typed error hierarchy and how to handle it.
