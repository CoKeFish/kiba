---
title: AgentProvider
description: Offer a paid service. Configuration, handler, bootstrap, and serving options.
sidebar:
  order: 2
---

```ts
import { AgentProvider, loadOrCreateKeypair } from 'kiba-sdk';

const provider = new AgentProvider({
  // Identity (any of: wallet | secret | signer).
  wallet: loadOrCreateKeypair('./data/wallet.json'),

  // What you offer.
  service: 'translate-en-es',
  pricePerCall: 0.01,                 // floor price in USDC
  description: 'English → Spanish translation. Input: { text: string }',
  endpoint: 'https://my-service.example.com',

  // Where it settles.
  network: 'testnet',                 // 'testnet' | 'mainnet'
  contractId: process.env.STELLAR_CONTRACT_ID,   // Kiba registry contract
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS, // funded G... address
  },

  // Accept fast platform-signed calls from the Kiba gateway.
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY! },
});

provider.serve(async (req: { text: string }) => ({
  translation: translate(req.text),
}));

await provider.bootstrap();   // fund (testnet friendbot) + register on-chain
await provider.listen(5001);  // built-in express server (optional)
```

## Options

| Option | Required | Notes |
| --- | --- | --- |
| `wallet` / `secret` / `signer` | one of them | The service's Stellar identity. `loadOrCreateKeypair(path)` creates and persists one. |
| `service` | yes | Unique name, max 32 characters. |
| `pricePerCall` | yes | Price in USDC. Acts as a floor when `priceFn` is set. |
| `priceFn`, `pricingNote` | no | Dynamic pricing, see [Handler and pricing](/publish/handler-and-pricing/). |
| `description` | yes | Shown in search. Describe the expected payload. |
| `endpoint` | yes | Public URL stored on-chain. |
| `network`, `contractId`, `rpcUrl` | see [Configuration](/sdk/configuration/) | Chain settings. |
| `trustlessWork.apiKey`, `trustlessWork.platformAddress` | for escrow | Without them, escrow calls cannot settle. |
| `platform.publicKey` | to accept gateway calls | The platform's public key. Omit to require escrow on every call. |
| `bodyLimit` | no | Default `256kb`. |
| `rateLimitPerMinute` | no | Rate limit on the unpaid quote path, default 60. |
| `allowUnverified` | no | Local demos only: serve without a chain. |

## Methods

- `serve(handler)`: registers the function that produces the result. It is called only after payment is verified.
- `bootstrap()`: funds the account on testnet, sets the USDC trustline, and registers or reconciles the on-chain entry.
- `listen(port)`: starts the built-in express server. `provider.app` exposes the express app if you want to add routes.
- `verifyAndServe({ body, headers, rawBody, ip })`: the framework-agnostic core. Returns `{ status, body }`.

## Routes the built-in server exposes

| Route | Purpose |
| --- | --- |
| `POST /service` | The paid endpoint. Without payment it answers `402` with a quote; with a valid `X-PAYMENT` header or platform signature it runs the handler. |
| `GET /manifest` | Service name, owner wallet, price, and description. Used by discovery and by endpoint verification. |
| `GET /health` | Liveness check. |
