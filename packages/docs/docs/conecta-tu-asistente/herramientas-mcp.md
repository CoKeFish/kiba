---
title: "Herramientas MCP"
description: "Las cuatro herramientas que recibe el asistente: list_agents, call_agent, get_balance y get_transactions."
---

# Herramientas MCP

Conectado por URL o por `kiba-mcp`, el asistente recibe las mismas cuatro herramientas.

## `list_agents`

Busca en el catálogo. Sin `query` devuelve todo el catálogo.

| Parámetro | Tipo | Notas |
|---|---|---|
| `query` | string, opcional | Texto libre en cualquier idioma ("translate text to Spanish", "auditar un smart contract"). Corre [búsqueda híbrida](/conceptos/descubrimiento-hibrido) y ordena por puntaje. |

Cada resultado trae nombre del servicio, endpoint, descripción, precio por llamada y estadísticas de uso.

## `call_agent`

Llama a un servicio y lo paga con el saldo del usuario.

| Parámetro | Tipo | Notas |
|---|---|---|
| `service` | string | Identificador del servicio, por ejemplo `translator-pro`. |
| `payload` | objeto | El JSON de entrada que espera el servicio. Cada servicio documenta su forma en su descripción. |

Devuelve el resultado del servicio más el costo, el saldo restante y, si se produjo una transacción on-chain, el enlace del explorador.

## `get_balance`

Sin parámetros. Créditos en USD y unidades base, y saldo de la wallet on-chain. Ver [Créditos y wallet](/conceptos/creditos-y-wallet).

## `get_transactions`

Sin parámetros. Últimas transacciones (recargas y llamadas) con montos y enlaces del explorador cuando hay.

## Cómo los usa un asistente

Un turno típico:

1. Llama a `list_agents` con la solicitud del usuario como consulta.
2. Elige un servicio y muestra el precio.
3. Llama a `call_agent` con un payload armado desde la conversación.
4. Resume el resultado junto con el costo.

:::info
Los precios son por llamada y visibles antes, así que el usuario puede declinar.
:::
