---
title: "Servicios externos"
description: "Lista en Kiba una API que ya cobra con x402 o MPP, sin integrar el SDK."
---

# Servicios externos

Si tu API ya cobra por su cuenta con **x402** o **MPP**, no hace falta integrar el SDK de Kiba. La listas con su URL, una descripción y sus parámetros, y los asistentes la encuentran y la llaman como cualquier otro servicio del catálogo.

Es el nivel ligero de publicador: tu API no cambia y el pago le llega como siempre, directo y al momento.

## Cómo funciona

1. Listas la API desde el panel, en **Servicios externos**.
2. Kiba le pide una cotización a la URL, sin pagar. Solo la acepta si responde `402` pidiendo pago con x402 en Stellar o con MPP.
3. La API aparece en el catálogo de los asistentes con el identificador `ext:<tu-identificador>`.
4. Cuando un asistente la llama, Kiba le paga a tu API su precio completo y le cobra al usuario ese precio más la comisión de Kiba.

| | Servicio con SDK | Servicio externo |
|---|---|---|
| Integración | SDK de Kiba | Ninguna |
| Quién cobra al usuario | Kiba | Kiba |
| Cómo te llega el pago | Por tandas, después del plazo de retención | Al momento, en cada llamada, con x402 |
| Comisión de Kiba | Se descuenta de tu precio (5 %) | Se suma a tu precio (5 %) |
| Reclamos del usuario | Sí, mientras dure la retención | No: el pago ya se hizo en la red |

:::info[MPP]
Las APIs que cobran con MPP se pueden listar, pero Kiba todavía no paga con ese protocolo. Quedan visibles en el catálogo y no se pueden llamar hasta que lo haga.
:::

## Qué necesitas

- Una URL **https** pública.
- Que responda `402` con los requisitos de pago de x402 para **USDC en Stellar**, en la misma red en la que opera Kiba (testnet hoy).
- Si la API necesita parámetros para dar el precio, un valor de ejemplo para cada uno.

## Listar una API

En el panel, cambia a modo **Publicador** y abre **Servicios externos**.

| Campo | Qué poner |
|---|---|
| Nombre | El nombre que verá la gente. |
| Identificador | Minúsculas, números y guiones. Los asistentes la llaman como `ext:<identificador>`. |
| URL y método | La dirección de la API y si se llama con `GET`, `POST`, `PUT`, `PATCH` o `DELETE`. |
| Descripción | Qué hace y cuándo usarla. Es lo que lee el asistente para decidir si la llama. |
| Parámetros | Nombre, si va en la URL o en el cuerpo, descripción, si es obligatorio y un ejemplo. |

Al guardar verás el precio por llamada que pagará el usuario, ya con la comisión.

## Cómo la llama un asistente

Aparece en `list_agents` con `kind: "external"`, su URL, sus parámetros y `priceUsd`. Se llama con `call_agent`:

```json
{ "service": "ext:clima", "payload": { "city": "Bogota" } }
```

Kiba pone cada dato del `payload` donde lo declaraste: en la URL o en el cuerpo. Si falta un parámetro obligatorio, la llamada se rechaza antes de cobrar.

La respuesta trae el resultado de tu API, el costo, la parte que es comisión y el enlace a la transacción.

## API

| Ruta | Qué hace |
|---|---|
| `GET /v1/external?q=` | Catálogo de servicios externos. `q` filtra por nombre y descripción. |
| `GET /v1/publisher/external` | Los que listaste tú. |
| `POST /v1/publisher/external` | Lista uno: `slug`, `name`, `description`, `url`, `method`, `params`. |
| `DELETE /v1/publisher/external/:slug` | Quita uno tuyo. |
| `POST /v1/call` | Lo llama, con `service: "ext:<slug>"`. |
