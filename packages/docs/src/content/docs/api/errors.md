---
title: Errors
description: HTTP statuses and error shapes returned by the gateway.
sidebar:
  order: 4
---

Every error is a JSON object with a single `error` string:

```json
{ "error": "service required" }
```

| Status | Meaning |
| --- | --- |
| `400` | Invalid input: a missing or unknown field, an invalid amount, a name that is too long. The message says which. |
| `401` | Missing or invalid credential. On `/mcp` the response carries a `WWW-Authenticate` header with the resource metadata URL. |
| `404` | Unknown user, key, or connection. |
| `500` | The call to a service failed, or an upstream (discovery, Trustless Work, Stellar) returned an error. The `error` string carries the upstream message. A failed call is refunded to credits. |

## Common messages

- `service required` on `POST /v1/call`: the body has no `service`.
- An unknown-field message on `POST /v1/call`: the body has fields other than `service` and `payload`. Put the service's input inside `payload`.
- `insufficient balance`: credits and wallet together do not cover the price. Top up or fund the wallet.
- `invalid amount (must be 0 < n <= 1000)` on top-up.
- `balance cap exceeded (max $10000)`: aggregated credits cannot exceed the cap.
- `name required` / `name too long (max 64)` when creating an API key.
