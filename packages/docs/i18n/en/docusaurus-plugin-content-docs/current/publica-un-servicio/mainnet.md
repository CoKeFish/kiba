---
title: "Going to mainnet"
description: "What changes between testnet and mainnet for a service published with the SDK."
---

# Going to mainnet

:::warning[Kiba runs on testnet today]
This section describes what the SDK supports so you can get ready. The public gateway and catalog are **testnet only** until the mainnet launch.
:::

| Item | Testnet | Mainnet |
|---|---|---|
| `network` | `testnet` (default) | `mainnet` |
| Funding the service account | Automatic with friendbot | You fund it with XLM (reserve + fees) |
| USDC trustline | Set up by `bootstrap()` | Before `bootstrap()`, with the [mainnet USDC issuer](/stellar/usdc-y-trustlines) |
| <TW /> Trustless Work | `https://dev.api.trustlesswork.com`, testnet API key | `https://api.trustlesswork.com`, mainnet API key |
| Registry contract | Testnet id | Mainnet id, published at launch |
| RPC | `https://soroban-testnet.stellar.org` | A Soroban RPC provider; public endpoints are rate-limited |

Two instances on different networks can live in one process (a testnet client and a mainnet client, each with its own configuration). See [SDK configuration](/sdk/configuracion).
