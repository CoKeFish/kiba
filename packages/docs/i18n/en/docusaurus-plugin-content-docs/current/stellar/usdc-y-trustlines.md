---
title: "USDC and trustlines"
description: "Why every account that receives or spends USDC on Kiba needs a trustline."
---

# USDC and trustlines

On Stellar, an account can hold an asset other than XLM only after opening a **trustline** to the issuer. Kiba settles in **USDC**, so every account that receives or spends USDC needs one:

| Account | When it gets the trustline |
|---|---|
| Service accounts | In `bootstrap()` |
| Gateway user wallets | When provisioned |
| SDK clients paying directly | In `bootstrap()`; then they must be funded with USDC |

:::info[Minimum reserve]
A trustline raises the account's minimum XLM reserve by **0.5 XLM**. On testnet friendbot covers it; on mainnet fund the account first.
:::

## USDC issuers

| Network | USDC issuer (Circle) |
|---|---|
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

## Funding your Kiba wallet

A user's Kiba wallet is a regular Stellar account: to fund it, send USDC to the address shown in the dashboard. **It doesn't add credits.** See [Credits and wallet](/conceptos/creditos-y-wallet).
