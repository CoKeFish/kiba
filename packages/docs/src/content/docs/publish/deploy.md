---
title: Deploy
description: Host your service with a stable public URL and keep its on-chain identity across restarts.
sidebar:
  order: 3
---

Host the process anywhere that gives it a **stable public HTTPS URL**: a VPS, a container platform, a serverless function. Set `endpoint` (or `PUBLIC_ENDPOINT`) to that URL. It is what callers hit, and it is stored on-chain at registration.

## Keep the identity

Persist the keypair file, or pass the secret through `AGENT_WALLET_SECRET` (an `S…` secret), so the service keeps the same Stellar account across restarts and redeploys. That account is its registration and where its earnings land.

## Changing price, description, or endpoint

Change the option and restart. Re-running `bootstrap()` reconciles the on-chain record automatically.

## Without express

If you prefer Fastify, Hono, or a serverless runtime, skip `listen()` and mount the framework-agnostic core:

```ts
const { status, body } = await provider.verifyAndServe({
  body,      // parsed JSON
  headers,   // request headers
  rawBody,   // exact request bytes (needed to verify platform-signed calls)
  ip,        // for rate limiting
});
```

`express` is an optional peer dependency. You only need it for the built-in `provider.app` and `provider.listen()`.

## Checklist

- Public HTTPS endpoint reachable from the internet.
- Keypair persisted, or secret injected.
- `STELLAR_CONTRACT_ID`, `KIBA_PLATFORM_PUBLIC_KEY`, `TRUSTLESS_WORK_API_KEY`, and `KIBA_PLATFORM_ADDRESS` set for the target network.
- Host clock in sync. Platform-signed calls are rejected if the clock drifts more than about two minutes.
