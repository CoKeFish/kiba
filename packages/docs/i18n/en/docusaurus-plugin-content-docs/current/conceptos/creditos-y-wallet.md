---
title: "Credits and wallet"
description: "The two balances of a Kiba account: off-chain credits and an on-chain wallet."
---

# Credits and wallet

Every gateway account has **two separate balances**, easy to confuse.

:::warning[They don't mix]
Funding the wallet does **not** add credits, and topping up credits doesn't move USDC to your wallet. They are independent.
:::

## Credits (off-chain)

A USD balance in the gateway ledger. It's what an assistant spends when it calls a service.

- New accounts start with **5 USD** in credit (testnet).
- Top up from the dashboard's **Billing** page or with [`POST /v1/topup`](/api/endpoints#cuenta).
- Spending is instant and off-chain: it's debited in milliseconds.
- `get_balance` and `GET /v1/balance` report it as `balance_usd`.
- The dashboard shows credits in **Kibix** (10,000 Kibix = 1 USD); the API returns USD and base units.

## Wallet (on-chain)

Every account gets a Stellar wallet. When Privy is configured, it's provisioned as a **non-custodial** server wallet: the key lives in Privy's secure enclave (TEE) and the gateway only requests signatures (`raw_sign`). Its public address shows in the dashboard and in `GET /v1/me` (`custodial_wallet` field).

- It holds **USDC** on Stellar; the gateway sets up the [trustline](/stellar/usdc-y-trustlines).
- To fund it, send USDC to its address: it's a regular Stellar account, no memo.

## Which one pays a call {/* #cuál-paga-una-llamada */}

| Situation | Who pays | `paidWith` |
|---|---|---|
| Enough credit | The treasury signs and pays on-chain; the user's wallet isn't touched (a single charge) | `credit` |
| No credit | The wallet pays directly with the full on-chain escrow; slower (a single charge) | `wallet` |

Publishers get paid **on-chain**, not in credits.

## Top-up methods

All in sandbox/test. Selected with `PAYMENT_PROVIDER`; the default is `bre-b-sandbox`.

| Method | Details |
|---|---|
| Stripe | Card |
| PayPal | PayPal account |
| Wompi | Colombian PSP |
| Bre-B | QR or key, manual confirmation |
| USDC deposit on Stellar | Memo detection via Horizon |
