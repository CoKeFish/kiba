---
title: "Trustless Work"
description: "Escrow and 95/5 split for every payment via Trustless Work: how it works today and its status."
---

# Trustless Work (escrow and split)

:::warning[Status: implemented today, to be replaced by Kiba's own escrows]
In October 2026 the team decided to move off Trustless Work and use **Kiba's own escrows**. While those are being built, the code still uses Trustless Work, and this page describes what it does **today**. Every place in these docs that depends on Trustless Work carries the <TW /> tag.
:::

[Trustless Work](https://www.trustlesswork.com) is a non-custodial escrow service on Stellar/Soroban (escrow-as-a-service). Kiba uses it for the escrow and revenue split of every payment, in USDC, instead of its own payments contract.

## How it works

REST API (`https://dev.api.trustlesswork.com` on testnet, `https://api.trustlesswork.com` on mainnet) authenticated with the `x-api-key` header. The pattern:

1. A `POST` returns an **unsigned transaction** (XDR).
2. The caller **signs** it locally with their Stellar keypair.
3. `POST /helper/send-transaction` with the signed XDR submits it to the network.

Trustless Work **deploys one contract per escrow**, so an escrow is identified by its `contractId` (the SDK calls it `escrowId`; it travels in the `X-PAYMENT` header).

## Role mapping

| Trustless Work role | In Kiba |
|---|---|
| `serviceProvider`, `receiver`, `releaseSigner`, `approver` | The service owner (serves and releases to itself) |
| `platformAddress`, `disputeResolver` | The Kiba treasury (receives the `platformFee`, resolves disputes and refunds) |
| Deploy and fund signer | Whoever pays: the treasury (credit mode) or the caller's wallet (direct mode) |

`platformFee = 5` (%) is the 95/5 split.

## Lifecycle of a direct call

```text
open:     POST /deployer/single-release             → sign → submit   (→ contractId)
          POST /escrow/single-release/fund-escrow   → sign → submit
          (the service handles the request)
release:  POST /escrow/single-release/release-funds → sign → submit
refund:   Trustless Work dispute flow, resolved by the disputeResolver
```

## Batch settlement for gateway calls

Gateway calls do **not** each open an escrow. The treasury funds one **settlement escrow per publisher and cycle** as calls happen and, periodically, releases it and sweeps the remainder to the publisher's wallet (`release` + `withdraw_remaining_funds`, the latter through a direct contract invocation because the Trustless Work REST API doesn't expose it). Trustless Work applies the 5 % on release.

## Configuration

```bash title=".env"
TRUSTLESS_WORK_API_KEY=                # from the Trustless Work BackOffice dApp
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com
TRUSTLESS_WORK_PLATFORM_ADDRESS=       # treasury (platformFee + disputes)
TRUSTLESS_WORK_PLATFORM_FEE=5
TRUSTLESS_WORK_TRUSTLINE_ADDRESS=      # issuer of the escrow asset (testnet: USDC)
TRUSTLESS_WORK_TRUSTLINE_SYMBOL=USDC
TRUSTLESS_WORK_FEE_ADDRESS=            # TW fee wallet (withdraw_remaining_funds)
```

:::info[Without an API key]
Without `TRUSTLESS_WORK_API_KEY` the SDK starts with escrow disabled: registry and discovery keep working, and any escrow operation throws a clear error.
:::

**Getting an API key:** Trustless Work BackOffice dApp → create a profile → generate the key for the target network. The [Trustless Work documentation](https://docs.trustlesswork.com) covers the dApp and the API in detail.
