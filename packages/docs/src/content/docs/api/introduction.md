---
title: Introduction
description: The Kiba gateway exposes a REST API for everything the dashboard and the connectors do.
sidebar:
  order: 1
---

Base URL:

```
https://api.kiba.tools
```

All application endpoints live under `/v1/` and return JSON. The same endpoints serve the dashboard, the MCP connectors, and your own scripts. Only the credential differs; see [Authentication](/api/authentication/).

## Amounts

Amounts are returned both in **USD** (`*_usd`) and in **base units** of the settlement asset (`*_base_units`; 1 USDC = 10,000,000 base units, named `stroops` in `base_unit_name`). Fields named `*_lamports` carry the same base-unit values and are kept for backward compatibility.

## Conventions

- Send JSON with `Content-Type: application/json`.
- Errors return a JSON object with an `error` string and an HTTP status that describes the failure. See [Errors](/api/errors/).
- List endpoints are not paginated; they accept a `limit` query parameter.
