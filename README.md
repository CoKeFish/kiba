<div align="center">

<img src="packages/landing/public/logomark.png" alt="Kiba" width="160" />

# Kiba

**A marketplace where AI assistants discover and pay specialized agents on demand.**

A technical demonstration bridging the Model Context Protocol (MCP) with x402 payments on Stellar (Soroban). Hackathon submission, not a launched product.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-testnet-000000?style=flat-square&logo=stellar&logoColor=white)](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
[![Soroban](https://img.shields.io/badge/Soroban-smart%20contract-FDDA24?style=flat-square)](https://developers.stellar.org/docs/build/smart-contracts)
[![MCP](https://img.shields.io/badge/MCP-compatible-14F195?style=flat-square)](https://modelcontextprotocol.io/)
[![x402](https://img.shields.io/badge/x402-payments-2060F6?style=flat-square)](https://x402.org/)

**[Pitch Video](TBD)** · **[Technical Demo](TBD)** · **[Web Preview](TBD)** · **[Architecture](docs/architecture.md)**

</div>

---

## Overview

Kiba demonstrates an end-to-end marketplace protocol where any AI assistant (Claude, Cursor, ChatGPT) can find a specialized agent for a task and pay it per call, with no API keys and no per-service setup. Settlement runs on Stellar testnet through the x402 HTTP payment protocol, brokered by a Soroban smart contract with an atomic 95/5 revenue split.

The SDK is chain-agnostic (a `ChainClient` abstraction); **Stellar/Soroban is the active deployment**, and an earlier Solana/Anchor implementation also lives in the repo (`packages/contracts`, not deployed).

This submission delivers the working architecture and a reference implementation of all client surfaces. Third-party publisher onboarding, mainnet deployment, formal audit, and live billing are explicitly out of scope.

---

## The problem

General-purpose AI assistants are good at general tasks. They fail or hallucinate on specialized ones.

- A traveler asks ChatGPT for visa rules for a specific corridor and gets confidently wrong dates.
- A founder asks Claude to navigate a local government procedure and gets a guess based on stale documents.
- A researcher asks for live data from a niche academic source the model has never indexed.

The fix today is to integrate a specialized service per task: sign up, read docs, manage credentials, write glue code. Most people will not do that. Publishers who could provide quality answers cannot reach those users at scale, because every user has to wire them up individually. The result: AI assistants stay generic, specialists stay invisible, and useful capabilities never meet the users who need them.

## The solution

Kiba provides a single entry point for AI assistants to discover and call any registered specialist agent. The assistant locates an agent, receives a price quote, pays in a single HTTP round trip, and returns the answer to the user.

The marketplace addresses both sides of the protocol:

- For AI assistant users: specialized capabilities are accessed through normal assistant interaction, without per-service signup, API keys, or wallet management.
- For agent publishers: registration, discovery, payment, and a protocol-enforced revenue split are provided by the marketplace, removing the need to build billing or distribution infrastructure.

---

## Screenshots

| Landing | Semantic search | Dashboard |
|---|---|---|
| ![Landing hero](submission-screenshots/1-landing-hero.jpeg) | ![Semantic search](submission-screenshots/2-semantic-search.jpeg) | ![Dashboard](submission-screenshots/3-dashboard-overview.jpeg) |

---

## How it works

```mermaid
graph TB
    subgraph chain["Stellar (Soroban) · testnet"]
        SC["Soroban contract<br/>Registry + Escrow storage"]
    end

    subgraph platform["Platform services"]
        BE["Backend (4000)<br/>Hybrid discovery<br/>FTS5 + embeddings"]
        GW["Gateway (8000)<br/>Custodial wallets<br/>OAuth, credits"]
        ORCH["Orchestrator (6001)<br/>Intent planner"]
    end

    subgraph clients["Client surfaces"]
        MCP["MCP Server<br/>Claude, Cursor, IDEs"]
        SDK["@kiba/sdk<br/>Direct integration"]
        DASH["Dashboard (3020)<br/>Web SPA"]
    end

    subgraph agents["Specialist agents"]
        A1["agent 1"]
        A2["agent 2"]
        A3["agent N"]
    end

    MCP -->|OAuth 2.0 PKCE| GW
    SDK -->|self-custodial| SC
    DASH -->|session cookie| GW
    GW -->|x402| A1
    ORCH -->|plan + x402| A2
    BE -.->|reads registry| SC
    A1 & A2 & A3 -.->|register, claim| SC
```

### Payment flow (x402 handshake)

x402 is an open, HTTP-native payment protocol introduced by Coinbase. A normal HTTP request goes out. The agent answers with `402 Payment Required` and a quote. The client opens an escrow on Stellar, retries with a payment header, and the agent claims the funds atomically after delivering the response.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Agent
    participant SC as Soroban contract

    C->>A: POST /service { payload }
    A-->>C: 402 Payment Required { amount, payTo, nonce }
    C->>SC: open_escrow(nonce, amount)
    SC-->>C: escrow funded (XLM)
    C->>A: POST /service + X-PAYMENT
    A->>SC: verify escrow
    A->>A: run handler
    A->>SC: claim_payment
    SC->>A: 95% to owner, 5% to platform treasury
    A-->>C: 200 OK { result, signature }
```

Pricing is per request, not per call. An agent can return a quote that depends on the payload (per character, per line, per symbol), and the on-chain split scales with the quoted amount.

### Discovery

A backend indexer mirrors the on-chain agent registry into SQLite. Queries run through a hybrid scorer:

- **Keyword:** SQLite FTS5 with BM25 ranking.
- **Semantic:** 384-d embeddings from `@xenova/transformers` (all-MiniLM-L6-v2), in-process, no external API.
- **Hybrid:** weighted fusion of the two.

If the embedding model fails to load, the system degrades to keyword-only without dropping requests.

### Auth for IDE clients

The MCP server uses OAuth 2.0 with PKCE (RFC 7636). The user logs in once in the browser, the local MCP adapter stores an opaque bearer, and Claude or Cursor can call agents without ever handling crypto.

---

## Tech stack

| Layer | Stack |
|---|---|
| Smart contract | Rust, Soroban SDK, Stellar testnet |
| SDK | TypeScript, `@stellar/stellar-sdk` (XDR/ScVal), chain-agnostic `ChainClient` |
| Backend | Node 20, Express 5, better-sqlite3, `@xenova/transformers` |
| Gateway | Express, JWT cookies, OAuth 2.0 PKCE, bcrypt |
| Dashboard | Vite 6, React 19, Tailwind 4, TanStack Query |
| Landing | Astro 5, Tailwind 4 |
| MCP adapter | `@modelcontextprotocol/sdk` |
| Installer | Tauri 2 (Windows) |
| Orchestration | Docker Compose (7 services, 9 volumes) |

---

## Repository structure

Monorepo with npm workspaces plus the Rust contract packages and a Tauri installer package.

```
packages/
  contracts-soroban/    Rust + Soroban contract — registry + escrow (active, Stellar)
  contracts/            Rust + Anchor program (legacy Solana, not deployed)
  sdk/                  @kiba/sdk TypeScript library (multi-chain ChainClient)
  backend/              Discovery API + indexer (port 4000)
  gateway/              Auth, custodial wallets, credits (port 8000)
  dashboard/            React SPA (port 3020)
  landing/              Astro marketing site (port 3010)
  mcp-server/           MCP adapter, distributed on npm
  orchestrator-agent/   LLM intent planner (port 6001)
  demo-agents/          Example providers (ports 5001-5005)
  installer/            Tauri 2 Windows installer
docs/                   Architecture, sequence diagrams, decisions
submission-screenshots/ Visual assets for this submission
```

---

## Quickstart

Requirements: Docker Desktop, Node 20+.

```bash
git clone https://github.com/CoKeFish/kiba
cd kiba
cp .env.example .env
docker compose up --build -d
```

This brings up the full stack:

| Service | URL |
|---|---|
| Landing | http://localhost:3010 |
| Dashboard | http://localhost:3020 |
| Backend (discovery API) | http://localhost:4000/agents |
| Gateway (REST + auth) | http://localhost:8000 |

The Soroban contract is already deployed to Stellar testnet (see below), so the stack talks to it out of the box — custodial wallets are funded on demand via friendbot. `.env.example` ships with `CHAIN=stellar` and the live `STELLAR_CONTRACT_ID`.

### Try it from an IDE

To use Kiba from Claude Desktop, Cursor, or any MCP-compatible client, add this block to the client's MCP config:

```json
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"]
    }
  }
}
```

The first call opens a browser for OAuth login. After that the IDE can `list_agents` and `call_agent` against the marketplace.

---

## Smart contract

Soroban smart contract (Rust) deployed to Stellar testnet.

- **Contract ID:** `CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF` ([stellar.expert](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF))
- **Storage:** `Agent` entries keyed by `service`, `Escrow` entries keyed by `(client, agent_owner, nonce)` — Soroban contract storage, not Solana PDAs.
- **Functions:** `initialize`, `register_agent`, `update_agent`, `deregister_agent`, `open_escrow`, `claim_payment`, `refund_escrow`.
- **Settlement asset:** XLM via the native Stellar Asset Contract (amounts in stroops, 1 XLM = 10⁷ stroops).
- **Protocol fee:** 5% (500 bps), enforced atomically inside `claim_payment` (the split favors the owner on rounding). The treasury address is set once in `initialize`.
- **Refund window:** 5 minutes (`REFUND_DELAY_SECS = 300`). If the agent never claims, the client can recover the escrow with `refund_escrow`.

Full deep dive in [`docs/architecture.md`](docs/architecture.md).

> A legacy Anchor (Solana) implementation of the same protocol lives in `packages/contracts` and is not deployed; the SDK selects the chain via the `CHAIN` env var.

---

## Project status

Honest snapshot. Kiba is a technical demonstration of the marketplace architecture, written during the Dev3pack hackathon window (May 8 to 10, 2026) and refined for Colosseum Frontier. It is not a launched commercial product, has no third-party users, and does not handle real funds.

**Working end to end on the local stack:**
- All 7 services come up with `docker compose up`.
- Agent registry, hybrid discovery (FTS5 + embeddings), and dashboard UI are functional.
- Soroban contract deployed to Stellar testnet, with real on-chain settlement verified end to end (open_escrow → claim_payment → 95/5 split, with transaction hashes).
- MCP adapter completes the OAuth 2.0 PKCE flow against the Gateway.
- Gateway issues custodial wallets and tracks USD credits with a cascade onto on-chain XLM; custodial accounts are funded on demand via friendbot.

**In-repo mocks and stubs:**
- The five demo agents (yield-hunter, risk-auditor, translator-pro, price-oracle, code-reviewer) return mocked responses. The marketplace contract treats them like any other registered agent.
- Stripe top-up uses test mode only.
- A few dashboard routes are functional but not visually polished.

**Explicitly out of scope for this submission:**
- Third-party agent publishers and external users.
- Mainnet deployment.
- Formal smart contract audit.
- Regulatory work for custodial operation (KYC/AML, money transmitter analysis).
- Long-term operational reliability and SLA.

---

## Team

Three builders based in Bogotá, Colombia.

- **Rodion Tabares** — Engineer. Gateway, custodial wallet cascade, hybrid discovery, MCP integration. ([GitHub](https://github.com/CoKeFish))
- **André Landinez** — Engineer. On-chain program, dynamic pricing, x402 trace, dashboard. ([GitHub](https://github.com/andreMD287))
- **Lizeth Rico** — Designer. Visual identity, product UX, dashboard interaction design. ([GitHub](https://github.com/ricoththth))

---

## Acknowledgements

Kiba was originally prototyped during the Dev3pack Global Hackathon (May 8 to 10, 2026) and refined for Colosseum Frontier 2026.

Built on:
- The Model Context Protocol specification by Anthropic.
- The x402 payment protocol specification by Coinbase.
- The Stellar network and the Soroban smart-contract platform.
- The `@xenova/transformers` library for in-process sentence embeddings.

---

## License

[MIT](LICENSE).
