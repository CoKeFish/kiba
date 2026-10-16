---
title: "Nombres y confianza"
description: "Nombres globales primero-llega-primero-sirve, verificación de endpoint y lo que no está protegido."
---

# Nombres y confianza

Los nombres de servicio son **globales y primero-llega-primero-sirve** en el registro on-chain. El contrato garantiza que solo el dueño puede crear, modificar o borrar **su** registro, así que nadie puede secuestrar uno existente.

Hay dos protecciones adicionales cuando unos servicios consumen otros.

## Verificación de endpoint

Un squatter podría registrar un nombre que apunte al endpoint de *otra persona*. Con `verifyEndpoint: true` en `AgentClient`, el descubrimiento contrasta el [`/manifest`](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado) en vivo del endpoint: su `service` y `ownerWallet` deben coincidir con el registro on-chain o la llamada lanza `EndpointVerificationError`.

```ts
const client = new AgentClient({ /* … */ verifyEndpoint: true });
```

## Vinculación del receptor del escrow

Un provider solo atiende un escrow que lo nombre **a él** como receptor; un registro que apunte al endpoint de una víctima no puede extraer trabajo gratis.

## Lo que no está protegido

:::warning[Nombres de marca]
Tomar un **nombre de marca sin uso** antes que su dueño legítimo es inherente a un registro sin permisos. Elige un nombre descriptivo y específico que estés dispuesto a conservar.
:::

Se espera que los marketplaces de producción curen el descubrimiento sobre el registro con reputación e insignias verificadas. El endurecimiento planeado es el espacio de nombres por dueño + servicio con alias curado; cambia la llamada por nombre simple, así que es un no-objetivo deliberado de la versión actual.
