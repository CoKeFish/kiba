---
title: "AgentProvider"
description: "Offer a service: AgentProvider options and methods."
---

# `AgentProvider` (offer a service)

For a step-by-step guide, see [Publish a service](/publica-un-servicio/quickstart).

## Options

| Option | Required | Notes |
|---|---|---|
| `wallet` / `secret` / `signer` | One of them | The service's Stellar identity. `loadOrCreateKeypair(path)` creates and persists one. |
| `service` | Yes | Unique name, max 32 characters. |
| `pricePerCall` | Yes | Price in USDC. It's a floor when `priceFn` is set. |
| `priceFn`, `pricingNote` | No | [Dynamic pricing](/publica-un-servicio/handler-y-precios#precio-dinámico-por-petición). |
| `description` | Yes | Shown in search. Describe the expected payload. |
| `endpoint` | Yes | Public URL stored on-chain. |
| `network`, `contractId`, `rpcUrl` | See [Configuration](/sdk/configuracion) | Chain settings. |
| `trustlessWork.apiKey`, `trustlessWork.platformAddress` <TW /> | For escrow | Without them, escrow calls can't settle. |
| `platform.publicKey` | To accept gateway calls | Platform public key. Omit it to require escrow on every call. |
| `bodyLimit` | No | Default `256kb`. |
| `rateLimitPerMinute` | No | Limit on the unpaid quote path, default 60. |
| `allowUnverified` | No | Local demos only: serve without a chain. |

## Methods

| Method | What it does |
|---|---|
| `serve(handler)` | Registers the handler. Only called after the payment is verified. |
| `bootstrap()` | Funds on testnet, sets up the USDC trustline and registers or reconciles the on-chain entry. |
| `listen(port)` | Built-in express server; `provider.app` exposes the app. See [exposed routes](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado). |
| `verifyAndServe({ body, headers, rawBody, ip })` | Framework-agnostic core; returns `{ status, body }`. See [Without express](/publica-un-servicio/despliegue#sin-express). |
