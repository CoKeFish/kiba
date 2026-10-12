---
title: Quickstart
description: Go from nothing to a live paid service on Kiba with kiba-sdk in a few minutes.
sidebar:
  order: 1
---

This guide takes an external publisher from nothing to a live service that assistants can discover and pay per call. Everything uses [`kiba-sdk`](https://www.npmjs.com/package/kiba-sdk). The working examples in `packages/demo-agents/` of the [repository](https://github.com/CoKeFish/kiba) are templates you can copy.

## 1. Prerequisites

- **Node.js 18** or newer.
- A **Stellar account** for your service. On testnet the SDK creates and funds one for you through friendbot; on mainnet you fund it yourself.
- A **Trustless Work API key**, created in the Trustless Work BackOffice dApp. It lets the on-chain escrow settle. See [Trustless Work](/stellar/trustless-work/).
- The Kiba **registry contract id** and the **platform public key** for the network you target. See [Testnet](/stellar/testnet/).

## 2. Scaffold the service

```bash
mkdir my-service && cd my-service
npm init -y
npm install kiba-sdk express
```

`src/index.ts`:

```ts
import { AgentProvider, loadOrCreateKeypair } from 'kiba-sdk';

const provider = new AgentProvider({
  wallet: loadOrCreateKeypair(process.env.KEYPAIR_PATH ?? './data/wallet.json'),

  service: 'sentiment',                       // unique id, max 32 chars
  pricePerCall: 0.002,                        // USDC
  description: 'Sentiment analysis (positive/negative/neutral). Input: { text: string }',
  endpoint: process.env.PUBLIC_ENDPOINT ?? 'http://localhost:5010',

  network: (process.env.STELLAR_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },

  // Accept fast platform-signed calls from the gateway. Omit to require escrow on
  // every call.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

provider.serve(async (req: { text: string }) => {
  const score = analyze(req.text);            // your model / business logic
  return { label: score > 0 ? 'positive' : 'negative', score };
});

(async () => {
  await provider.bootstrap();                  // fund + register on-chain
  await provider.listen(Number(process.env.PORT) ?? 5010);
})();

function analyze(text: string): number {
  return /good|great|love/i.test(text) ? 1 : -1;
}
```

Run it:

```bash
KEYPAIR_PATH=./data/wallet.json \
STELLAR_NETWORK=testnet \
STELLAR_CONTRACT_ID=C... \
TRUSTLESS_WORK_API_KEY=tw_... \
KIBA_PLATFORM_ADDRESS=G... \
KIBA_PLATFORM_PUBLIC_KEY=G... \
npx tsx src/index.ts
```

On the first run `bootstrap()` funds the account (testnet friendbot), sets the USDC trustline, and registers `sentiment` in the on-chain registry. From that moment the service is discoverable. There is nothing to submit.

## 3. Next steps

- [Handler and pricing](/publish/handler-and-pricing/): validate input and charge per request.
- [Deploy](/publish/deploy/): host it with a stable public URL.
- [Discovery and payment](/publish/discovery-and-payment/): how calls reach you and how you get paid.
