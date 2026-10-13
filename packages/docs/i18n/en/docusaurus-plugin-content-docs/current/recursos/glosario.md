---
title: "Glossary"
description: "Terms used across the Kiba documentation."
---

# Glossary

| Term | Meaning |
|---|---|
| **Service** | Any AI agent, API, indexer or tool that answers requests for a price and is registered on Kiba. |
| **Publisher** | Whoever builds and publishes a service and charges per call. |
| **Assistant** | Claude, ChatGPT, Cursor, Claude Code or another MCP client that searches and calls services for the user. |
| **MCP (Model Context Protocol)** | Anthropic's open protocol for an assistant to use external tools. |
| **x402** | HTTP-native payment protocol (introduced by Coinbase): `402 Payment Required` with a quote, payment and retry with proof. |
| **Soroban** | Stellar's smart contract platform (Rust). |
| **Registry contract** | Soroban contract where every service is registered on-chain. |
| **USDC** | Dollar stablecoin (Circle), Kiba's settlement asset. |
| **Trustline** | A Stellar account's opt-in to hold an asset other than XLM. |
| **Base units / stroops** | Smallest unit of the settlement asset: 1 USDC = 10,000,000. |
| **Credits** | USD balance in the gateway ledger that an assistant spends. |
| **Kibix** | Display unit for credits in the dashboard: 10,000 Kibix = 1 USD. |
| **Wallet** | The user's Stellar account (on-chain), independent of credits. |
| **Treasury** | Platform account that signs credit settlements and receives the fee. |
| **Platform-signed call** | Fast, off-chain call that the service authenticates with the platform public key. |
| **x402 escrow (direct)** | Trustless payment: the client funds an escrow naming the service as receiver. |
| **Batch settlement** | Periodic payout of a publisher's accumulated earnings. |
| **Bootstrap** | `AgentProvider`/`AgentClient` step that funds the account on testnet, sets up the trustline and (provider) registers the service. |
| **Friendbot** | Testnet faucet that funds new accounts with test XLM. |
| **FTS5 / BM25** | SQLite full-text search and its relevance ranking. |
| **Embedding** | Vector (here 384 dimensions) representing a text's meaning for semantic search. |
| **PKCE** | OAuth extension that prevents the authorization code from being stolen in public clients. |
| **Anchor (Stellar)** | Entity that converts between local money and assets on Stellar (fiat ramps). |
| **Bre-B / PSE** | Colombian payment rails (instant keys / online bank debit). |
