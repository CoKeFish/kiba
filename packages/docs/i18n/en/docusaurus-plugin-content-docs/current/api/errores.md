---
title: "Errors"
description: "HTTP codes and common error messages of the gateway API."
---

# Errors

Every error is a JSON object with a single `error` string:

```json
{ "error": "service required" }
```

| Status | Meaning |
|---|---|
| `400` | Invalid input: missing or unknown field, invalid amount, name too long. The message says which. |
| `401` | Missing or invalid credential. On `/mcp` the response carries `WWW-Authenticate` with the resource metadata URL. |
| `404` | Unknown user, key or connection. |
| `500` | The service call failed or an upstream (discovery, Trustless Work <TW />, Stellar) returned an error. The `error` string carries the upstream message. **A failed call is refunded to credits.** |

## Common messages

| Message | Cause |
|---|---|
| `service required` | `service` is missing in `POST /v1/call`. |
| Unknown field | There are fields other than `service` and `payload`: put the service input inside `payload`. |
| `insufficient balance` | Credits and wallet together don't cover the price. |
| `invalid amount (must be 0 < n <= 1000)` | Top-up amount out of range. |
| `balance cap exceeded (max $10000)` | The top-up would exceed the credit cap. |
| `name required` / `name too long (max 64)` | Invalid name when creating an API key. |

More cases in [FAQ and troubleshooting](/recursos/faq#llamadas).
