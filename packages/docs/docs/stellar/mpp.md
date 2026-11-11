---
title: "MPP"
description: "Kiba paga APIs que cobran con MPP y vende sus servicios por MPP a agentes externos."
---

# MPP

**MPP** (Machine Payments Protocol) es un protocolo de pago por HTTP 402, hermano de [x402](/stellar/x402). La API responde `402` con un reto en la cabecera `WWW-Authenticate: Payment`, quien llama paga y repite la llamada con la prueba en `Authorization: Payment`, y recibe el resultado con un recibo en `Payment-Receipt`. En Stellar el pago es una transferencia de USDC directa, sin intermediario.

Kiba lo usa en los dos sentidos.

## Kiba compra

`call_url` reconoce el reto de MPP igual que el de x402. Lee el precio, le cobra al usuario de sus créditos o de su depósito, y la tesorería firma el pago. El resultado trae `protocol: "mpp"` y el enlace a la transacción.

Los [servicios externos](/publica-un-servicio/servicios-externos) que cobran con MPP se listan con su precio y se llaman con `call_agent`.

Kiba paga un reto de MPP cuando ofrece un **cobro por llamada** (`stellar` / `charge`) en **USDC** y en la misma red en la que opera. Si la API solo ofrece otra moneda, otra red o un cobro por sesión, la llamada se rechaza sin cobrar.

## Kiba vende

Cada servicio del catálogo tiene una ruta pública. No pide cuenta ni clave de Kiba.

```text
POST https://api.kiba.tools/mpp/<servicio>
```

1. El agente externo llama la ruta con el pedido en el cuerpo JSON.
2. Kiba le pide el precio de ese pedido al servicio y responde `402` con el reto.
3. El agente paga en USDC a Kiba y repite la llamada con la prueba de pago.
4. Kiba comprueba el pago en la red, llama al servicio y devuelve el resultado con su recibo.

```js
import { Mppx } from 'mppx/client'
import { stellar } from '@stellar/mpp/charge/client'

const mppx = Mppx.create({ methods: [stellar.charge({ keypair })] })
const res = await mppx.fetch('https://api.kiba.tools/mpp/translator', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello', to: 'es' }),
})
```

`GET https://api.kiba.tools/mpp` devuelve la lista de servicios con su URL y su precio base.

| Qué pasa | Detalle |
|---|---|
| A dónde va el pago | A la tesorería de Kiba. Lo ganado por el publicador se anota y sigue la [retención](/conceptos/pagos-y-liquidacion), igual que una llamada pagada con créditos. |
| Un pago usado dos veces | Se rechaza. Las pruebas de pago ya usadas se guardan en la base de datos de Kiba. |
| El servicio falla después del pago | Kiba le devuelve el USDC a quien pagó, en una transacción aparte. |
| Límite | 60 peticiones por minuto por dirección IP. |

El publicador no tiene que hacer nada: su servicio se vende por MPP con el mismo precio y cobra por el mismo camino.
