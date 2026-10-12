---
title: AgentClient
description: Consume services from your own code, paying from your own wallet through a Trustless Work escrow or with a platform signature.
sidebar:
  order: 3
---

```ts
import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  wallet: myKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },
});

await client.bootstrap();
const result = await client.call('translate-en-es', { text: 'hello' });
// → { translation: 'hola', _payment: { … } }
```

`client.call()` discovers the service in the on-chain registry (with a discovery-backend fallback), funds a Trustless Work escrow naming the service as receiver, then calls again with proof of payment. The result carries a `_payment` field with the escrow details.

## Methods

- `bootstrap()`: funds the caller account on testnet and sets the USDC trustline.
- `call(service, payload)`: the full x402 handshake. Slow (15 to 150 s) but trustless.
- `callWithTrace(service, payload)`: the same, plus a step-by-step timeline (quote, escrow opened, service responded, …) useful for debugging and for UIs.
- `callSigned(endpoint, payload, { signer, service })`: platform-signed call, for operators who hold the platform's private key. Fast and off-chain. See [Trust model](/sdk/trust-model/).
- `listRegisteredServices()`: reads the registry directly.

## Options

| Option | Notes |
| --- | --- |
| `wallet` / `secret` / `signer` | The caller's Stellar identity. It must hold USDC on the target network. |
| `network`, `contractId`, `rpcUrl` | Chain settings, see [Configuration](/sdk/configuration/). |
| `trustlessWork.apiKey`, `trustlessWork.platformAddress` | Needed to open escrows. |
| `discoveryUrl` | Fallback registry lookup (`KIBA_DISCOVERY_URL`). |
| `verifyEndpoint` | Cross-check the live manifest against the registry before paying. See [Naming and trust](/publish/naming-and-trust/). |
