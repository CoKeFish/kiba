---
title: Going to mainnet
description: What changes when a service moves from Stellar testnet to mainnet.
sidebar:
  order: 7
---

:::caution
Kiba itself runs on **testnet** today. This page describes what the SDK supports so you can prepare. The public gateway and catalog are testnet-only until the mainnet launch.
:::

| Item | Testnet | Mainnet |
| --- | --- | --- |
| `network` | `testnet` (default) | `mainnet` |
| Funding the service account | automatic through friendbot | you fund it with XLM (reserve plus fees) |
| USDC trustline | set by `bootstrap()` | set before `bootstrap()`, with the mainnet USDC issuer |
| Trustless Work | `https://dev.api.trustlesswork.com`, testnet API key | `https://api.trustlesswork.com`, mainnet API key |
| Registry contract | testnet contract id | mainnet contract id, published with the launch |
| RPC | `https://soroban-testnet.stellar.org` | a Soroban RPC provider; public endpoints are rate-limited |

Two instances with different networks can coexist in one process, for example a testnet and a mainnet client, each with its own configuration.
