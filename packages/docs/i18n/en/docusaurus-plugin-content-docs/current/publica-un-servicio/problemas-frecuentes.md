---
title: "Common publishing issues"
sidebar_label: "Common issues"
description: "Typical errors when publishing a service and how to fix them."
---

# Common publishing issues

| Symptom | Cause and fix |
|---|---|
| **`degraded mode` / refuses to serve** | `contractId` wasn't resolved. Pass it or set `STELLAR_CONTRACT_ID`. Only for local demos without a chain: `allowUnverified: true`. |
| **`ConfigError: … platformAddress`** | <TW /> You set a Trustless Work `apiKey` without `platformAddress`. Provide a funded `G…` address. |
| **`escrow receiver does not match`** | The caller funded an escrow for another service. The SDK correctly rejects cross-service reuse. |
| **Unfunded mainnet account** | There's no friendbot on mainnet. Fund the account and set up its USDC trustline before `bootstrap()`. |
| **Signed calls rejected** | Confirm that `platform.publicKey` matches the gateway's published key and that your clock is within ~2 minutes of real time. |
| **The service doesn't show up in search** | Check that `bootstrap()` finished without errors and that the registration appears in the [contract](/stellar/contrato-de-registro). Indexing happens within moments of the event. |
| **There are calls but nothing has settled yet** | Payouts are batched and periodic. Check **Payouts** in the dashboard. The payout goes to the account that owns the registration (see [Publisher panel](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero)). |

Is your issue about connecting or about calls as a user? See [FAQ and troubleshooting](/recursos/faq).
