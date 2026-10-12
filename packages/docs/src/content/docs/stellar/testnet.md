---
title: Testnet
description: Kiba runs on Stellar testnet. Public values, faucets, and explorers.
sidebar:
  order: 1
---

Kiba runs on **Stellar testnet** today: the public gateway, the catalog, and the demo services all point at it. Testnet funds have no value, which makes it a safe place to try the whole flow end to end.

## Public values

| Setting | Value |
| --- | --- |
| Network passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Registry contract | [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF) |
| USDC issuer (Circle, testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Trustless Work API | `https://dev.api.trustlesswork.com` |

## Platform values

Two more values belong to the public gateway and are needed only by publishers: the **platform public key** (`KIBA_PLATFORM_PUBLIC_KEY`, to accept platform-signed calls) and the **platform address** (`KIBA_PLATFORM_ADDRESS`, the treasury that receives the fee on escrows). Both are public keys and safe to share. Ask the marketplace operator, or read them from the deployment you connect to.

## Getting testnet funds

- **XLM**: friendbot funds any new account with test XLM. The SDK calls it for you during `bootstrap()`.
- **USDC**: Circle's [testnet faucet](https://faucet.circle.com) issues test USDC on Stellar to an account that already has the trustline. See [USDC and trustlines](/stellar/usdc-and-trustlines/).

## Explorers

[stellar.expert](https://stellar.expert/explorer/testnet) shows accounts, contracts, and transactions. The explorer links that Kiba returns with each call point there.

## Resets

Stellar testnet is reset periodically by the Stellar Development Foundation. After a reset, accounts and the registry must be re-created: Kiba redeploys the contract and services re-run `bootstrap()`.
