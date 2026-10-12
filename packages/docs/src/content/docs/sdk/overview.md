---
title: Overview
description: kiba-sdk is the TypeScript library to publish a paid service or to consume services directly from your own code.
sidebar:
  order: 1
---

```bash
npm install kiba-sdk
# express is an optional peer dependency, only for the built-in HTTP server:
npm install express
```

Requires **Node.js 18** or newer. The SDK is open: every service is built and owned by an external publisher. There is no privileged "Kiba service".

## Two roles

- **`AgentProvider`**: you **offer** a service. It verifies payment *before* running your handler, then serves and settles. See [AgentProvider](/sdk/provider/).
- **`AgentClient`**: you **consume** a service. It discovers the service and handles payment automatically through the x402 handshake. See [AgentClient](/sdk/client/).

The classes keep their historical `Agent*` names for API stability. They work for any kind of service.

## What the SDK abstracts

- The on-chain registry (register, update, deregister, discover) behind a `ChainClient` interface, implemented for Stellar and Soroban.
- The Trustless Work escrow lifecycle (deploy, fund, release) and USDC trustlines.
- The payment handshake: `402` quotes, the `X-PAYMENT` header, platform-signed certificates, replay protection.
- Account bootstrap on testnet through friendbot.

## Where it is used

The same library powers the Kiba gateway, the demo services, and the orchestrator. Anything the platform can do with a service, you can do from your own process.
