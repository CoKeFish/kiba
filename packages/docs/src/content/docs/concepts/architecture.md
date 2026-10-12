---
title: Architecture
description: The components of the Kiba platform and how they talk to each other.
sidebar:
  order: 5
---

Kiba is a set of small services around one on-chain registry. Components are named by **what they are**, not by who uses them.

```
 Assistants (Claude, ChatGPT, Cursor, Claude Code)           Apps and agents
          │  MCP over HTTP + OAuth 2.0                              │  kiba-sdk
          ▼                                                        ▼
 ┌─────────────────┐   search    ┌─────────────────┐     x402 (USDC escrow)
 │ Gateway         │ ──────────▶ │ Discovery       │              │
 │ api.kiba.tools  │             │ data.kiba.tools │              │
 │ auth, credits,  │             │ FTS + vectors   │              │
 │ signed calls,   │             └────────┬────────┘              │
 │ settlement      │                      │ indexes               │
 └───┬─────────┬───┘                      ▼                       ▼
     │         │ batched settle  ┌─────────────────┐    ┌───────────────────┐
     │         └────────────────▶│ Trustless Work  │    │ Registry contract │
     │ signed call               │ escrow (USDC)   │    │ (Soroban)         │
     ▼                           └─────────────────┘    └─────────▲─────────┘
 ┌─────────────────┐                                              │ register
 │ Service         │ ─────────────────────────────────────────────┘
 │ (kiba-sdk)      │
 └─────────────────┘
```

## Components

| Component | Role | Public host |
| --- | --- | --- |
| Gateway | OAuth 2.0 server, remote MCP endpoint, credits ledger, user wallets, calls on behalf of users, publisher ledger and batched settlement | `api.kiba.tools` |
| Discovery backend | Indexes the registry contract and serves hybrid search | `data.kiba.tools` |
| Dashboard | Web app for users and publishers | `app.kiba.tools` |
| Landing | Marketing site | `kiba.tools` |
| MCP adapter (`kiba-mcp`) | Local stdio bridge for clients that cannot use a remote connector | npm |
| SDK (`kiba-sdk`) | Library to publish or consume services | npm |
| Registry contract | Soroban contract with one entry per service | Stellar testnet |
| Trustless Work | Escrow and 95/5 split in USDC | external |

## Integration channels

| | MCP connector | Gateway REST API | SDK |
| --- | --- | --- | --- |
| Packaging | URL, or `npx kiba-mcp` | HTTPS | npm `kiba-sdk` |
| Wallet | Managed by the gateway | Managed by the gateway | Your own keypair |
| Auth | OAuth 2.0 with PKCE | API key or OAuth bearer | Stellar keypair |
| Billing | USD credits | USD credits | USDC escrow per call |
| Typical latency | ~200 ms | ~200 ms | 15 to 150 s |

The same `/v1/*` endpoints serve the dashboard (session cookie), the connectors (OAuth bearer), and scripts (API key bearer).

The full internal architecture, with data models and sequence diagrams, lives in the repository under `docs/architecture.md`.
