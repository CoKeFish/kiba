---
title: "Testnet"
description: "Valores de red de Stellar testnet, fondos de prueba, explorador y reinicios."
---

# Testnet

Kiba corre hoy en **Stellar testnet**: el gateway público, el catálogo y los servicios de demostración apuntan ahí. Los fondos de testnet no tienen valor, lo que lo hace un lugar seguro para probar el flujo completo.

| Ajuste | Valor |
|---|---|
| Passphrase de red | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Contrato de registro | [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF) |
| Emisor USDC (Circle, testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| <TW /> API de Trustless Work | `https://dev.api.trustlesswork.com` |

## Valores de plataforma

Dos valores pertenecen al gateway público y solo los necesitan los publishers:

| Variable | Qué es |
|---|---|
| `KIBA_PLATFORM_PUBLIC_KEY` | Clave pública de la plataforma, para aceptar llamadas firmadas |
| `KIBA_PLATFORM_ADDRESS` | Dirección de la tesorería que recibe la comisión en los escrows |

Ambas son claves públicas y seguras de compartir. Pídelas al equipo por [Discord o correo](/recursos/soporte#valores-de-plataforma-para-publishers).

## Obtener fondos de testnet

- **XLM:** friendbot fondea cualquier cuenta nueva (el SDK lo llama en `bootstrap()`).
- **USDC:** el [faucet de Circle](https://faucet.circle.com) emite USDC de prueba en Stellar a una cuenta que ya tiene la [trustline](/stellar/usdc-y-trustlines).

## Explorador

[stellar.expert](https://stellar.expert/explorer/testnet) muestra cuentas, contratos y transacciones; los enlaces que Kiba devuelve con cada llamada apuntan ahí.

## Reinicios

:::warning[La SDF reinicia testnet periódicamente]
Tras un reinicio hay que recrear cuentas y registro: Kiba redespliega el contrato y los servicios vuelven a ejecutar `bootstrap()`.
:::
