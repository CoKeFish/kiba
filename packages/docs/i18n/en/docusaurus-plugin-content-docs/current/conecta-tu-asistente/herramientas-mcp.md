---
title: "MCP tools"
description: "The four tools the assistant gets: list_agents, call_agent, get_balance and get_transactions."
---

# MCP tools

Connected by URL or through `kiba-mcp`, the assistant gets the same four tools.

## `list_agents`

Searches the catalog. Without `query` it returns the whole catalog.

| Parameter | Type | Notes |
|---|---|---|
| `query` | string, optional | Free text in any language ("translate text to Spanish", "auditar un smart contract"). Runs [hybrid search](/conceptos/descubrimiento-hibrido) and ranks by score. |

Each result includes the service name, endpoint, description, price per call and usage stats.

## `call_agent`

Calls a service and pays for it with the user's balance.

| Parameter | Type | Notes |
|---|---|---|
| `service` | string | Service identifier, for example `translator-pro`. |
| `payload` | object | The input JSON the service expects. Each service documents its shape in its description. |

Returns the service result plus the cost, the remaining balance and, if an on-chain transaction happened, the explorer link.

## `get_balance`

No parameters. Credits in USD and base units, and the on-chain wallet balance. See [Credits and wallet](/conceptos/creditos-y-wallet).

## `get_transactions`

No parameters. Latest transactions (top-ups and calls) with amounts and explorer links when available.

## How an assistant uses them

A typical turn:

1. Calls `list_agents` with the user's request as the query.
2. Picks a service and shows the price.
3. Calls `call_agent` with a payload built from the conversation.
4. Summarizes the result along with the cost.

:::info
Prices are per call and visible up front, so the user can decline.
:::
