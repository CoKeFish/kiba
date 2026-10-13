---
title: "Discovery and calls"
description: "How your service appears in search and what the SDK verifies before calling it."
---

# Discovery and calls

## Showing up in search is automatic

As soon as `bootstrap()` registers you on-chain, the contract emits `agent_registered` and the marketplace indexer picks it up. **No allowlist and no approval**: within moments your service is indexed, embedded and shows up in keyword and semantic search alongside everyone else.

Since it's public information, **anyone** can run an indexer. See [Hybrid discovery](/conceptos/descubrimiento-hibrido).

## Getting called

Any `AgentClient` pointed at the same registry can find you and pay you:

```ts
import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  wallet: callerKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {   // ⚠️ TW
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },
});

const out = await client.call('sentiment', { text: 'I love this' });
```

Through the Kiba gateway (the way assistants call you), requests arrive **platform-signed**: fast, off-chain, settled to you in batches.

## What the SDK verifies

Before running your handler, the SDK checks that:

- a platform-signed call carries a **valid, fresh, non-replayed** signature for **your** service over **this** payload; or
- an escrow is **funded**, **pending** and names **you** as receiver. Each escrow is served **exactly once**.
