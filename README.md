<div align="center">

<img src="packages/landing/public/logo.png" alt="Kiba" width="200" />

# Kiba

### Your AI assistant, now with a wallet.

Kiba lets any AI assistant find specialized services and pay for them on the spot —
per use, in the same conversation. No sign-ups. No API keys. No subscriptions.

**[Get started free →](https://app.kiba.tools)**

[Website](https://kiba.tools) · [Docs](https://docs.kiba.tools) · [Publish your service](packages/sdk/README.md)

[![MCP](https://img.shields.io/badge/MCP-compatible-14F195?style=flat-square)](https://modelcontextprotocol.io/)
[![x402](https://img.shields.io/badge/x402-payments-2060F6?style=flat-square)](https://x402.org/)
[![Stellar](https://img.shields.io/badge/built%20on-Stellar-000000?style=flat-square&logo=stellar&logoColor=white)](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
[![npm: kiba-mcp](https://img.shields.io/npm/v/kiba-mcp?style=flat-square&logo=npm&label=kiba-mcp&color=CB3837)](https://www.npmjs.com/package/kiba-mcp)
[![npm: kiba-sdk](https://img.shields.io/npm/v/kiba-sdk?style=flat-square&logo=npm&label=kiba-sdk&color=CB3837)](https://www.npmjs.com/package/kiba-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## Ask. Your assistant handles the rest.

> **You:** Make me a 30-second lo-fi track for my video intro.
>
> **Assistant:** Found *music-generator* on Kiba — $0.05 for this. Paid. Here's your track. 🎵

That's it. Your assistant discovers the right service, checks the price, pays, and brings back the result. You just ask.

## One connection. Every specialist.

The best answers rarely come from a general-purpose model alone. They come from specialists — a scraper that can read any site, a 3D generator, a composer, a live data feed. Until now, each one meant another account, another key, another monthly plan.

**Kiba turns all of them into one tap away.**

| | Before | With Kiba |
|---|---|---|
| **Using a service** | Create an account, copy a key, pay a subscription | Just ask your assistant |
| **Paying** | A plan per service, used or not | Pay only for what you use, per call |
| **Selling a service** | Build billing, accounts and a storefront first | Publish once, get paid from day one |

---

## Built for people who use AI

- 🧠 **Works with the assistant you already love** — Claude, ChatGPT, Cursor and every MCP-compatible client. Install in one click on Windows, or one line anywhere else.
- 💳 **One balance, endless services** — top up once and your assistant pays as it goes. Every call, with its price, in your history.
- 🔐 **A wallet that's truly yours** — your payments wallet is controlled by you, not by us. Sign one spending permission and your assistant pays without interrupting you. Top up, withdraw or revoke anytime.
- 🎁 **Free credits to start** — explore the catalog before adding a cent.
- ⚡ **Instant** — paid calls come back in a fraction of a second.

## Built for people who build

- 🚀 **Publish once, earn per call** — wrap your API, model or tool with the open SDK, set your price, and every connected assistant can find and pay you.
- 💸 **Get paid in USDC** — keep **95%** of every call. Payouts settle on-chain, transparently.
- 🧮 **Price it your way** — flat per call, or computed from each request: per page, per character, per second of audio.
- 🛡️ **Verified, paid traffic** — every call arrives signed by Kiba, so you serve only paid requests, with no shared secrets to leak.
- 📊 **Your numbers, live** — calls, earnings and payouts per service in your publisher dashboard.

## Built for developers

- **[`kiba-mcp`](https://www.npmjs.com/package/kiba-mcp)** — the connector for AI assistants, with OAuth sign-in. Your assistant never touches a key.
- **[`kiba-sdk`](https://www.npmjs.com/package/kiba-sdk)** — open SDK to publish services or call them from your own app and wallet.
- **REST API** — the same catalog and payments for any app, assistant or not.
- **Smart discovery** — keyword and semantic search combined, so a plain-language request lands on the right service.

---

## Featured services

| | Service | What it does |
|---|---|---|
| 🕸️ | **web-scraper** | Reads any web page — even JavaScript-heavy sites — powered by Firecrawl |
| 🧊 | **3d-generator** | Turns a sentence into a downloadable 3D model, powered by Meshy |
| 🎵 | **music-generator** | Composes songs and clips from a prompt, powered by Google Lyria |
| 🖼️ | **media-catalog** | Licensed photos and music clips from an independent creator — every download comes with a license whose fingerprint travels in the Stellar payment |
| 🌍 | **world-clock** | Live time and time zones for any city on Earth |
| 🎲 | **randomizer** | Cryptographically secure random numbers, dice, draws and shuffles |

…and a growing catalog. **[Add yours →](packages/sdk/README.md)**

---

## How it works

```mermaid
sequenceDiagram
    participant U as You
    participant AI as Your assistant
    participant K as Kiba
    participant S as Service

    U->>AI: "Scrape this page and summarize it"
    AI->>K: Find the right service
    K-->>AI: web-scraper · price for this request
    AI->>K: Call it
    K->>S: Signed, paid request
    S-->>K: Result
    K-->>AI: Result + receipt
    AI-->>U: Your answer
    Note over K,S: Publishers are paid in USDC on Stellar
```

1. **Discover** — every service lives in an open on-chain registry: publish it and it's in the catalog.
2. **Quote** — the service prices this exact request.
3. **Pay** — from your credits or your payments wallet, instantly.
4. **Settle** — publisher earnings are paid out in USDC through [Trustless Work](https://www.trustlesswork.com) escrows, with the split enforced on-chain.

Go deeper: [architecture](docs/architecture.md) · [settlement](docs/trustless-work.md)

## Safe by design

- **Spending limits built in** — pending usage on your wallet is capped and collected automatically.
- **Never charged twice** — every collection is recorded, reconciled and verifiable.
- **Leave anytime** — withdraw your full balance or revoke the permission in one click.
- **No keys in the chat** — sign-in by OAuth; your assistant never sees a secret.
- **Fully auditable** — every payout is a public transaction on [stellar.expert](https://stellar.expert/explorer/testnet).

---

## Licensed media

Buy a photo, a music clip or a 3D model through your assistant and you get more than a file: every paid download comes with a **license you can prove**.

- **The payment is the proof.** Each purchase writes a plain license document (buyer, seller, file SHA-256, terms, price). The Stellar transaction that pays for the call carries the document's fingerprint in the payments contract's `reference` argument. Anyone can download the document, hash it and compare it with the transaction. No certificate, no token, no signature to trust.
- **Terms people understand.** Three templates (`personal`, `commercial`, `commercial-attribution`) with media-industry uses (advertising, social media, broadcast, print, merchandise, editorial, web), adjustable per item. AI-generated media says so: non-exclusive, not unique.
- **Search across every catalog for free.** `search_media("lofi beat")` asks all publisher catalogs at once; buying is one `call_agent(service, { assetId })`.
- **Publish a catalog in ten minutes.** A folder plus an `items.csv`, or your own S3, database or feed behind a four-function interface. Kiba never connects to your data.

Read more: [media licenses](https://docs.kiba.tools/licencias) · [SDK: catalogs](packages/sdk/README.md#media-licenses-and-catalogs)

---

## Built at HackMeridian 2026 (Lisbon, 25-26 October)

Kiba entered the **Scale** track with a product already in production. Everything below was built during the event, in the [`hackmeridian-2026`](https://github.com/CoKeFish/kiba/commits/hackmeridian-2026) branch with timestamped commits:

- **Licensed media.** A license document per purchased file, its fingerprint carried by the Stellar payment, public verification (`/verify/<id>`) and a license card in the dashboard.
- **Catalogs in the SDK.** `MediaCatalogProvider` + `FolderSource` (folder + CSV, free public search, per-item prices, signed download links) and the `media-catalog` service.
- **Federated search.** `search_media` in the MCP connector and the REST API.
- **Docs** on licenses in ES/EN/PT.

Goals were declared in the submission form on Sunday at 13:00 WET, before the first commit.

---

## Team

Made in Bogotá, Colombia 🇨🇴

- **Rodion Tabares** — Engineering ([GitHub](https://github.com/CoKeFish))
- **André Landinez** — Engineering ([GitHub](https://github.com/andreMD287))
- **Lizeth Rico** — Design ([GitHub](https://github.com/ricoththth))
- **Angie Alpízar Porras** — Design & frontend ([GitHub](https://github.com/Ansllxs))

Built on the [Model Context Protocol](https://modelcontextprotocol.io/), [x402](https://x402.org/), [Stellar](https://stellar.org) and [Trustless Work](https://www.trustlesswork.com).

## License

[MIT](LICENSE)
