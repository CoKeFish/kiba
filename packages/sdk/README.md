# kiba-sdk

Build **paid services** for the [Kiba](https://github.com/CoKeFish/kiba) marketplace —
AI agents, APIs, indexers, any procedural tool. Services charge per call in **USDC on
Stellar**; payments settle either off-chain via the Kiba gateway (fast) or trustlessly
via [Trustless Work](https://www.trustlesswork.com) escrow (no intermediary). The SDK is
open — **every service is built and owned by an external publisher** (a company, an
organization, or an independent developer); there is no privileged "Kiba service".

```bash
npm install kiba-sdk
# express is an optional peer dep — only needed for the built-in HTTP server:
npm install express
```

Requires **Node ≥ 18** (uses global `fetch`, `performance`, `node:crypto`).

---

## Two roles

- **`AgentProvider`** — you OFFER a service. It verifies payment *before* running your
  handler, then serves and settles.
- **`AgentClient`** — you CONSUME a service. It discovers the service and handles payment
  automatically (the x402 handshake).

> The classes keep their historical `Agent*` names for API stability — they work for any
> kind of service, not just AI agents.

---

## Quickstart: provide a service

```ts
import { AgentProvider, loadOrCreateKeypair } from 'kiba-sdk';

const provider = new AgentProvider({
  // Identity (any of: wallet | secret | signer).
  wallet: loadOrCreateKeypair('./data/wallet.json'),

  // What you offer.
  service: 'translate-en-es',
  pricePerCall: 0.01,                 // floor price in USDC
  description: 'English → Spanish translation',
  endpoint: 'https://my-service.example.com',

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

provider.serve(async (req: { text: string }) => ({
  translation: translate(req.text),
}));

await provider.bootstrap();   // fund (testnet friendbot) + register on-chain
await provider.listen(5001);  // built-in express server (optional, see below)
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

### Media licenses and catalogs

A service that delivers files can attach a **license** to each result. Declare default terms in
`license` and return a `license` block with the file's SHA-256; the Kiba gateway writes a license
document for the buyer (file hash, terms, price) and the Stellar payment of that call carries its fingerprint:

```ts
import { AgentProvider, sha256Hex } from 'kiba-sdk';

const agent = new AgentProvider({
  /* … */
  license: { name: 'commercial', notes: 'AI-generated; non-exclusive.' },
});
agent.serve(async (req) => {
  const file = await generate(req);
  return {
    downloadUrl: file.url,
    license: { assetSha256: sha256Hex(file.bytes), filename: file.name, mimeType: file.mime, bytes: file.bytes.length },
  };
});
```

To sell a **catalog of your own files**, use `MediaCatalogProvider`. Search and item details are
public and free (`GET /catalog/search?q=…`, used by Kiba's federated `search_media`); buying is a
paid call with `{ assetId }` at the item's price, answered with a signed, expiring download link.
Items without `price_usd` cost `pricePerCall`, which is also the minimum: a cheaper item is listed
and charged at `pricePerCall`, so set it at or below your cheapest item.

```ts
import { FolderSource, MediaCatalogProvider } from 'kiba-sdk';

// A folder with your files and an items.csv:
// id,file,title,type,tags,price_usd,license,attribution,attribution_text,description,preview
const source = await FolderSource.open({ dir: './catalog', publicBaseUrl: PUBLIC_ENDPOINT });
const agent = new MediaCatalogProvider({
  wallet, service: 'anas-photos', pricePerCall: 0.05, endpoint: PUBLIC_ENDPOINT,
  source, license: { name: 'commercial' },
});
await agent.bootstrap();
await agent.listen(5011);
```

Already have the catalog behind your own HTTP API? Don't migrate it: `HttpCatalogSource` reads it
with your key and a `map` from your format to a Kiba item. It caches the catalog (background reload
every `refreshMs`, 5 min by default; keeps the last good copy if your API fails), searches in memory,
asks your API for a fresh link on each purchase (`downloadPath`, or a static `downloadUrl`), computes
the SHA-256 once if your API doesn't give it, and only sends your `headers` to the origin of `baseUrl`.
For custom pagination, pass `fetchItems: async (api) => …` instead of `listPath`.

```ts
import { HttpCatalogSource } from 'kiba-sdk';

interface MyApiItem { sku: string; name: string; price_cents: number; thumbnail_url?: string }

const source = new HttpCatalogSource<MyApiItem>({
  baseUrl: 'https://api.mycompany.com/v1',
  headers: { Authorization: `Bearer ${process.env.COMPANY_API_KEY}` },
  listPath: 'items', // an array or { items | data | results: [] }
  map: (raw) => ({
    id: raw.sku, title: raw.name, type: 'image', priceUsd: raw.price_cents / 100,
    previewUrl: raw.thumbnail_url,
    downloadPath: `items/${raw.sku}/download-link`, // answers { url, sha256?, bytes? }
  }),
  publicBaseUrl: PUBLIC_ENDPOINT,
});
// then: new MediaCatalogProvider({ ..., source })
```

Catalog in S3, in your own database or elsewhere? Implement `CatalogSource` (`list`, `search`,
`get`, `deliver`, optional `preview`). Kiba never connects to your storage; it only talks to your
service. Templates: `personal`, `commercial`, `commercial-attribution` (see `LICENSE_TEMPLATES`).

---

## Quickstart: consume a service

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

`client.call()` discovers the service (on-chain registry, with a discovery-backend
fallback), funds a Trustless Work escrow naming the service as receiver, then re-calls
with proof of payment. Use `callWithTrace()` to also get a step-by-step timeline.

---

## Trust model

The platform proves a paid call to a service **without sharing any secret**:

- The platform holds an ed25519 **private** key it never discloses.
- Each service is configured with the platform's **public** key (`platform.publicKey`,
  a Stellar `G…` address — safe to publish).
- For each call the platform mints a short certificate `{ service, payloadHash, ts,
  nonce }` and **signs** it; the service **verifies** the signature, that the payload
  matches, that the cert is fresh, and that the nonce hasn't been replayed.

Because the value a service holds (a public key) cannot mint calls, a leak of any single
service's config can never impersonate the platform to other services. Mint the headers
yourself if you operate the platform:

```ts
import { LocalPlatformSigner } from 'kiba-sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(serviceEndpoint, payload, { signer: platform, service });
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
const { status, body } = await provider.verifyAndServe({ body, headers, rawBody, ip });
```

Mount that in Fastify, Hono, a serverless function, etc. You only need express if you
use the built-in `provider.app` / `provider.listen()`.

---

## Errors

Every intentional error extends `KibaError`. Catch and branch on the subclass:
`ConfigError`, `ServiceNotFoundError`, `PaymentRequiredError`, `EscrowError`,
`PlatformAuthError`, `AgentCallError`.

```ts
import { ServiceNotFoundError, EscrowError } from 'kiba-sdk';

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

A full walkthrough — **create → deploy → register** an external service — lives in
[`docs/service-guide.md`](https://github.com/CoKeFish/kiba/blob/main/docs/service-guide.md).

## License

[MIT](./LICENSE)
