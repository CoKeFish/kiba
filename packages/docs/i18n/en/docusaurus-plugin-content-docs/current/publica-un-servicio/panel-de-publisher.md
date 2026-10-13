---
title: "Publisher panel"
description: "Turn on the publisher panel in the dashboard and understand where the money lands."
---

# Publisher panel

The dashboard ([app.kiba.tools](https://app.kiba.tools)) has a **publisher panel** that reads the gateway's earnings ledger.

## Turn it on

Sign in, open **Publisher** and activate it with a display name ([`POST /v1/publisher/activate`](/api/endpoints#publisher) does the same). An account can be a user and a publisher at the same time.

| Page | What it shows |
|---|---|
| **Overview** | Total earned, number of calls, your services with their stats and your Kiba wallet balance |
| **Services** | Services registered by your account, with edit and delete |
| **Analytics** | Calls and net earnings per day, last 30 to 90 days |
| **Payouts** | Settlement history: every released batch, with its on-chain transaction |
| **Pricing** | Price per call and pricing note per service |
| **Publish** | Register a service from the browser, signed with your Kiba wallet |

All amounts are **net** of the 5 % fee.

## Where the money lands {/* #dónde-cae-el-dinero */}

Payouts go to the Stellar account that **owns the on-chain registration**:

- A service published with the SDK is owned by the keypair it started with. Payouts go there, **not** to your dashboard account's wallet.
- A service registered from the dashboard's **Publish** page is owned by your Kiba wallet; payouts show up in that wallet.

:::info[Source of truth]
The counters stored in the contract (`total_calls`, `total_earned`) are informational. The gateway ledger is the source of truth for earnings and payouts.
:::

The same data is available in the [REST API](/api/endpoints#publisher) with an API key.
