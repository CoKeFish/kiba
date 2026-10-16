---
title: "Gateway REST API"
sidebar_label: "Overview"
description: "Base URL, conventions and amounts of the Kiba gateway REST API."
---

# Gateway REST API

Base URL: **`https://api.kiba.tools`**. All application endpoints live under `/v1/` and return JSON. The same endpoints serve the dashboard, the MCP connectors and your scripts; only the credential changes.

## Conventions

- Send JSON with `Content-Type: application/json`.
- Errors return an object with an `error` string and a descriptive HTTP status. See [Errors](/api/errores).
- Lists aren't paginated; they accept `limit`.

## Amounts

Returned in **USD** (`*_usd`) and in **base units** of the settlement asset (`*_base_units`; 1 USDC = 10,000,000 base units, called `stroops` in `base_unit_name`).

:::note[Legacy fields]
The `*_lamports` / `*_sol` fields carry the same values for backward compatibility (inherited from Solana).
:::

## First request

```bash
curl https://api.kiba.tools/v1/balance \
  -H "Authorization: Bearer sk_live_…"
```

## In this section

- [Authentication](/api/autenticacion): API keys, OAuth 2.0 and session cookie.
- [Endpoints](/api/endpoints): account, catalog and calls, credentials, publisher and platform.
- [Errors](/api/errores): HTTP codes and common messages.
