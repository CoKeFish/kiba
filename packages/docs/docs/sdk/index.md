---
title: "SDK (kiba-sdk)"
sidebar_label: "Visión general"
description: "Librería TypeScript para publicar servicios o consumirlos directamente, de forma auto-custodial."
---

# SDK (`kiba-sdk`)

```bash
npm install kiba-sdk
# express es una peer dependency opcional, solo para el servidor HTTP integrado:
npm install express
```

Requiere **Node.js 18** o superior. Versión actual en el repo: `0.1.0`. El SDK es abierto: cada servicio lo construye y es propiedad de su publisher; no existe un "servicio Kiba" privilegiado.

## Dos roles

| Clase | Rol | Página |
|---|---|---|
| **`AgentProvider`** | Tú **ofreces** un servicio. Verifica el pago *antes* de correr tu handler y luego sirve y liquida. | [AgentProvider](/sdk/agent-provider) |
| **`AgentClient`** | Tú **consumes** un servicio. Lo descubre y maneja el pago automáticamente con el handshake x402. | [AgentClient](/sdk/agent-client) |

:::note
Las clases conservan sus nombres históricos `Agent*` por estabilidad de API. Sirven para cualquier tipo de servicio.
:::

## Qué abstrae el SDK

- El registro on-chain (registrar, actualizar, borrar, descubrir) detrás de una interfaz `ChainClient`, implementada para Stellar/Soroban (XDR/ScVal con `@stellar/stellar-sdk`).
- <TW /> El ciclo de vida del escrow de Trustless Work (deploy, fondeo, liberación) y las trustlines USDC.
- El handshake de pago: cotizaciones `402`, header `X-PAYMENT`, certificados firmados por la plataforma, protección contra repetición.
- El arranque de cuentas en testnet con friendbot.

## Dónde se usa

La misma librería alimenta el gateway, los servicios de demostración y el orquestador: **todo lo que la plataforma hace con un servicio, lo puedes hacer desde tu propio proceso.**

## En esta sección

- [AgentProvider](/sdk/agent-provider): opciones y métodos para ofrecer un servicio.
- [AgentClient](/sdk/agent-client): consumir servicios con escrow x402.
- [Operar tu propia plataforma](/sdk/operar-tu-plataforma): firmar llamadas como gateway.
- [Configuración](/sdk/configuracion): opciones, variables de entorno y modo degradado.
- [Errores del SDK](/sdk/errores): jerarquía de errores tipados y cómo manejarlos.
