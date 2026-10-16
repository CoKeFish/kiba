---
title: "Trustless Work"
description: "Escrow y reparto 95/5 de cada pago vía Trustless Work: cómo funciona hoy y su estado."
---

# Trustless Work (escrow y reparto)

:::warning[Estado: implementado hoy, se reemplazará por escrows propios]
En octubre de 2026 el equipo decidió dejar Trustless Work y usar **escrows propios de Kiba**. Mientras se construyen, el código sigue usando Trustless Work, y esta página describe lo que hace **hoy**. Cada lugar de estas docs que depende de Trustless Work lleva la etiqueta <TW />.
:::

[Trustless Work](https://www.trustlesswork.com) es un servicio de escrow no custodial sobre Stellar/Soroban (escrow-as-a-service). Kiba lo usa para el escrow y el reparto de ingresos de cada pago, en USDC, en lugar de un contrato de pagos propio.

## Cómo funciona

API REST (`https://dev.api.trustlesswork.com` en testnet, `https://api.trustlesswork.com` en mainnet) autenticada con el header `x-api-key`. El patrón:

1. Un `POST` devuelve una **transacción sin firmar** (XDR).
2. Quien llama la **firma** localmente con su keypair Stellar.
3. `POST /helper/send-transaction` con el XDR firmado la envía a la red.

Trustless Work **despliega un contrato por escrow**, así que un escrow se identifica por su `contractId` (el SDK lo llama `escrowId`; viaja en el header `X-PAYMENT`).

## Mapeo de roles

| Rol de Trustless Work | En Kiba |
|---|---|
| `serviceProvider`, `receiver`, `releaseSigner`, `approver` | El dueño del servicio (sirve y libera a sí mismo) |
| `platformAddress`, `disputeResolver` | La tesorería de Kiba (recibe el `platformFee`, resuelve disputas y reembolsos) |
| Firmante de deploy y fondeo | Quien paga: la tesorería (modo crédito) o la wallet del llamador (modo directo) |

`platformFee = 5` (%) es el reparto 95/5.

## Ciclo de una llamada directa

```text
abrir:     POST /deployer/single-release             → firmar → enviar   (→ contractId)
           POST /escrow/single-release/fund-escrow   → firmar → enviar
           (el servicio atiende la petición)
liberar:   POST /escrow/single-release/release-funds → firmar → enviar
reembolso: flujo de disputa de Trustless Work, resuelto por el disputeResolver
```

## Liquidación por lotes en llamadas del gateway

Las llamadas por el gateway **no** abren un escrow cada una. La tesorería fondea un **escrow de liquidación por publisher y ciclo** a medida que ocurren las llamadas y, periódicamente, lo libera y barre el remanente a la wallet del publisher (`release` + `withdraw_remaining_funds`, este último por invocación directa al contrato porque la API REST de Trustless Work no lo expone). Trustless Work aplica el 5 % al liberar.

## Configuración

```bash title=".env"
TRUSTLESS_WORK_API_KEY=                # del BackOffice dApp de Trustless Work
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com
TRUSTLESS_WORK_PLATFORM_ADDRESS=       # tesorería (platformFee + disputas)
TRUSTLESS_WORK_PLATFORM_FEE=5
TRUSTLESS_WORK_TRUSTLINE_ADDRESS=      # emisor del activo del escrow (testnet: USDC)
TRUSTLESS_WORK_TRUSTLINE_SYMBOL=USDC
TRUSTLESS_WORK_FEE_ADDRESS=            # wallet de comisión de TW (withdraw_remaining_funds)
```

:::info[Sin API key]
Sin `TRUSTLESS_WORK_API_KEY` el SDK arranca con el escrow deshabilitado: el registro y el descubrimiento siguen funcionando y cualquier operación de escrow lanza un error claro.
:::

**Obtener una API key:** BackOffice dApp de Trustless Work → crear perfil → generar la clave de la red objetivo. La [documentación de Trustless Work](https://docs.trustlesswork.com) cubre la dApp y la API en detalle.
