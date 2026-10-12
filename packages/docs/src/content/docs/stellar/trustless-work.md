---
title: Trustless Work
description: Kiba settles payments through Trustless Work, an escrow-as-a-service on Stellar. How the integration works.
sidebar:
  order: 4
---

[Trustless Work](https://www.trustlesswork.com) is a non-custodial escrow service on Stellar and Soroban. Kiba uses it for the escrow and the revenue split of every payment, in USDC, instead of a payment contract of its own. The Kiba contract keeps only the [registry](/stellar/registry-contract/).

## How Trustless Work works

A REST API (`https://dev.api.trustlesswork.com` on testnet, `https://api.trustlesswork.com` on mainnet) authenticated with an `x-api-key` header. The pattern is:

1. `POST` to an endpoint returns an **unsigned transaction** (XDR).
2. The caller **signs** it locally with its Stellar keypair.
3. `POST /helper/send-transaction` with the signed XDR submits it to the network.

Trustless Work **deploys one contract per escrow**, so an escrow is identified by its `contractId`. The SDK calls this the `escrowId`. It travels in the `X-PAYMENT` header and is what a provider verifies and releases.

## Role mapping

| Trustless Work role | In Kiba |
| --- | --- |
| `serviceProvider`, `receiver`, `releaseSigner`, `approver` | the service owner (serves and releases to itself) |
| `platformAddress`, `disputeResolver` | the Kiba treasury (receives the `platformFee`, resolves disputes and refunds) |
| signer of deploy and fund | whoever pays: the treasury (credit mode) or the caller's wallet (direct mode) |

`platformFee = 5` (%) is the 95/5 split.

## Lifecycle of a direct call

```
open:     POST /deployer/single-release             → sign → send   (→ contractId)
          POST /escrow/single-release/fund-escrow   → sign → send
          (the service serves the request)
release:  POST /escrow/single-release/release-funds → sign → send
refund:   Trustless Work dispute flow, resolved by the disputeResolver
```

## Batched settlement for gateway calls

Calls through the gateway do not open an escrow each. The treasury funds a **settlement escrow per publisher and cycle** as calls happen, and periodically releases it and sweeps the remainder to the publisher's wallet. Trustless Work applies the 5 % at release.

## Configuration

```
TRUSTLESS_WORK_API_KEY=                # from the Trustless Work BackOffice dApp
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com
TRUSTLESS_WORK_PLATFORM_ADDRESS=       # treasury (platformFee + disputes)
TRUSTLESS_WORK_PLATFORM_FEE=5
TRUSTLESS_WORK_TRUSTLINE_ADDRESS=      # escrow asset issuer (testnet: USDC)
TRUSTLESS_WORK_TRUSTLINE_SYMBOL=USDC
```

Without `TRUSTLESS_WORK_API_KEY` the SDK starts with escrow disabled: registration and discovery keep working, and any escrow operation throws a clear error.

## Getting an API key

Sign in to the Trustless Work BackOffice dApp, create a profile, and generate an API key for the network you target. Trustless Work's own [documentation](https://docs.trustlesswork.com) covers the dApp and the API in depth.
