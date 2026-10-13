---
title: "Estado del proyecto"
description: "Qué funciona hoy en testnet, qué es demo o mock y qué queda fuera de alcance."
---

# Estado del proyecto

Kiba es una **demostración técnica en testnet de Stellar**, no un producto comercial lanzado. No tiene usuarios de terceros y no mueve fondos reales. Todo lo descrito en estas docs funciona de punta a punta en testnet.

## Funciona hoy (testnet)

- Todos los servicios levantan con `docker compose up`.
- Registro on-chain de servicios (Soroban), descubrimiento híbrido (FTS5 + embeddings) y dashboard.
- Pago por llamada fuera de cadena (~170 ms, medido en testnet) + liquidación por lotes en USDC con reparto 95/5, verificada on-chain en testnet.
- El adaptador MCP completa el flujo OAuth 2.0 con PKCE contra el gateway; también hay conector remoto (`/mcp`).
- Wallets de usuario no custodiales vía Privy (cuando está configurado) y créditos, con cascada hacia USDC on-chain.
- Paquetes npm publicados (`kiba-sdk`, `kiba-mcp`) e instalador de escritorio de un clic para Windows.

## Mocks y stubs dentro del repo

De los 8 servicios de demostración, **3 son reales** y 5 devuelven respuestas simuladas. El contrato los trata como a cualquier servicio registrado.

| Servicio | Estado | Detalle |
|---|---|---|
| `web-scraper` | **Real** | Firecrawl: contenido dinámico renderizado con JS |
| `world-clock` | **Real** | Zonas horarias reales con `Intl`, sin API externa |
| `randomizer` | **Real** | Aleatoriedad criptográfica con `node:crypto` |
| `yield-hunter` | Mock | Respuesta simulada |
| `risk-auditor` | Mock | Respuesta simulada |
| `translator-pro` | Mock | Respuesta simulada |
| `price-oracle` | Mock | Respuesta simulada |
| `code-reviewer` | Mock | Respuesta simulada |

:::note[Recargas en sandbox]
Las recargas fiat → créditos corren en **modo sandbox/test** (Stripe test, PayPal sandbox, Wompi sandbox, Bre-B sandbox). No hay cobros reales.
:::

## Fuera de alcance por ahora

- Publishers de terceros y usuarios externos a escala.
- Mainnet.
- Auditoría formal del contrato.
- Trabajo regulatorio para operación custodial (KYC/AML).
- Confiabilidad operativa de largo plazo (SLA).

Lo que viene está en la [hoja de ruta](/recursos/hoja-de-ruta).
