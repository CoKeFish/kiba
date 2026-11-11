---
title: "Payments and settlement"
description: "The x402 pattern, the two payment paths, the 95/5 split and batch settlement."
---

# Payments and settlement

Kiba uses the **x402** pattern: an HTTP request gets `402 Payment Required` with a quote, the caller pays and retries with proof of payment. The split scales with the quoted amount, so dynamic pricing works with no extra setup.

## Two payment paths

| Path | Who uses it | Speed | Trust |
|---|---|---|---|
| **Platform-signed** (via gateway) | Assistants and dashboard users paying with credits | Hundreds of ms (~170 ms measured on testnet) | The service verifies the platform's signature; earnings settle in batches |
| **Direct x402 escrow** | SDK clients paying from their own wallet | 15 to 150 s | Fully trustless, on-chain |

### Platform-signed call

1. The gateway debits the user's credits.
2. It calls the service with a short signed certificate: service name, payload hash, timestamp and nonce. The service verifies the signature with the platform's **public** key; no shared secret ever travels.
3. The service responds. The gateway records the earning in the publisher's ledger. If the service fails, the debit is refunded.
4. <TW /> When the week closes, what each service earned goes into a **Trustless Work escrow** in the publisher's name, for the exact amount.
5. Once the holding period ends, the escrow is **released** to the publisher's wallet; Trustless Work applies the platform fee on release.

### Holding period and claims

Earnings are always held for a period before they are paid. The period depends on how much the publisher is trusted:

| Publisher | Holding period |
|---|---|
| New | 14 days |
| Verified | 3 days |
| Trusted | 1 day |

While the earning from a call has not been released, the user can **claim** it from their history, explaining what happened. A Kiba administrator reviews the claim and rejects it or refunds all or part of it. The refund goes back the way it was paid: to credits or to the deposit.

- With an open claim, that service's hold is not released.
- If there were refunds, the escrow is closed with a split: the publisher gets their share and Kiba gets back what it already refunded to the user.
- The publisher sees each hold, its release date and its escrow under **Payouts**.

Calls with a [licence](/conceptos/licencias) are paid right away: their on-chain payment is the proof of the licence.

### Direct escrow call (SDK) {/* #llamada-con-escrow-directo-sdk */}

The client opens and funds a single-release escrow naming the service as receiver, calls the service with the escrow id in the `X-PAYMENT` header, and the service releases the funds after serving. **Each escrow is served only once.**

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Service
    participant E as Escrow (Trustless Work, Stellar)

    C->>A: POST /service { payload }
    A-->>C: 402 Payment Required { amount, payTo, nonce }
    C->>E: open and fund escrow (USDC)
    E-->>C: escrow funded
    C->>A: POST /service + X-PAYMENT
    A->>E: verify escrow
    A->>A: run handler
    A-->>C: 200 OK { result }
    A->>E: release (in the background)
    E->>A: 95 % to the owner, 5 % to the treasury
```

<TW /> In the diagram, the escrow is Trustless Work today.

## The 95/5 split

`platformFee = 5` (equivalent to 500 bps): for every call, **95 % goes to the service owner and 5 % to the Kiba treasury**.

## Batch settlement (gateway) {/* #liquidación-por-lotes-gateway */}

- **Minimum payout:** 1 USDC by default (`SETTLEMENT_MIN_PAYOUT`, 10,000,000 base units), to avoid dust.
- **Automatic settlement (cron):** only runs for services whose owner opted in; the rest settle on demand with [`POST /v1/publisher/settle`](/api/endpoints#publisher).
- **No double payouts:** the claim tags rows with a `settlement_id` before paying on-chain. Concurrent calls aren't settled twice and a failed payout frees the rows for retry.
- **Kill switch:** `SETTLE_SWEEP=0` falls back to classic settlement.

## What the publisher sees

Earnings and settlements show up in the [dashboard panel](/publica-un-servicio/panel-de-publisher) and in `GET /v1/publisher/{overview,settlements,analytics}`, always **net** of fees. The payout reaches the Stellar account that **owns the on-chain registration**.
