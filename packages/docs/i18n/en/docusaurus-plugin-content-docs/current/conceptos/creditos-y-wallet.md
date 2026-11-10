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
- `GET /v1/balance` reports them as `balance_usd`.
- The API returns USD and base units. In the dashboard, amounts such as top-ups, history and usage show in **Kibix** (10,000 Kibix = 1 USD).

## Wallet (on-chain)

Every account gets a Stellar wallet. When Privy is configured, it's provisioned as a **non-custodial** server wallet: the key lives in Privy's secure enclave (TEE) and the gateway only requests signatures (`raw_sign`). Its public address shows in the dashboard and in `GET /v1/me` (`custodial_wallet` field).

- It holds **USDC** on Stellar; the gateway sets up the [trustline](/stellar/usdc-y-trustlines).
- To fund it, send USDC to its address: it's a regular Stellar account, no memo.

## Withdrawable deposit

Users who prefer to pay from their own wallet leave a **deposit** in a Stellar payment channel. The deposit stays theirs: Kiba only charges what was used, and the rest can be withdrawn whenever the user wants.

- **Deposit.** From **Billing**, the user picks an amount and signs one transaction with their wallet: the Kiba wallet with Privy, or an external one such as Freighter, xBull or Lobstr. That transaction creates their channel and moves the USDC from the wallet into it. The minimum is 1 USDC.
- **Top up.** Another transaction signed by the user adds to the deposit.
- **Pay.** Each call is deducted from the deposit instantly, with no signature and no on-chain transaction. Kiba collects the usage from the contract in batches: when the pending amount reaches 0.10 USDC or has gone ten minutes uncollected. One transaction covers every call in the batch, and the contract never pays out more than was deposited.
- **Withdraw.** Kiba collects the pending usage and the rest goes back to the user's wallet in the same transaction. The channel closes; to keep paying from the wallet, the user opens another one.
- **Withdraw without going through Kiba.** The user requests the withdrawal directly from the contract. Kiba detects it, stops accepting spending against that deposit and collects what is pending. After the channel's waiting period, about one hour, the user withdraws everything that is left.

Kiba pays the network fees for all of these transactions: the user does not need XLM.

The contract is [Stellar's one-way payment channel](https://github.com/stellar-experimental/one-way-channel), the same one MPP Session uses. There is one channel per user, created by a factory. The channel address and every movement are shown in the dashboard with a link to the explorer.

| Endpoint | What it does |
|---|---|
| `GET /v1/channel` | Deposit status: deposited, used, available and movements |
| `POST /v1/channel/open` | Prepares opening the channel with the initial deposit |
| `POST /v1/channel/topup` | Prepares a top-up |
| `POST /v1/channel/liquidate` | Withdraws: Kiba collects the usage and the rest goes back to the wallet |
| `POST /v1/channel/close-start` | Prepares the withdrawal request that does not go through Kiba |
| `POST /v1/channel/refund` | Prepares the withdrawal once the waiting period is over |

Prepared transactions are signed by the user and sent with `POST /v1/spend/submit`.

## Your balance {/* #tu-saldo */}

The dashboard (top bar and **Billing** page) and the [`get_balance`](/conecta-tu-asistente/herramientas-mcp#get_balance) tool show **a single balance in USD**: your credits plus what you can spend with your wallet, minus usage not yet charged. It's what your assistant has to pay for services.

- The dashboard truncates it instead of rounding: it never shows more than you have.
- In the API it's `total_usd` from [`GET /v1/balance`](/api/endpoints#cuenta).

## Which one pays a call {/* #cuál-paga-una-llamada */}

| Situation | Who pays | `paidWith` |
|---|---|---|
| Enough credit | The treasury signs and pays on-chain; the user's wallet isn't touched (a single charge) | `credit` |
| No credit and an open deposit | The price is deducted from the deposit instantly; Kiba collects it from the channel in batches | `wallet` |
| No credit and no deposit | The wallet pays directly with the full on-chain escrow; slower (a single charge) | `wallet` |

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
