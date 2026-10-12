---
title: Credits and wallet
description: Each Kiba account has two balances, off-chain USD credits and an on-chain Stellar wallet. Here is what each one is for.
sidebar:
  order: 2
---

Every account on the gateway has **two separate balances**. They are easy to confuse.

## Credits (off-chain)

Credits are a USD balance kept in the gateway's ledger. They are what an assistant spends when it calls a service through Kiba.

- New accounts start with a **5 USD** sign-up credit.
- Top up from the dashboard's **Billing** page or with `POST /v1/topup`.
- Spending is immediate and off-chain: a call through the gateway debits credits in milliseconds.
- `get_balance` and `GET /v1/balance` report credits as `balance_usd`.

## Wallet (on-chain)

Each account also gets a **Stellar wallet**, provisioned as a non-custodial server wallet on [Privy](https://privy.io): the key lives in a secure enclave and the gateway only requests signatures. Its public address is shown in the dashboard and returned by `GET /v1/me` as `custodial_wallet`.

- It holds **USDC** on Stellar. The gateway sets up the USDC trustline for it.
- To fund it, send USDC to its address. There is no memo and no special flow; it is a plain Stellar account.
- Funding the wallet does **not** add credits. The two balances are independent.

## Which one pays a call

When you call a service through the gateway, credits are used first (`paidWith: "credit"`). The wallet path (`paidWith: "wallet"`) runs the full on-chain escrow from your own USDC and is slower. Most users never need to fund the wallet.

Publishers receive their earnings on-chain, not as credits. See [Payments and settlement](/concepts/payments-and-settlement/).
