---
title: "Testnet"
description: "Stellar testnet network values, test funds, explorer and resets."
---

# Testnet

Kiba runs on **Stellar testnet** today: the public gateway, the catalog and the demo services point there. Testnet funds have no value, which makes it a safe place to try the full flow.

| Setting | Value |
|---|---|
| Network passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Registry contract | [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF) |
| USDC issuer (Circle, testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| <TW /> Trustless Work API | `https://dev.api.trustlesswork.com` |

## Platform values {/* #valores-de-plataforma */}

Two values belong to the public gateway and only publishers need them:

| Variable | What it is |
|---|---|
| `KIBA_PLATFORM_PUBLIC_KEY` | Platform public key, to accept signed calls |
| `KIBA_PLATFORM_ADDRESS` | Address of the treasury that receives the fee in escrows |

Both are public keys and safe to share. Ask the team for them over [Discord or email](/recursos/soporte#valores-de-plataforma-para-publishers).

## Getting testnet funds

- **XLM:** friendbot funds any new account (the SDK calls it in `bootstrap()`).
- **USDC:** the [Circle faucet](https://faucet.circle.com) issues test USDC on Stellar to an account that already has the [trustline](/stellar/usdc-y-trustlines).

## Explorer

[stellar.expert](https://stellar.expert/explorer/testnet) shows accounts, contracts and transactions; the links Kiba returns with each call point there.

## Resets

:::warning[The SDF resets testnet periodically]
After a reset, accounts and registry must be recreated: Kiba redeploys the contract and services run `bootstrap()` again.
:::
