# Kiba at HackMeridian 2026

**Track:** Scale · **Event:** HackMeridian 2026, Lisbon, 25–26 October · **Branch:** [`hackmeridian-2026`](https://github.com/CoKeFish/kiba/commits/hackmeridian-2026)

A five-minute guide for the jury: the problem, what we built, how it works, how to verify a license yourself, and what is simulated or still pending. For the product as a whole, see the [README](README.md).

Kiba already lets AI assistants find and pay for services. During the hackathon we added a second kind of service: **indexed services**. Companies and creators that already exist sell licensed digital assets (photos, music, 3D models, documents) through Kiba without moving their catalog, and every purchase comes with a license that can be verified.

## The problem

- **Assistants need media they can use legally.** An assistant can find a photo or a music clip, but it cannot buy a specific file with clear terms, and afterwards nobody can prove which rights came with it.
- **Companies that already sell this content have no channel to assistants.** A stock agency or an independent creator has a catalog and an API. To reach assistants today, they would have to move that catalog to a new platform.
- **A license is usually a PDF or an email.** A third party cannot check it.

## The idea

Companies keep their catalog and their API. Kiba lets any assistant search across all of them, pay per item, and receive the file together with a license document. The document's fingerprint is written into the payment on Stellar, so anyone can check the license against the chain.

## What we built

| Piece | Where |
|---|---|
| Catalog provider: sells licensed files from a folder with an `items.csv`, or from any source that implements four functions | [`packages/sdk/src/catalog.ts`](packages/sdk/src/catalog.ts) |
| Connector for an existing company API: maps its records to Kiba's format and asks its API for a signed download link at purchase time | [`packages/sdk/src/catalog-http.ts`](packages/sdk/src/catalog-http.ts) |
| License terms (media-industry uses: advertising, social-media, broadcast, print, merchandise, editorial, web) and the `license` block a service returns with each file | [`packages/sdk/src/license.ts`](packages/sdk/src/license.ts) |
| Federated search `search_media`, in the MCP connector and in the REST API (`GET /v1/media/search`) | [`packages/gateway/src/media.ts`](packages/gateway/src/media.ts), [`packages/mcp-server/src/index.ts`](packages/mcp-server/src/index.ts) |
| License document: a plain JSON file per purchase (buyer, seller, file SHA-256, terms, price). Its fingerprint goes into the `reference` argument of the payment | [`packages/gateway/src/licenses.ts`](packages/gateway/src/licenses.ts), [`packages/gateway/src/kiba-pay.ts`](packages/gateway/src/kiba-pay.ts) |
| Demo catalog `media-catalog`: photos, backgrounds and music clips | [`packages/demo-agents/src/media-catalog.ts`](packages/demo-agents/src/media-catalog.ts) |
| Demo company `andes-stock`: simulated, see [What is real](#what-is-real-and-what-is-not) | [`packages/demo-agents/src/andes-stock.ts`](packages/demo-agents/src/andes-stock.ts) |
| Dashboard: catalog view, public verification page, readable call summary, license card | [`MediaCatalog.tsx`](packages/dashboard/src/routes/MediaCatalog.tsx), [`Verify.tsx`](packages/dashboard/src/routes/Verify.tsx), [`ResponseSummary.tsx`](packages/dashboard/src/components/results/ResponseSummary.tsx), [`LicenseCard.tsx`](packages/dashboard/src/components/results/LicenseCard.tsx) |
| Documentation for publishers and buyers, in ES, EN and PT | [`packages/docs/docs/conceptos/licencias.md`](packages/docs/docs/conceptos/licencias.md) |

## How it works

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant AI as AI assistant
    participant K as Kiba gateway
    participant C as Catalogs
    participant S as Service
    participant B as Stellar

    U->>AI: "A lo-fi track for my video intro"
    AI->>K: search_media(query)
    K->>C: GET /catalog/search (free)
    C-->>K: Items with price and license summary
    K-->>AI: Merged results from all catalogs
    AI-->>U: Options with price and preview
    U->>AI: "Buy the first one"
    AI->>K: call_agent(service, { assetId })
    K->>S: Paid call (credit, spend permission or wallet)
    S-->>K: Download link + license block (file SHA-256, terms)
    K->>K: Write the license document
    K-->>AI: File link + license document
    AI-->>U: The file and its license
    K-)B: pay(service wallet, amount, reference = document fingerprint)
    Note over K,C: Searches run against every catalog at the same time
    Note over K,B: Credit purchases: sent after the reply by default; the explorer link appears when it confirms
```

1. **Search is free.** `search_media` asks every catalog that exposes `GET /catalog/search` at the same time. Each catalog has a 3-second timeout. Results are interleaved so that no catalog dominates, and each item shows its price and a summary of its license. Search is live: there is no index yet.
2. **The price on screen is the price charged.** Each item has its own price. A catalog never charges less than its minimum price, so the announced price is the larger of the two. A quote is bound to the request body, so a quote for a cheap item cannot be used to pay for an expensive one.
3. **Buying is a paid call.** The assistant calls `call_agent(service, { assetId })`. The service returns a download link and a `license` block with the file's SHA-256 and its terms. The payment comes from credit, from a spend permission, or from the user's own wallet (x402 on Stellar in the wallet mode). If the service fails, no license is issued, and in credit mode the charge is refunded.
4. **Kiba writes the license document.** As soon as the service delivers the file (before the payment, in credit mode), the gateway writes a plain JSON document: the buyer (their Kiba account and, if they have one, their Stellar address), the seller (the service and the wallet that gets paid), the file's SHA-256, the terms and the price. Its fingerprint is the SHA-256 of the document in canonical JSON (RFC 8785). Kiba does not sign it.
5. **The fingerprint travels in the payment.** In credit mode, with Kiba's payments contract active, the per-call payment is a `pay` transaction. Its `reference` argument is the first 8 bytes of the fingerprint, read as a 64-bit number. A Soroban transaction has no memo and the contract has no 32-byte field, so 64 bits is what fits. The contract also emits `reference` in its `paid` event. Wallet and spend-permit purchases get a document too, but their payment does not carry the fingerprint in the current code (see [What is real](#what-is-real-and-what-is-not)).
6. **Anyone can check it.** The document is public. Kiba's verify endpoint checks the document against its fingerprint, looks up the payment on Stellar and reads the status. Anyone can also repeat the check without Kiba (see below). The chain is the anchor: a document that differs from the one that was paid for has a different fingerprint.

## Why Stellar

- **Registry.** Services are published on the Soroban registry contract `CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`. We did not modify it during the hackathon.
- **Payments.** Settlement is in USDC on Stellar. Per-call payments go through Kiba's payments contract (`pay`, source in [`packages/contracts-payments`](packages/contracts-payments)), and the license fingerprint is its `reference` argument.
- **Public proof.** The payment transaction is the proof. Anyone can read its `reference` from the transaction and compare it with the document. The verification page links to that transaction.

## Verify a license yourself

Replace `<license-id>` with a license ID from a purchase (IDs start with `lic_`). <!-- TODO(deploy): ID de licencia de ejemplo en vivo, con su verificación -->

```bash
# 1. The license document: plain JSON, public, no account needed
curl https://api.kiba.tools/v1/licenses/<license-id>/document -o license.json

# 2. The license summary: transaction hash, fingerprint, terms, status
curl https://api.kiba.tools/v1/licenses/<license-id>

# 3. Kiba's check: the document, the payment on Stellar, not revoked
curl https://api.kiba.tools/v1/licenses/<license-id>/verify
```

- **Public verification page, no account:** `https://app.kiba.tools/verify/<license-id>`.
- **Without trusting Kiba:**
  1. Hash the document you downloaded (`sha256sum license.json`). That is the fingerprint, and it matches `documentSha256` in step 2.
  2. Take its first 16 hex characters and read them as a 64-bit unsigned integer.
  3. Open the transaction (`txHash` in step 2) in a Stellar explorer. The fourth argument of `pay` is `reference`; the `paid` event carries the same value. If the explorer does not show the arguments, the transaction's XDR does. It must equal the number from step 2.
  4. Compare `asset.sha256` in the document with the SHA-256 of the file you received.
  5. Check that `status` is `valid`.

## Demo script (60–90 seconds)

The demo uses the live catalog. <!-- TODO(deploy): URL en vivo del catálogo media-catalog (agent-catalog.kiba.tools) -->

| Time | You do | You see |
|---|---|---|
| 0–10 s | Ask the assistant: "a lo-fi track for my video intro" | The assistant decides to search for licensed media |
| 10–25 s | The assistant calls `search_media` | Items from the catalogs, each with price, preview and license summary |
| 25–40 s | Pick one. The assistant calls `call_agent` with its `assetId` | The download link and the license. The license document is written |
| 40–60 s | Open the license card in Results, then the document | The file's SHA-256, the terms, the price, the fingerprint and the payment link |
| 60–80 s | Open `/verify/<license-id>` | Four checks: the document matches its fingerprint, the payment exists, the payment carries the fingerprint, not revoked. Use a credit purchase for this step |
| 80–90 s | Optional: search for something Andes Stock sells | Items from the simulated company, bought through its own API. <!-- TODO(deploy): URL en vivo de andes-stock (agent-andes.kiba.tools) --> |

## Quality

- **Tests.** The SDK and gateway test suites cover the license document and its checks: a tampered document, a payment with another fingerprint and a revoked license all fail verification ([`licenses.test.ts`](packages/gateway/test/licenses.test.ts)). They also cover catalogs ([`catalog.test.ts`](packages/sdk/test/catalog.test.ts), [`catalog-http.test.ts`](packages/sdk/test/catalog-http.test.ts)) and federated search ([`media.test.ts`](packages/gateway/test/media.test.ts)).
- **Quality review.** Before the demo, a review fixed 8 bugs. Two of them (an XSS in the certificate and a double deposit into ACTA) were in pieces that were removed later, so they no longer apply to the product. The six that still apply:
  1. The announced price of each item is the price charged.
  2. The x402 quote is bound to the request body, so a cheap quote cannot pay for an expensive item.
  3. An on-chain hash that arrived before its license row is no longer lost.
  4. The media catalog's description now points assistants to `search_media` for free search.
  5. A preview file that does not exist is an error when the catalog opens, not a silent gap.
  6. A broken line continuation in the agent entrypoint script.

## Timeline

Goals were declared in the submission form on Sunday at 13:00 WET, before the first commit. All commits below are from 25 October 2026, in order.

| Commit | What |
|---|---|
| `41fc53d` | License credentials: signed W3C Verifiable Credential, public verification, certificate, status list, license card. Replaced by `56006b3` |
| `595b177` | `MediaCatalogProvider` and `FolderSource` in the SDK, and the `media-catalog` service |
| `101f711` | Federated `search_media` in the MCP connector and the REST API |
| `d9e6471` | ACTA deposit with a retry queue (removed in `56006b3`); licenses documentation in ES, EN and PT |
| `42ad6bb` | README |
| `1966b3c` … `0a1f84b` | Quality review: 8 bugs fixed (9 commits) |
| `3c5008f` | Docs: minimum price per catalog, search with `search_media`, revocation without a refund promise |
| `c1be479` | Dashboard: secondary view of the licensed-media catalogs |
| `b41117a` | Playground: readable summary of the response instead of raw JSON |
| `288dfa4` | Certificate redesigned as a document, in the browser's language (ES, EN, PT). The certificate was removed in `56006b3` |
| `ae25144` | Dashboard: the licensed-media page uses the full width |
| `56006b3` | Rodion Tabares: a license is a document whose fingerprint travels in the payment. Credential, status list, ACTA and certificate removed |
| After `56006b3` | `HttpCatalogSource` with 7 tests; the `andes-stock` demo; the real per-item price in the Playground; federated search tested with two catalogs; download links that survive restarts; a media-catalog description shortened to fit the registry's 512-byte limit |

## What is real and what is not

| Area | Status | Detail |
|---|---|---|
| License document and its fingerprint | Built and tested | One plain JSON document per paid file. Its fingerprint goes into the payment's `reference` |
| Payment proof | Partial | Works for credit purchases paid through Kiba's payments contract. Wallet purchases (x402 escrow) do not carry the fingerprint in the current code, so their verification fails the payment check. Spend-permit purchases record no payment hash, so they stay pending |
| Verification (API and page) | Built | Checks the document, the payment and the status. Shows pending while no payment is linked |
| Revocation | Partial | `revokeLicense` exists, and a test checks that a revoked license fails verification. No route or job calls it yet, and refunds do not revoke a license yet |
| Federated search | Built | Live fan-out to the catalogs, no index yet |
| Refunds on failure | Built | A failed call issues no license. In credit mode the charge is refunded |
| `HttpCatalogSource` | Built, 7 tests | No real company is connected yet |
| `media-catalog` content | Demo content | 6 photos and backgrounds generated with AI (Gemini) and 3 music tracks composed by code synthesis, all made by the team for the demo. No third-party material |
| `andes-stock` | **Simulated** | "Andes Stock" is a simulated company. Its "existing" API (API key, its own record format, signed download links) runs inside the demo process and serves [`partner-sample`](packages/demo-agents/partner-sample): 7 stock photos and 1 music track. Author names are fictional. <!-- TODO(deploy): URL en vivo de andes-stock (agent-andes.kiba.tools) --> |
| Testnet deployment of both catalogs | Pending | <!-- TODO(deploy): URLs públicas en testnet de media-catalog (agent-catalog.kiba.tools) y andes-stock (agent-andes.kiba.tools) --> |
| Download links | Built; restart-safe secret not committed yet | Signed (HMAC) and valid for 24 hours by default. The secret is derived from the media-catalog wallet, so links survive restarts. The license keeps the file's hash after the link expires |

## Next steps

- Deploy both demo catalogs to testnet and publish their URLs.
- Put the fingerprint in wallet and spend-permit payments too, so every purchase can be verified.
- Decide when a license is revoked: a procedure for substantiated claims, and whether refunds revoke. Then a route or job calls `revokeLicense`.
- A search index instead of live fan-out, once there are many catalogs.
- Export the terms as an RSL document. They already follow the shape of RSL 1.0.
- Connect a real company's catalog API with `HttpCatalogSource`.

## Team

Made in Bogotá, Colombia 🇨🇴

- **Rodion Tabares** — Engineering ([GitHub](https://github.com/CoKeFish))
- **André Landinez** — Engineering ([GitHub](https://github.com/andreMD287))
- **Lizeth Rico** — Design ([GitHub](https://github.com/ricoththth))
- **Angie Alpízar Porras** — Design & frontend ([GitHub](https://github.com/Ansllxs))

Built on the [Model Context Protocol](https://modelcontextprotocol.io/), [x402](https://x402.org/), [Stellar](https://stellar.org) and [Trustless Work](https://www.trustlesswork.com).
