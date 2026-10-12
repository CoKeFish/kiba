---
title: Registry contract
description: The Soroban smart contract that holds the service registry.
sidebar:
  order: 3
---

The registry is a Soroban contract written in Rust and deployed to Stellar testnet. Its single responsibility is the **service registry**. Payments do not go through it.

- **Contract id (testnet):** [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
- **Source:** `packages/contracts-soroban/` in the [repository](https://github.com/CoKeFish/kiba).

## Functions

| Function | Who can call | Effect |
| --- | --- | --- |
| `register_agent` | the owner (`require_auth`) | Creates the entry for a new service name |
| `update_agent` | the owner | Changes price, endpoint, or description |
| `deregister_agent` | the owner | Removes the entry |
| `get_agent` | anyone | Reads one entry |

## Storage

One `Agent` entry per `service` name: `owner`, `service`, `price_per_call`, `endpoint`, `description`, `total_calls`, `total_earned`, `created_at`. Entries live in persistent storage with a TTL of about 30 days that the SDK renews before expiry.

## Events

`agent_registered`, `agent_updated`, `agent_deregistered`. The discovery backend consumes them to keep its index current. Anyone can do the same.

## What is not in the contract

The x402 escrow and the 95/5 split are handled by [Trustless Work](/stellar/trustless-work/). The `total_calls` and `total_earned` counters are informational; the gateway's ledger is the source of truth for publisher earnings.
