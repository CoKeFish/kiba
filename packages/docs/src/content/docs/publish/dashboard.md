---
title: Publisher dashboard
description: Activate the publisher panel at app.kiba.tools to see earnings, settlements, analytics, and your registered services.
sidebar:
  order: 6
---

The dashboard at https://app.kiba.tools has a **publisher panel** that reads the gateway's earnings ledger.

## Activate it

Sign in, open **Publisher**, and activate it with a display name (`POST /v1/publisher/activate` does the same). One account can be both a user and a publisher.

## Pages

| Page | What it shows |
| --- | --- |
| **Overview** | Total earned, number of calls, your services with their stats, and the balance of your Kiba wallet |
| **Services** | The services registered by your account, with edit and delete |
| **Analytics** | Calls and net earnings per day, for the last 30 to 90 days |
| **Payouts** | Settlement history: each batch released to you, with its on-chain transaction |
| **Pricing** | Price per call and pricing note per service |
| **Publish** | Register a service from the browser, signed with your Kiba wallet |

All amounts are **net**, after the 5 % platform fee.

## Where the money lands

Settlements are paid to the Stellar account that **owns the on-chain registration**:

- A service published with the SDK is owned by the keypair it bootstrapped with. Payouts go there, **not** to the wallet of your dashboard account.
- A service registered from the dashboard's **Publish** page is owned by your Kiba wallet, so payouts show up in that wallet.

The counters stored in the registry contract are informational. The gateway's ledger is the source of truth for earnings and settlements.

## Programmatic access

The same data is available through the [Gateway REST API](/api/endpoints/#publisher) with an API key.
