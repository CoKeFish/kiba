---
title: "Project status"
description: "What works today on testnet, what is a demo or mock, and what is out of scope."
---

# Project status

Kiba is a **technical demo on Stellar testnet**, not a launched commercial product. It has no third-party users and moves no real funds. Everything described in these docs works end to end on testnet.

## Works today (testnet)

- All services start with `docker compose up`.
- On-chain service registry (Soroban), hybrid discovery (FTS5 + embeddings) and dashboard.
- Off-chain per-call payment (~170 ms, measured on testnet) + batch settlement in USDC with a 95/5 split, verified on-chain on testnet.
- The MCP adapter completes the OAuth 2.0 PKCE flow against the gateway; there is also a remote connector (`/mcp`).
- Non-custodial user wallets via Privy (when configured) and credits, cascading to on-chain USDC.
- Published npm packages (`kiba-sdk`, `kiba-mcp`) and a one-click desktop installer for Windows.

## Mocks and stubs in the repo {/* #mocks-y-stubs-dentro-del-repo */}

Of the 8 demo services, **3 are real** and 5 return simulated responses. The contract treats them like any other registered service.

| Service | Status | Details |
|---|---|---|
| `web-scraper` | **Real** | Firecrawl: dynamic, JS-rendered content |
| `world-clock` | **Real** | Real time zones with `Intl`, no external API |
| `randomizer` | **Real** | Cryptographic randomness with `node:crypto` |
| `yield-hunter` | Mock | Simulated response |
| `risk-auditor` | Mock | Simulated response |
| `translator-pro` | Mock | Simulated response |
| `price-oracle` | Mock | Simulated response |
| `code-reviewer` | Mock | Simulated response |

:::note[Top-ups in sandbox]
Fiat → credit top-ups run in **sandbox/test mode** (Stripe test, PayPal sandbox, Wompi sandbox, Bre-B sandbox). There are no real charges.
:::

## Out of scope for now

- Third-party publishers and external users at scale.
- Mainnet.
- Formal contract audit.
- Regulatory work for custodial operation (KYC/AML).
- Long-term operational reliability (SLA).

What comes next is in the [roadmap](/recursos/hoja-de-ruta).
