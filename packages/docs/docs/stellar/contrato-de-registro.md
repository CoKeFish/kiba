---
title: "Contrato de registro"
description: "El contrato Soroban de Kiba: funciones, almacenamiento, eventos y pruebas."
---

# Contrato de registro

Contrato Soroban escrito en Rust y desplegado en Stellar testnet. Su única responsabilidad es el **registro de servicios**; **los pagos no pasan por él**.

- **Id (testnet):** [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
- **Código:** [`packages/contracts-soroban/`](https://github.com/CoKeFish/kiba/tree/main/packages/contracts-soroban) (Rust + `soroban-sdk` 22).

## Funciones

| Función | Quién puede llamarla | Efecto |
|---|---|---|
| `register_agent` | El dueño (`require_auth`) | Crea la entrada de un nuevo nombre de servicio |
| `update_agent` | El dueño | Cambia precio, endpoint o descripción |
| `deregister_agent` | El dueño | Elimina la entrada |
| `get_agent` | Cualquiera | Lee una entrada |

## Almacenamiento

Una entrada `Agent` por nombre de servicio:

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

Viven en almacenamiento persistente con un TTL de ~30 días que el SDK renueva antes de vencer (renta de Soroban).

## Eventos

`agent_registered`, `agent_updated` y `agent_deregistered`. El backend de descubrimiento los consume; cualquiera puede hacerlo. Ver [Descubrimiento híbrido](/conceptos/descubrimiento-hibrido#cómo-se-mantiene-el-catálogo).

## Pruebas

`cargo test` (nativo, sin wasm): **7 tests** cubren registro y validaciones (duplicado, nombre vacío, precio no positivo), lectura, actualización, baja y autorización del dueño.

Toolchain: imagen `kiba/stellar-cli` (`docker/stellar-cli`); stellar-cli 26 compila al target `wasm32v1-none`.

:::warning[Sin auditoría formal]
El contrato aún no tiene auditoría formal (prevista antes de mainnet).
:::

## Qué no está en el contrato

- El escrow x402 y el reparto 95/5 los resuelve Trustless Work <TW /> (ver [Trustless Work](/stellar/trustless-work)).
- Los contadores `total_calls` y `total_earned` son informativos; el libro del gateway es la fuente de verdad.
