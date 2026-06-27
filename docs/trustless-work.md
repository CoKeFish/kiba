# Escrow vía Trustless Work

Kiba liquida el escrow de cada pago x402 a través de **[Trustless Work](https://www.trustlesswork.com)**
(escrow-as-a-service no-custodial sobre Stellar/Soroban) en lugar de su contrato Soroban propio.

El **contrato Soroban de Kiba se conserva solo para el registro de agentes**
(`register_agent` / `get_agent` / `update_agent` / `deregister_agent`) — Trustless Work no
tiene marketplace. El escrow (open / fund / release / refund) ya **no** usa el contrato Kiba.

## Cómo funciona Trustless Work

API REST (testnet `https://dev.api.trustlesswork.com`, mainnet `https://api.trustlesswork.com`),
autenticada con header `x-api-key`. El patrón de uso es:

1. `POST` a un endpoint de TW → devuelve una **tx XDR sin firmar**.
2. Se **firma** localmente con el Keypair Stellar (reutilizamos `@stellar/stellar-sdk`).
3. `POST /helper/send-transaction` con el XDR firmado → la red ejecuta.

> El SDK npm `@trustless-work/escrow` es solo-React, así que en el SDK/gateway (Node)
> usamos la **REST cruda** vía `TrustlessWorkEscrowClient`
> (`packages/sdk/src/chain/trustless-work.ts`).

## Diferencia estructural

TW **despliega un contrato por escrow**: la identidad del escrow es un `contractId`, no un
`nonce` dentro de un contrato único. Por eso el SDK identifica escrows por **`escrowId`**:

- `ChainClient.openEscrow(...)` devuelve `{ escrowId, signature }`.
- El header `X-PAYMENT` lleva `escrowId` (lo lee el provider para verificar y liberar).
- `fetchEscrow / claimPayment / refundEscrow` toman `{ escrowId }`.

## Mapeo de roles (single-release, automatizado)

| Rol TW | Quién es en Kiba |
|---|---|
| `serviceProvider` / `receiver` / `releaseSigner` / `approver` | owner del agente (sirve y libera hacia sí mismo, como el `claim` original) |
| `platformAddress` / `disputeResolver` | treasury de la plataforma (recibe el `platformFee`, resuelve disputas/refunds) |
| signer del deploy/fund | el que fondea: treasury (modo crédito) o custodial del usuario (modo wallet) |

`platformFee = 5` (%) equivale a los 500 bps del split 95/5.

## Ciclo por llamada

```
openEscrow:  POST /deployer/single-release  → firmar → send  (→ contractId)
             POST /escrow/single-release/fund-escrow → firmar → send
(agente sirve)
claimPayment: [completar/aprobar milestone] → POST /escrow/single-release/release-funds → firmar → send
refundEscrow: flujo de disputa de TW (lo resuelve el disputeResolver)
```

## Configuración (env)

```
TRUSTLESS_WORK_API_KEY=            # del BackOffice dApp de TW (requerido)
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com
TRUSTLESS_WORK_PLATFORM_ADDRESS=   # treasury (platformFee + disputas)
TRUSTLESS_WORK_PLATFORM_FEE=5
TRUSTLESS_WORK_TRUSTLINE_ADDRESS=  # token del escrow (testnet: USDC)
TRUSTLESS_WORK_TRUSTLINE_SYMBOL=USDC
```

Sin `TRUSTLESS_WORK_API_KEY`, el cliente arranca con el escrow deshabilitado (el registro de
agentes sigue funcionando) y cualquier `openEscrow/claim/refund` lanza un error claro.

## Prerequisito: obtener la API key

1. Entrar al **BackOffice dApp** de Trustless Work y generar una **API key de testnet**.
2. Ponerla en `TRUSTLESS_WORK_API_KEY` (local: `.env`; prod: secrets de Railway).
3. Fijar `TRUSTLESS_WORK_PLATFORM_ADDRESS` = dirección de la treasury y el trustline del token.

## Pendientes (Fase 2 — requieren la API key, confirmar contra la API viva)

Marcados en el código como `TODO(tw-phase2)`:

- Campo exacto del que sale el `contractId` en la respuesta de `send-transaction` del deploy.
- Coreografía de milestone antes del release (TW exige el escrow "completado": confirmar
  `change-milestone-status` / `approve-milestone` y sus bodies).
- Endpoint y shape de lectura del escrow (`getEscrow`).
- Trustline/asset soportado en testnet: TW suele usar **USDC**; Kiba cotiza en **XLM**. Si TW
  no soporta XLM, decidir entre usar USDC en el escrow o pedir soporte XLM (afecta unidades).

## Cutover

La integración vive en la rama `feat/trustless-work-escrow` y **no se mergea a `main`** (que
auto-despliega a prod) hasta tener la API key y un E2E verde, para no romper producción. Hasta
entonces, prod sigue con el escrow vigente.

Verificación sin key: `tsc` limpio + tests del SDK con la API TW mockeada
(`packages/sdk/test/trustless-work.test.ts`). Verificación con key: E2E vía el MCP de Kiba
(`call_agent` → deploy/fund/release de TW en el `trace`, `claimed: true`, split correcto).
