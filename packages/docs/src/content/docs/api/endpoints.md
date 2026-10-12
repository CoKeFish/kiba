---
title: Endpoints
description: Reference of the /v1 endpoints of the Kiba gateway, grouped by what they do.
sidebar:
  order: 3
---

Every endpoint requires a credential unless noted. See [Authentication](/api/authentication/).

## Account

### `GET /v1/me`

The signed-in account: `id`, `email`, `custodial_wallet` (its Stellar address), `is_publisher`, `publisher_name`, `created_at`, plus the balance fields below.

### `GET /v1/balance`

```json
{
  "asset": "USDC",
  "base_unit_name": "stroops",
  "balance_base_units": 48000000,
  "balance_usd": 4.8,
  "wallet_base_units": 0,
  "wallet_asset_amount": 0,
  "wallet_usd": 0,
  "total_base_units": 48000000,
  "total_asset_amount": 4.8,
  "total_usd": 4.8
}
```

`balance_*` is credits, `wallet_*` is the on-chain wallet, `total_*` is the sum. Legacy `*_lamports` and `*_sol` fields carry the same values.

### `GET /v1/wallet`

On-chain state of the account's wallet: `pubkey`, `asset`, `base_units`, `asset_amount`, and the platform's `master_wallet`.

### `POST /v1/topup`

Body `{ "amount": 10 }` in USD, between 0 and 1,000 per request. Aggregated credits are capped at 10,000 USD. Returns the new balance.

## Catalog and calls

### `GET /v1/agents`

Lists services. With `?q=<text>` it runs hybrid search and returns results ordered by relevance. Each item:

```json
{
  "service": "translator-pro",
  "pricePerCall": 0.01,
  "description": "English → Spanish translation. Input: { text: string }",
  "endpoint": "https://agent-translator.kiba.tools",
  "ownerWallet": "G…",
  "acceptedToken": "USDC",
  "totalCalls": 128,
  "totalEarned": 1.28,
  "createdAt": 1760000000,
  "source": "chain"
}
```

### `POST /v1/call`

Calls a service and pays from the account's balance.

```json
{ "service": "translator-pro", "payload": { "text": "hello" } }
```

Only `service` and `payload` are accepted at the top level. Any other field is rejected with `400` before anything is charged. The response:

```json
{
  "result": { "translation": "hola" },
  "cost": { "lamports": 100000, "usd": 0.01 },
  "paidWith": "credit",
  "mode": "virtual",
  "newBalance": { "lamports": 47900000, "usd": 4.79 },
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/…",
  "trace": { "steps": [] }
}
```

`paidWith` is `credit` or `wallet`. `explorerUrl` links to the on-chain transaction of this call when one was produced. `trace` is the step-by-step timeline of the payment.

### `GET /v1/transactions`

The account's history, newest first. `?limit=` up to 500 (default 50). Each item has `type` (`topup`, `call`), `amount_lamports`, `service`, `tx_signature`, `explorer_url`, `status`, and `created_at`.

## Credentials

### `GET /v1/api-keys`, `POST /v1/api-keys`, `DELETE /v1/api-keys/:id`

List, create (`{ "name": "my-script" }`; the plain key is returned once), and revoke API keys.

### `GET /v1/oauth/connections`, `DELETE /v1/oauth/connections/:id`

Apps authorized through OAuth (Claude, ChatGPT, `kiba-mcp`) and how to disconnect them.

## Publisher

### `POST /v1/publisher/activate`

Body `{ "name": "Acme" }`. Turns the account into a publisher.

### `GET /v1/publisher/overview`

Totals earned, number of calls, the account's services with their stats, and the on-chain wallet balance.

### `GET /v1/publisher/settlements`

Settlement batches released to the publisher, with the fee applied (`fee.pct`) and the on-chain transaction of each. `?limit=` up to 200.

### `GET /v1/publisher/analytics`

Daily series of calls and net earnings. `?days=` from 1 to 90 (default 30). Each point: `day`, `calls`, `earned_base_units`, `earned_asset`, `earned_usd`.

### `GET /v1/agents/mine`, `POST /v1/agents`, `PUT /v1/agents/:service`, `DELETE /v1/agents/:service`

Services registered by this account from the dashboard, signed with the account's wallet. `POST` body: `service`, `pricePerCallLamports` (base units), `endpoint`, `description`. Services published with the SDK are owned by their own keypair and are managed from the SDK, not here.

## Platform

### `GET /v1/platform/stats`

Aggregate marketplace stats and platform revenue.

### `GET /health`

No credential. Returns `{ "ok": true, "service": "kiba-gateway" }`.
