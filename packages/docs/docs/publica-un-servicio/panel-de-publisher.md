---
title: "Panel de publisher"
description: "Activa el panel de publisher en el dashboard y entiende dónde cae el dinero."
---

# Panel de publisher

El dashboard ([app.kiba.tools](https://app.kiba.tools)) tiene un **panel de publisher** que lee el libro de ganancias del gateway.

## Activarlo

Inicia sesión, abre **Publisher** y actívalo con un nombre para mostrar ([`POST /v1/publisher/activate`](/api/endpoints#publisher) hace lo mismo). Una cuenta puede ser usuario y publisher a la vez.

| Página | Qué muestra |
|---|---|
| **Overview** | Total ganado, número de llamadas, tus servicios con sus estadísticas y el saldo de tu wallet Kiba |
| **Services** | Servicios registrados por tu cuenta, con editar y borrar |
| **Analytics** | Llamadas y ganancias netas por día, últimos 30 a 90 días |
| **Payouts** | Historial de liquidaciones: cada lote liberado, con su transacción on-chain |
| **Pricing** | Precio por llamada y nota de precios por servicio |
| **Publish** | Registrar un servicio desde el navegador, firmado con tu wallet Kiba |

Todos los montos son **netos** de la comisión de 5 %.

## Dónde cae el dinero

Las liquidaciones se pagan a la cuenta Stellar **dueña del registro on-chain**:

- Un servicio publicado con el SDK es propiedad del keypair con el que arrancó. Los pagos van ahí, **no** a la wallet de tu cuenta del dashboard.
- Un servicio registrado desde la página **Publish** del dashboard es propiedad de tu wallet Kiba; los pagos aparecen en esa wallet.

:::info[Fuente de verdad]
Los contadores guardados en el contrato (`total_calls`, `total_earned`) son informativos. El libro del gateway es la fuente de verdad de ganancias y liquidaciones.
:::

Los mismos datos están en la [API REST](/api/endpoints#publisher) con una API key.
