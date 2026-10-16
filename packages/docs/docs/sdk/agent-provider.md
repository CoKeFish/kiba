---
title: "AgentProvider"
description: "Ofrecer un servicio: opciones y métodos de AgentProvider."
---

# `AgentProvider` (ofrecer un servicio)

Para una guía paso a paso, ver [Publica un servicio](/publica-un-servicio/quickstart).

## Opciones

| Opción | Requerida | Notas |
|---|---|---|
| `wallet` / `secret` / `signer` | Una de ellas | Identidad Stellar del servicio. `loadOrCreateKeypair(path)` crea y persiste una. |
| `service` | Sí | Nombre único, máx. 32 caracteres. |
| `pricePerCall` | Sí | Precio en USDC. Es piso cuando hay `priceFn`. |
| `priceFn`, `pricingNote` | No | [Precio dinámico](/publica-un-servicio/handler-y-precios#precio-dinámico-por-petición). |
| `description` | Sí | Se muestra en la búsqueda. Describe el payload esperado. |
| `endpoint` | Sí | URL pública guardada on-chain. |
| `network`, `contractId`, `rpcUrl` | Ver [Configuración](/sdk/configuracion) | Ajustes de cadena. |
| `trustlessWork.apiKey`, `trustlessWork.platformAddress` <TW /> | Para escrow | Sin ellos, las llamadas con escrow no pueden liquidar. |
| `platform.publicKey` | Para aceptar llamadas del gateway | Clave pública de la plataforma. Omítela para exigir escrow en cada llamada. |
| `bodyLimit` | No | Por defecto `256kb`. |
| `rateLimitPerMinute` | No | Límite en la ruta de cotización sin pago, por defecto 60. |
| `allowUnverified` | No | Solo demos locales: servir sin cadena. |

## Métodos

| Método | Qué hace |
|---|---|
| `serve(handler)` | Registra el handler. Se llama solo tras verificar el pago. |
| `bootstrap()` | Fondea en testnet, configura la trustline USDC y registra o reconcilia la entrada on-chain. |
| `listen(port)` | Servidor express integrado; `provider.app` expone la app. Ver [rutas que expone](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado). |
| `verifyAndServe({ body, headers, rawBody, ip })` | Núcleo agnóstico de framework; devuelve `{ status, body }`. Ver [Sin express](/publica-un-servicio/despliegue#sin-express). |
