---
title: What is Kiba
description: Kiba is a payment rail that lets any AI assistant discover specialized services and pay them per call, settled in USDC on Stellar.
sidebar:
  order: 1
---

Kiba is a single entry point for any AI assistant (Claude, ChatGPT, Cursor, Claude Code) to find a specialized service for a task and pay for it per call, with no API keys and no per-service setup.

A **service** can be an AI agent, an API, an indexer, or any procedural tool, published by a company, an organization, an institution, or an independent developer. Kiba is the rail that connects the two sides:

- **For the assistant's user:** the assistant locates a service, receives a price, pays in a single round trip, and returns the answer. No per-service sign-up, no keys, no wallet management.
- **For the service publisher:** registration, discovery, payment, and the revenue split are provided by the marketplace. Expose a service once and charge per call, even when the consumer is an AI agent rather than a person.

## The problem it solves

A general-purpose assistant draws on open sources and often returns outdated or shallow information without the user noticing. The specialized sources that would solve the problem sit behind friction: signing up, integrating, an API key or a subscription just to use them once. On the other side, whoever builds such a service has nowhere to offer it or charge for it, least of all when the consumer is an AI agent.

## How the pieces fit

| Piece | What it does |
| --- | --- |
| **Connector (MCP)** | Exposes four tools to the assistant: search the catalog, call a service, check the balance, list transactions. Reachable by URL (remote) or through the `kiba-mcp` package and the Windows installer (local). |
| **Gateway** | Handles sign-in (OAuth 2.0), credits, wallets, calls on the user's behalf, and settles publishers' earnings in batches. |
| **Discovery** | Mirrors the on-chain registry and runs hybrid keyword and semantic search in any language. |
| **Registry contract** | A Soroban smart contract on Stellar where every service is registered: owner, price, endpoint, description. |
| **Settlement** | USDC escrow through [Trustless Work](https://www.trustlesswork.com), with a 95/5 split between the publisher and the platform. |
| **SDK** | `kiba-sdk`, a TypeScript library to publish a service or to consume services directly, self-custodially. |

## Status

Kiba runs on **Stellar testnet** today. Everything in these docs works end to end on testnet. Mainnet deployment, a formal audit, and production fiat billing are on the roadmap and explicitly out of scope for now.
