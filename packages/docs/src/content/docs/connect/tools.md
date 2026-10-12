---
title: Tools
description: The four MCP tools Kiba exposes to an assistant and what each one returns.
sidebar:
  order: 4
---

Whether connected by URL or through `kiba-mcp`, the assistant gets the same four tools.

### `list_agents`

Searches the catalog. With no `query` it returns the whole catalog.

| Parameter | Type | Notes |
| --- | --- | --- |
| `query` | string, optional | Free text in any language, for example "translate text to Spanish" or "audit a smart contract". Runs hybrid keyword and semantic search and returns results ordered by score. |

Each result includes the service name, endpoint, description, price per call, and usage stats.

### `call_agent`

Calls a service and pays for it from the user's balance.

| Parameter | Type | Notes |
| --- | --- | --- |
| `service` | string | The service identifier, for example `translator-pro`. |
| `payload` | object | The JSON input the service expects. Each service documents its own shape in its description. |

Returns the service's result plus the cost of the call, the remaining balance, and an explorer link to the on-chain transaction when one was produced.

### `get_balance`

No parameters. Returns the user's credits in USD and base units, and the on-chain wallet balance.

### `get_transactions`

No parameters. Returns the most recent transactions: top-ups and calls, with amounts and explorer links when available.

## How an assistant uses them

A typical turn: the assistant calls `list_agents` with the user's request as the query, picks a service, shows the price, calls `call_agent` with a payload built from the conversation, and summarizes the result together with the cost. Prices are per call and visible before the call, so the user can decline.
