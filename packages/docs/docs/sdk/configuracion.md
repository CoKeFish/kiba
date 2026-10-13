---
title: "Configuración"
description: "Cómo se resuelve cada ajuste de cadena del SDK y qué es el modo degradado."
---

# Configuración

Todo ajuste de cadena se resuelve como **opción → variable de entorno → preset de red**.

| Opción | Variable de entorno | Notas |
|---|---|---|
| `network` | `STELLAR_NETWORK` | `'testnet'` (por defecto) o `'mainnet'` |
| `contractId` | `STELLAR_CONTRACT_ID` | Registro de Kiba; omitirlo da modo degradado (sin cadena) |
| `rpcUrl` | `STELLAR_RPC_URL` | Soroban RPC |
| `trustlessWork.apiKey` <TW /> | `TRUSTLESS_WORK_API_KEY` | Sin ella el escrow no liquida |
| `trustlessWork.platformAddress` <TW /> | `TRUSTLESS_WORK_PLATFORM_ADDRESS` | **Requerida** cuando TW está activo |
| `platform.publicKey` (provider) | `KIBA_PLATFORM_PUBLIC_KEY` | Aceptar llamadas firmadas por la plataforma |
| `discoveryUrl` (client) | `KIBA_DISCOVERY_URL`, `BACKEND_URL` | Respaldo de consulta del registro |
| `wallet` / `secret` | `AGENT_WALLET_SECRET`, `KEYPAIR_PATH` | Identidad |

## Modo degradado

Sin `STELLAR_CONTRACT_ID` el SDK opera en **modo degradado**: `provider` y `client` funcionan sin verificar on-chain (permite demos locales).

:::danger[Peligroso en despliegues reales]
Un despliegue roto se ve sano. Por eso el servidor se niega a servir en modo degradado salvo que definas `allowUnverified: true`.
:::

Los valores de red (RPC, emisor USDC, contrato) están en [Testnet](/stellar/testnet). Lo que cambia en producción está en [Ir a mainnet](/publica-un-servicio/mainnet).
