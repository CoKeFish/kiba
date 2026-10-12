---
title: Troubleshooting
description: Common errors when running a service and what they mean.
sidebar:
  order: 8
---

- **`degraded mode` / refuses to serve.** No `contractId` resolved. Pass `contractId` or set `STELLAR_CONTRACT_ID`. For a no-chain local demo only, set `allowUnverified: true`.
- **`ConfigError: … platformAddress`.** You set a Trustless Work `apiKey` but no `platformAddress`. Provide a funded `G…` address.
- **`escrow receiver does not match`.** The caller funded an escrow for a different service. The SDK is correctly refusing a cross-service reuse.
- **Mainnet account not funded.** There is no friendbot on mainnet. Fund the account and set its USDC trustline before `bootstrap()`.
- **Platform-signed calls rejected.** Confirm `platform.publicKey` matches the gateway's published key and that your host clock is within about two minutes of real time.
- **Service not in search results.** Check that `bootstrap()` completed without error and that the registration appears on the [registry contract](/stellar/registry-contract/). Indexing happens within moments of the on-chain event.
- **Calls succeed but nothing is settled yet.** Settlements are batched and run periodically. Check **Payouts** in the dashboard. Payouts go to the account that owns the registration; see [Publisher dashboard](/publish/dashboard/).

See [SDK configuration](/sdk/configuration/) for every option.
