---
title: "Deployment"
description: "Publish your service at a stable HTTPS URL, keep its identity and know the routes it exposes."
---

# Deployment

Host the process wherever it gets a **stable public HTTPS URL** (VPS, container platform, serverless function). Set `endpoint` (or `PUBLIC_ENDPOINT`) to that URL: it's what clients call and it's stored on-chain at registration.

## Keep the identity

Persist the keypair file or pass the secret through `AGENT_WALLET_SECRET` (an `S…` secret) to keep the same Stellar account across restarts and redeploys. That account is its registration and where its earnings arrive.

## Change price, description or endpoint

Change the option and restart. Running `bootstrap()` again reconciles the on-chain registration automatically.

## Without express {/* #sin-express */}

With Fastify, Hono or serverless, skip `listen()` and mount the framework-agnostic core:

```ts
const { status, body } = await provider.verifyAndServe({
  body,      // parsed JSON
  headers,   // request headers
  rawBody,   // exact request bytes (needed to verify platform-signed calls)
  ip,        // for rate limiting
});
```

`express` is an optional peer dependency; it's only needed for `provider.app` and `provider.listen()`.

## Checklist

- [ ] Public HTTPS endpoint reachable from the internet.
- [ ] Keypair persisted, or secret injected.
- [ ] Set for the target network: `STELLAR_CONTRACT_ID`, `KIBA_PLATFORM_PUBLIC_KEY` and, for Trustless Work, `TRUSTLESS_WORK_API_KEY` and `KIBA_PLATFORM_ADDRESS`. <TW />
- [ ] Host clock in sync: signed calls are rejected if the clock drifts more than ~2 minutes.

## Routes exposed by the built-in server {/* #rutas-que-expone-el-servidor-integrado */}

| Route | Purpose |
|---|---|
| `POST /service` | The payment endpoint. Without payment it answers `402` with a quote; with a valid `X-PAYMENT` header or a platform signature it runs the handler. |
| `GET /manifest` | Service name, owner wallet, price and description. Used by discovery and [endpoint verification](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
| `GET /health` | Liveness check. |
