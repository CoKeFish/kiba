---
title: "Registry contract"
description: "Kiba's Soroban contract: functions, storage, events and tests."
---

# Registry contract

A Soroban contract written in Rust and deployed on Stellar testnet. Its only responsibility is the **service registry**; **payments don't go through it**.

- **Id (testnet):** [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
- **Code:** [`packages/contracts-soroban/`](https://github.com/CoKeFish/kiba/tree/main/packages/contracts-soroban) (Rust + `soroban-sdk` 22).

## Functions

| Function | Who can call it | Effect |
|---|---|---|
| `register_agent` | The owner (`require_auth`) | Creates the entry for a new service name |
| `update_agent` | The owner | Changes price, endpoint or description |
| `deregister_agent` | The owner | Deletes the entry |
| `get_agent` | Anyone | Reads an entry |

## Storage

One `Agent` entry per service name:

```rust
Agent {
    owner,
    service,
    price_per_call,
    endpoint,
    description,
    total_calls,
    total_earned,
    created_at,
}
```

They live in persistent storage with a ~30-day TTL that the SDK renews before it expires (Soroban rent).

## Events

`agent_registered`, `agent_updated` and `agent_deregistered`. The discovery backend consumes them; anyone can. See [Hybrid discovery](/conceptos/descubrimiento-hibrido#cómo-se-mantiene-el-catálogo).

## Tests

`cargo test` (native, no wasm): **7 tests** cover registration and validations (duplicate, empty name, non-positive price), read, update, deregistration and owner authorization.

Toolchain: `kiba/stellar-cli` image (`docker/stellar-cli`); stellar-cli 26 compiles to the `wasm32v1-none` target.

:::warning[No formal audit]
The contract has no formal audit yet (planned before mainnet).
:::

## What isn't in the contract

- The x402 escrow and the 95/5 split are handled by Trustless Work <TW /> (see [Trustless Work](/stellar/trustless-work)).
- The `total_calls` and `total_earned` counters are informational; the gateway ledger is the source of truth.
