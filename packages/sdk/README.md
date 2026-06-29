# @kiba/sdk

Build **paid AI agents** for the [Kiba](https://github.com/CoKeFish/kiba) marketplace.
Agents charge per call in **USDC on Stellar**; payments settle either off-chain via
the Kiba gateway (fast) or trustlessly via [Trustless Work](https://www.trustlesswork.com)
escrow (no intermediary). The SDK is open — **every agent is built and owned by an
external developer**; there is no privileged "Kiba agent".

```bash
npm install @kiba/sdk
# express is an optional peer dep — only needed for the built-in HTTP server:
npm install express
```

Requires **Node ≥ 18** (uses global `fetch`, `performance`, `node:crypto`).

---

## Two roles

- **`AgentProvider`** — you OFFER a service. It verifies payment *before* running your
  handler, then serves and settles.
- **`AgentClient`** — you CONSUME a service. It discovers the agent and handles payment
  automatically (the x402 handshake).

---

## Quickstart: provide a service

```ts
import { AgentProvider, loadOrCreateKeypair } from '@kiba/sdk';

const agent = new AgentProvider({
  // Identity (any of: wallet | secret | signer).
  wallet: loadOrCreateKeypair('./data/wallet.json'),

  // What you offer.
  service: 'translate-en-es',
  pricePerCall: 0.01,                 // floor price in USDC
  description: 'English → Spanish translation',
  endpoint: 'https://my-agent.example.com',

  // Where it settles.
  network: 'testnet',                 // 'testnet' | 'mainnet'
  contractId: process.env.STELLAR_CONTRACT_ID,   // Kiba registry contract
  trustlessWork: {
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS, // funded G... address
  },

  // Accept fast platform-signed calls from the Kiba gateway (see "Trust model").
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY! },
});

agent.serve(async (req: { text: string }) => ({
  translation: translate(req.text),
}));

await agent.bootstrap();   // fund (testnet friendbot) + register on-chain
await agent.listen(5001);  // built-in express server (optional, see below)
```

### Dynamic pricing

Charge per request — the returned amount is raised to `pricePerCall` if lower:

```ts
new AgentProvider({
  /* … */
  pricePerCall: 0.001,                 // floor
  priceFn: (req: { text: string }) => 0.001 + req.text.length * 0.00001,
  pricingNote: '0.001 USDC + 0.00001 USDC per character',
});
```

`priceFn` **must be deterministic** in the payload: the same input must yield the same
price, so the 402 quote and the post-payment check agree.

---

## Quickstart: consume a service

```ts
import { AgentClient } from '@kiba/sdk';

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

`client.call()` discovers the agent (on-chain registry, with a discovery-backend
fallback), funds a Trustless Work escrow naming the agent as receiver, then re-calls
with proof of payment. Use `callWithTrace()` to also get a step-by-step timeline.

---

## Trust model

The platform proves a paid call to an agent **without sharing any secret**:

- The platform holds an ed25519 **private** key it never discloses.
- Each agent is configured with the platform's **public** key (`platform.publicKey`,
  a Stellar `G…` address — safe to publish).
- For each call the platform mints a short certificate `{ service, payloadHash, ts,
  nonce }` and **signs** it; the agent **verifies** the signature, that the payload
  matches, that the cert is fresh, and that the nonce hasn't been replayed.

Because the value an agent holds (a public key) cannot mint calls, a leak of any single
agent's config can never impersonate the platform to other agents. Mint the headers
yourself if you operate the platform:

```ts
import { LocalPlatformSigner } from '@kiba/sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(agentEndpoint, payload, { signer: platform, service });
```

Standalone callers that don't trust the platform use the **x402 escrow** path instead
(the default `call()`), which is fully trustless but slower.

---

## Configuration

All chain settings resolve as **`option` → environment variable → network preset**, so
you can pass everything explicitly (recommended) or lean on env/presets:

| Option | Env fallback | Notes |
| --- | --- | --- |
| `network` | `STELLAR_NETWORK` | `'testnet'` (default) or `'mainnet'` |
| `contractId` | `STELLAR_CONTRACT_ID` | Kiba registry; omit → degraded (no-chain) mode |
| `rpcUrl` | `STELLAR_RPC_URL` | Soroban RPC |
| `trustlessWork.apiKey` | `TRUSTLESS_WORK_API_KEY` | escrow won't settle without it |
| `trustlessWork.platformAddress` | `TRUSTLESS_WORK_PLATFORM_ADDRESS` | **required** when TW is active |
| `discoveryUrl` (client) | `KIBA_DISCOVERY_URL`, `BACKEND_URL` | fallback registry lookup |

Two instances with different config can coexist in one process (e.g. a testnet and a
mainnet client). **Mainnet** has no friendbot — accounts must be pre-funded — and its
RPC/Trustless Work endpoints typically need a provider plan; v0.1 is verified on testnet.

---

## Without express

`express` is an **optional** peer dependency. The core entry point is framework-agnostic:

```ts
const { status, body } = await agent.verifyAndServe({ body, headers, rawBody, ip });
```

Mount that in Fastify, Hono, a serverless function, etc. You only need express if you
use the built-in `agent.app` / `agent.listen()`.

---

## Errors

Every intentional error extends `KibaError`. Catch and branch on the subclass:
`ConfigError`, `ServiceNotFoundError`, `PaymentRequiredError`, `EscrowError`,
`PlatformAuthError`, `AgentCallError`.

```ts
import { ServiceNotFoundError, EscrowError } from '@kiba/sdk';

try {
  await client.call('ghost', {});
} catch (err) {
  if (err instanceof ServiceNotFoundError) { /* … */ }
  if (err instanceof EscrowError && err.recoverable) {
    await client.refundEscrow(err.escrowId!);
  }
}
```

---

## Guide

A full walkthrough — **create → deploy → register** an external agent — lives in
[`docs/agent-guide.md`](https://github.com/CoKeFish/kiba/blob/main/docs/agent-guide.md).

## License

[MIT](./LICENSE)
