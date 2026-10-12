---
title: Payments and settlement
description: How a call is paid, how the publisher gets the money, and where the 95/5 split happens.
sidebar:
  order: 3
---

Kiba uses the **x402** pattern: an HTTP request is answered with `402 Payment Required` and a quote, the caller pays, then retries with proof of payment. On Kiba the escrow and the revenue split run on [Trustless Work](https://www.trustlesswork.com), an escrow-as-a-service on Stellar, in **USDC**.

## Two payment paths

| Path | Who uses it | Speed | Trust |
| --- | --- | --- | --- |
| **Platform-signed** (through the gateway) | Assistants and dashboard users paying with credits | hundreds of milliseconds | the service verifies the platform's signature; earnings settle in batches |
| **x402 escrow** (direct) | SDK clients paying from their own wallet | 15 to 150 seconds | fully trustless on-chain |

### Platform-signed calls

1. The gateway debits the user's credits.
2. It calls the service with a short signed certificate: service name, hash of the payload, timestamp, nonce. The service verifies the signature with the platform's **public** key. No shared secret is ever sent.
3. The service runs and answers. The gateway records the earning in the publisher's ledger. If the service fails, the debit is refunded.
4. The gateway funds the publisher's current **settlement escrow** on Trustless Work with the amount of the call. The response includes an explorer link to that transaction.
5. Periodically the gateway **settles** the cycle: it releases the escrow and sweeps the funds to the publisher's wallet. Trustless Work applies the platform fee at release.

### Direct escrow calls

An SDK client opens and funds a single-release escrow naming the service as receiver, calls the service with the escrow id in the `X-PAYMENT` header, and the service releases the funds after serving. Each escrow is served exactly once.

## The split

Trustless Work is configured with a **5 % platform fee**: for every call, **95 %** goes to the service owner and **5 %** to the Kiba treasury. The split scales with the quoted amount, so dynamic pricing works without extra configuration.

## What the publisher sees

Earnings and settlements appear in the dashboard's publisher panel and in `GET /v1/publisher/overview`, `/settlements`, and `/analytics`, always **net** of the fee. Payouts land in the Stellar account that **owns the on-chain registration**, which for an SDK-published service is the keypair it bootstrapped with. See [Publisher dashboard](/publish/dashboard/).
