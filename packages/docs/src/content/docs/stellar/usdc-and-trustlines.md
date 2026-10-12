---
title: USDC and trustlines
description: Why a Stellar account needs a USDC trustline and how Kiba sets it up.
sidebar:
  order: 2
---

On Stellar, an account can hold an asset other than XLM only after it opens a **trustline** to that asset's issuer. Kiba settles in **USDC**, so every account that receives or spends USDC needs the trustline:

- **Service accounts** get it during `bootstrap()`.
- **User wallets** on the gateway get it when they are provisioned.
- **SDK clients** paying directly get it during `bootstrap()` and must then be funded with USDC.

A trustline raises the account's minimum XLM reserve by 0.5 XLM. On testnet friendbot covers it; on mainnet fund the account first.

## Issuers

| Network | USDC issuer |
| --- | --- |
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle) |
| Mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (Circle) |

## Funding a user wallet

A user's Kiba wallet is a plain Stellar account. To fund it, send USDC to the address shown in the dashboard. Funding the wallet does not add credits; see [Credits and wallet](/concepts/credits-and-wallet/).
