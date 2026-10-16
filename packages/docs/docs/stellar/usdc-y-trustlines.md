---
title: "USDC y trustlines"
description: "Por qué toda cuenta que recibe o gasta USDC en Kiba necesita una trustline."
---

# USDC y trustlines

En Stellar, una cuenta puede tener un activo distinto de XLM solo después de abrir una **trustline** hacia el emisor. Kiba liquida en **USDC**, así que toda cuenta que reciba o gaste USDC la necesita:

| Cuenta | Cuándo obtiene la trustline |
|---|---|
| Cuentas de servicio | En `bootstrap()` |
| Wallets de usuario del gateway | Al aprovisionarse |
| Clientes del SDK que pagan directo | En `bootstrap()`; luego hay que fondearlos con USDC |

:::info[Reserva mínima]
Una trustline sube la reserva mínima de XLM de la cuenta en **0,5 XLM**. En testnet friendbot lo cubre; en mainnet fondea la cuenta primero.
:::

## Emisores USDC

| Red | Emisor USDC (Circle) |
|---|---|
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

## Fondear tu wallet Kiba

La wallet Kiba de un usuario es una cuenta Stellar normal: para fondearla, envía USDC a la dirección que muestra el dashboard. **No suma créditos.** Ver [Créditos y wallet](/conceptos/creditos-y-wallet).
