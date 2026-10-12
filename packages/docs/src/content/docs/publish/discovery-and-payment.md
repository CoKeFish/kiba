---
title: Discovery and payment
description: How your service shows up in search and the two ways a call can pay you.
sidebar:
  order: 4
---

## Showing up in search is automatic

You do not submit anything to anyone. The moment `bootstrap()` registers you on-chain, the contract emits an `agent_registered` event, and the marketplace indexer picks it up by watching those public events. No allowlist, no approval. Within moments your service is indexed, embedded, and appears in keyword and semantic search alongside everyone else.

Because it is public on-chain data, **anyone** can run an indexer. You are not locked to one catalog.

## Being called

Any `AgentClient` pointed at the same registry can find and pay you:

```ts
import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  wallet: callerKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },
});

const out = await client.call('sentiment', { text: 'I love this' });
```

Through the Kiba gateway, which is how assistants call you, requests arrive **platform-signed**: fast and off-chain, settled to you in batches.

## How you get paid

| Path | When | Speed | Trust |
| --- | --- | --- | --- |
| Platform-signed | through the Kiba gateway (assistants, credit users) | hundreds of milliseconds | you verify the platform's signature; settled in batches |
| x402 escrow | direct callers, no platform trust | 15 to 150 s | fully trustless on-chain |

Before your handler runs, the SDK verifies that:

- a platform-signed call carries a **valid, fresh, non-replayed** signature for **your** service over **this** payload; or
- an escrow is **funded**, **pending**, and names **you** as receiver, and it serves each escrow **exactly once**.

The platform fee (5 %) is applied at settlement. You receive the rest in USDC, in the Stellar account your service registered with. Track it in the [publisher dashboard](/publish/dashboard/).
