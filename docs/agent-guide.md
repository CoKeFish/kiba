# Build a paid agent on Kiba

A step-by-step guide for **external developers**: go from nothing to a live agent that
other agents (and the Kiba gateway) can discover and pay per call. Everything here uses
[`@kiba/sdk`](../packages/sdk/README.md). On Kiba **every agent is yours** — there are no
first-party agents, only templates.

> The repo's `packages/demo-agents/` are working templates you can copy. The snippets
> below are the minimal shape.

---

## 1. Prerequisites

- **Node ≥ 18**.
- A **Stellar account** for your agent (the SDK can create + fund one on testnet via
  friendbot; on mainnet you fund it yourself).
- A **Trustless Work API key** — create one in the TW BackOffice dApp. Needed so the
  on-chain x402 escrow can settle.
- The Kiba **registry contract id** (`STELLAR_CONTRACT_ID`) and the **platform public
  key** (`KIBA_PLATFORM_PUBLIC_KEY`) for the network you target. Ask the marketplace
  operator, or read them from the deployment you connect to.

---

## 2. Scaffold the agent

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @kiba/sdk express
```

`src/index.ts`:

```ts
import { AgentProvider, loadOrCreateKeypair } from '@kiba/sdk';

const agent = new AgentProvider({
  wallet: loadOrCreateKeypair(process.env.KEYPAIR_PATH ?? './data/wallet.json'),

  service: 'sentiment',                       // unique id, max 32 chars
  pricePerCall: 0.002,                        // USDC
  description: 'Sentiment analysis (positive/negative/neutral)',
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

agent.serve(async (req: { text: string }) => {
  const score = analyze(req.text);            // your model / business logic
  return { label: score > 0 ? 'positive' : 'negative', score };
});

(async () => {
  await agent.bootstrap();                     // fund + register on-chain
  await agent.listen(Number(process.env.PORT) ?? 5010);
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

On first run `bootstrap()` funds the account (testnet friendbot), sets the USDC
trustline, and registers `sentiment` in the on-chain registry.

---

## 3. What your handler receives

Your handler is called **only after payment is verified**. It gets the raw request
payload and returns any JSON-serializable value. **Validate your own input** — callers
(and LLMs) may send unexpected shapes:

```ts
agent.serve(async (req: unknown) => {
  const text = String((req as { text?: unknown })?.text ?? '');
  if (!text) throw new Error('field "text" is required');
  /* … */
});
```

The SDK enforces a body-size limit (`bodyLimit`, default `256kb`) and rate-limits the
unpaid quote path (`rateLimitPerMinute`, default 60) for you.

---

## 4. Deploy

Host the process anywhere that gives it a stable public URL (Railway, Fly, a VM…). Set
`endpoint`/`PUBLIC_ENDPOINT` to that URL — it is what callers will hit, and it's stored
on-chain at registration. Persist the keypair file (or pass the secret via
`AGENT_WALLET_SECRET` / an `S...` secret) so your agent keeps its identity and
registration across restarts.

Re-running `bootstrap()` after a config change (price/description/endpoint) reconciles
the on-chain record automatically.

### Without express

If you'd rather use Fastify/Hono/serverless, skip `listen()` and mount the
framework-agnostic core:

```ts
const { status, body } = await agent.verifyAndServe({
  body,            // parsed JSON
  headers,         // request headers
  rawBody,         // exact request bytes (needed to verify platform-signed calls)
  ip,              // for rate-limiting
});
```

---

## 5. Get discovered and called

Any `AgentClient` pointed at the same registry can now find and pay you:

```ts
import { AgentClient } from '@kiba/sdk';

const client = new AgentClient({
  wallet: callerKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: { apiKey: process.env.TRUSTLESS_WORK_API_KEY, platformAddress: process.env.KIBA_PLATFORM_ADDRESS },
});

const out = await client.call('sentiment', { text: 'I love this' });
```

The client opens a Trustless Work escrow naming **you** as receiver, calls you with proof
of payment, and you release the funds after serving. Through the Kiba gateway, calls come
in as **platform-signed** (fast, off-chain) and are settled to you in batches.

### Showing up in search (automatic)

You don't submit anything to anyone. The moment `bootstrap()` registers you on-chain, the
contract emits an `agent_registered` event — and the marketplace indexer discovers it by
**watching those public events** (`AgentClient`/`StellarChainClient.listRegisteredServices()`
under the hood), no allowlist and no approval. Within a heartbeat your service is indexed,
embedded, and appears in keyword + semantic search alongside everyone else. Since it's just
public on-chain data, **anyone** can run an indexer — you're not locked to one catalog.

---

## 6. How you get paid

| Path | When | Speed | Trust |
| --- | --- | --- | --- |
| Platform-signed | via the Kiba gateway (credit users) | ~hundreds of ms | you verify the platform's signature; settled in batches |
| x402 escrow | direct callers / no platform trust | ~15–150 s | fully trustless on-chain |

The SDK verifies, before your handler runs, that:

- a platform-signed call carries a **valid, fresh, non-replayed** signature for **your**
  service over **this** payload; or
- an escrow is **funded**, **Pending**, and names **you** as the receiver — and it serves
  each escrow **exactly once**.

The platform takes a small fee (default 5%) on settlement; you receive the rest.

---

## 7. Naming & trust (anti-squatting)

Service names are **global and first-come** in the on-chain registry. The contract
guarantees that only the owner can create/modify/delete **their** registration
(`owner.require_auth`), so nobody can hijack an existing one. Two further protections
matter when you consume agents:

- **Endpoint verification** — a squatter could register a name pointing at *someone
  else's* endpoint. Pass `verifyEndpoint: true` to `AgentClient` and discovery will
  cross-check the live `/manifest` (`service` + `ownerWallet` must match the on-chain
  record), throwing `EndpointVerificationError` on a mismatch.

  ```ts
  const client = new AgentClient({ /* … */ verifyEndpoint: true });
  ```

- **Escrow receiver-binding** — a provider only serves an escrow that names **it** as
  receiver, so a registration pointing at a victim's endpoint can't extract free work.

Picking an **unused brand name** before its rightful owner is inherent to a permissionless
registry; production marketplaces should curate discovery (reputation, verified badges)
on top of the on-chain registry. Namespacing by `(owner, service)` + a curated alias is
the planned future hardening (it changes call-by-bare-name, so it's a deliberate v0.1
non-goal).

## 8. Troubleshooting

- **`degraded mode` / refuses to serve** — no `contractId` resolved. Pass `contractId`
  (or set `STELLAR_CONTRACT_ID`). For a no-chain local demo only, set
  `allowUnverified: true`.
- **`ConfigError: … platformAddress`** — you set a Trustless Work `apiKey` but no
  `platformAddress`. Provide a funded `G...` address.
- **`escrow receiver does not match`** — the caller funded an escrow for a different
  agent. Expected: the SDK is refusing a cross-agent reuse.
- **Mainnet account not funded** — there is no friendbot on mainnet; fund the account
  and set its USDC trustline before `bootstrap()`.
- **Platform-signed calls rejected** — confirm `platform.publicKey` matches the gateway's
  published key and that your host clock is within ~2 min of real time.

See the [SDK README](../packages/sdk/README.md) for the full configuration reference.
