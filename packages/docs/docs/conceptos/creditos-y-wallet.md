---
title: "Créditos y wallet"
description: "Los dos saldos de una cuenta Kiba: créditos fuera de cadena y wallet on-chain."
---

# Créditos y wallet

Cada cuenta del gateway tiene **dos saldos separados**, fáciles de confundir.

:::warning[No se mezclan]
Fondear la wallet **no** suma créditos, y recargar créditos no mueve USDC a tu wallet. Son independientes.
:::

## Créditos (fuera de cadena)

Saldo en USD en el libro del gateway. Es lo que gasta un asistente al llamar a un servicio.

- Las cuentas nuevas empiezan con **5 USD** de crédito (testnet).
- Se recarga desde la página **Billing** del dashboard o con [`POST /v1/topup`](/api/endpoints#cuenta).
- El gasto es inmediato y fuera de cadena: se debita en milisegundos.
- `get_balance` y `GET /v1/balance` lo reportan como `balance_usd`.
- El dashboard muestra los créditos en **Kibix** (10.000 Kibix = 1 USD); la API devuelve USD y unidades base.

## Wallet (on-chain)

Cada cuenta recibe una wallet Stellar. Cuando Privy está configurado, se aprovisiona como wallet de servidor **no custodial**: la clave vive en el enclave seguro (TEE) de Privy y el gateway solo solicita firmas (`raw_sign`). Su dirección pública aparece en el dashboard y en `GET /v1/me` (campo `custodial_wallet`).

- Guarda **USDC** en Stellar; el gateway configura la [trustline](/stellar/usdc-y-trustlines).
- Para fondearla, envía USDC a su dirección: es una cuenta Stellar normal, sin memo.

## Cuál paga una llamada

| Situación | Quién paga | `paidWith` |
|---|---|---|
| Hay crédito suficiente | La tesorería firma y paga on-chain; la wallet del usuario no se toca (un solo cargo) | `credit` |
| No hay crédito | La wallet paga directamente con el escrow completo on-chain; más lenta (un solo cargo) | `wallet` |

Los publishers cobran **on-chain**, no en créditos.

## Métodos de recarga

Todos en sandbox/test. Se seleccionan con `PAYMENT_PROVIDER`; el valor por defecto es `bre-b-sandbox`.

| Método | Detalle |
|---|---|
| Stripe | Tarjeta |
| PayPal | Cuenta PayPal |
| Wompi | PSP colombiano |
| Bre-B | QR o llave, confirmación manual |
| Depósito USDC en Stellar | Detección por memo vía Horizon |
