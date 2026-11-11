---
title: "External services"
description: "List an API that already charges with x402 or MPP on Kiba, without integrating the SDK."
---

# External services

If your API already charges on its own with **x402** or **MPP**, you do not need to integrate the Kiba SDK. You list it with its URL, a description and its parameters, and assistants find it and call it like any other service in the catalog.

This is the light publisher tier: your API does not change and the payment reaches it as always, directly and right away.

## How it works

1. You list the API from the dashboard, under **External services**.
2. Kiba asks the URL for a quote, without paying. It is only accepted if it replies `402` asking for payment with x402 on Stellar or with MPP.
3. The API appears in the assistants' catalog with the identifier `ext:<your-identifier>`.
4. When an assistant calls it, Kiba pays your API its full price and charges the user that price plus Kiba's fee.

| | Service with the SDK | External service |
|---|---|---|
| Integration | Kiba SDK | None |
| Who charges the user | Kiba | Kiba |
| How you get paid | In batches, after the holding period | Right away, on every call, with x402 or MPP |
| Kiba's fee | Deducted from your price (5%) | Added on top of your price (5%) |
| User claims | Yes, during the holding period | No: the payment is already on the network |

:::info[MPP]
Kiba pays [MPP](/stellar/mpp) APIs that offer a per-call charge in USDC on Stellar. An MPP API that only accepts another currency, another network or a session charge stays listed but cannot be called.
:::

## What you need

- A public **https** URL.
- It must reply `402` asking for payment with x402 or MPP, in **USDC on Stellar**, on the same network Kiba runs on (testnet today).
- If the API needs parameters to return a price, an example value for each one.

## Listing an API

In the dashboard, switch to **Publisher** mode and open **External services**.

| Field | What to enter |
|---|---|
| Name | The name people will see. |
| Identifier | Lowercase letters, numbers and hyphens. Assistants call it as `ext:<identifier>`. |
| URL and method | The API address and whether it is called with `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| Description | What it does and when to use it. This is what the assistant reads to decide whether to call it. |
| Parameters | Name, whether it goes in the URL or in the body, description, whether it is required, and an example. |

When you save you will see the price per call the user will pay, with the fee included.

## How an assistant calls it

It appears in `list_agents` with `kind: "external"`, its URL, its parameters and `priceUsd`. It is called with `call_agent`:

```json
{ "service": "ext:weather", "payload": { "city": "Bogota" } }
```

Kiba puts each `payload` value where you declared it: in the URL or in the body. If a required parameter is missing, the call is rejected before charging.

The response carries your API's result, the cost, the part that is the fee, and the link to the transaction.

## API

| Route | What it does |
|---|---|
| `GET /v1/external?q=` | Catalog of external services. `q` filters by name and description. |
| `GET /v1/publisher/external` | The ones you listed. |
| `POST /v1/publisher/external` | Lists one: `slug`, `name`, `description`, `url`, `method`, `params`. |
| `DELETE /v1/publisher/external/:slug` | Removes one of yours. |
| `POST /v1/call` | Calls it, with `service: "ext:<slug>"`. |
