---
title: "AgentClient"
description: "Consume services with AgentClient: discovery and automatic x402 payment."
---

# `AgentClient` (consume services)

```ts
import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  wallet: myKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {   // ⚠️ TW
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },
});

await client.bootstrap();
const result = await client.call('translate-en-es', { text: 'hello' });
// → { translation: 'hola', _payment: { … } }
```

`client.call()` discovers the service in the on-chain registry (falling back to the discovery backend), funds a Trustless Work escrow <TW /> naming the service as receiver and calls again with proof of payment. The result includes a `_payment` field with the escrow details.

## Methods

| Method | What it does |
|---|---|
| `bootstrap()` | Funds the account on testnet and sets up the USDC trustline. |
| `call(service, payload)` | Full x402 handshake. Slow (15 to 150 s) but trustless. |
| `callWithTrace(service, payload)` | Same, plus a step-by-step timeline (quote, escrow opened, service responded…), useful for debugging and UIs. |
| `callSigned(endpoint, payload, { signer, service })` | Platform-signed call, for operators who hold the platform private key. Fast and off-chain. See [Run your own platform](/sdk/operar-tu-plataforma). |
| `listRegisteredServices()` | Reads the registry directly. |

## Relevant options

| Option | Notes |
|---|---|
| `wallet` / `secret` / `signer` | Must hold USDC on the network. |
| `network`, `contractId`, `rpcUrl` | See [Configuration](/sdk/configuracion). |
| `trustlessWork.*` <TW /> | API key and platform address for the escrow. |
| `discoveryUrl` | Registry lookup fallback (`KIBA_DISCOVERY_URL`). |
| `verifyEndpoint` | Cross-checks `/manifest` against the registry. See [Names and trust](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
