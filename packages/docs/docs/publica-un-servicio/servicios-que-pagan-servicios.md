---
title: "Servicios que pagan servicios"
sidebar_label: "Servicios que pagan servicios"
description: "Un servicio Kiba puede contratar y pagar a otros servicios y APIs x402 desde su código, con el saldo de su publicador. El usuario paga una vez y ve la cascada completa de pagos en Stellar."
---

# Servicios que pagan servicios

Un servicio no tiene que saber hacerlo todo. Puede **contratar a otros servicios** del catálogo, o a cualquier API que cobre con [x402 estándar](/stellar/x402), y pagarlos desde su propio código con el saldo de su publicador. El usuario pide una cosa y paga una vez; Kiba une cada pago que hizo el servicio a ese pedido y se lo muestra completo: a quién pagó, cuánto y la transacción en Stellar de cada pago.

## Cómo se ve para el usuario

El usuario le pide a su asistente "hazme un informe de esta página en español". El asistente llama a `web-brief`, que para atender el pedido:

1. Paga a `web-scraper` para leer y resumir la página.
2. Paga a `translator-pro` para traducir el resumen.
3. Devuelve el informe.

La respuesta de `call_agent` trae el resultado, lo que pagó el usuario y, en `subCalls`, los dos pagos del servicio con sus transacciones. En el dashboard, el resultado muestra la tarjeta **Pagos del servicio** con la misma cascada y el total que el servicio pagó a sus proveedores.

```json
{
  "result": { "brief": "…", "providers": [ … ] },
  "cost": { "baseUnits": 200000, "usd": 0.02 },
  "subCalls": [
    { "service": "web-scraper", "costUsd": 0.005, "explorerUrl": "https://stellar.expert/explorer/testnet/tx/…", "status": "done" },
    { "service": "translator-pro", "costUsd": 0.0025, "explorerUrl": "https://stellar.expert/explorer/testnet/tx/…", "status": "done" }
  ]
}
```

Los `subCalls` traen servicio, estado, costo y transacción. Nunca los cuerpos de esas llamadas: pertenecen a la cuenta del servicio, no a la del usuario.

## Cómo se escribe

El handler recibe un segundo argumento, el **contexto de la llamada**. Su cliente `kiba` ya viene ligado a la llamada que el servicio está atendiendo:

```ts
import { AgentProvider } from 'kiba-sdk';

const agent = new AgentProvider({
  wallet,
  service: 'web-brief',
  pricePerCall: 0.02,
  description: 'Informe de una página web en tu idioma.',
  endpoint: process.env.PUBLIC_ENDPOINT,
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY! },
  // La cuenta con la que este servicio paga a sus proveedores.
  gateway: { url: process.env.KIBA_URL, apiKey: process.env.KIBA_API_KEY },
});

agent.serve(async (req: { url: string; lang: string }, ctx) => {
  const page = await ctx.kiba.call<{ extracted: { summary: string } }>('web-scraper', {
    url: req.url,
    prompt: 'Resume la página en 5 frases.',
  });
  const text = await ctx.kiba.call<{ translated: string }>('translator-pro', {
    text: page.result.extracted.summary,
    to: req.lang,
  });
  return {
    brief: text.result.translated,
    paidByService: { usd: page.cost.usd + text.cost.usd },
  };
});
```

| En el contexto | Qué es |
|---|---|
| `ctx.kiba.call(service, payload)` | Llama a un servicio del catálogo y lo paga. Devuelve `result`, `cost`, `resultId` y `explorerUrl`. Si el servicio tarda, espera el resultado guardado hasta `gateway.timeoutMs` (10 minutos por defecto). |
| `ctx.kiba.callUrl(url, opciones)` | Paga una API que cobra con x402 estándar en Stellar, o la llama gratis si no cobra. Acepta `method`, `body`, `headers` y `maxUsd`. |
| `ctx.kiba.balanceUsd()` | El saldo con el que paga el servicio. |
| `ctx.callId` | El id de la llamada del usuario, cuando llega por el gateway de Kiba. |
| `ctx.via` | Cómo se pagó esta llamada: `platform` (gateway de Kiba), `x402` o `escrow`. |

Los handlers que reciben un solo argumento siguen funcionando igual.

## Con qué cuenta paga el servicio

Con una cuenta de Kiba del publicador: su clave de API va en `gateway.apiKey` o en la variable `KIBA_API_KEY` (la misma que usa el conector `kiba-mcp`), y la URL del gateway en `gateway.url` o `KIBA_URL`. Las llamadas se cobran a esa cuenta como cualquier otra: con créditos o con la wallet de pagos, y quedan en sus resultados y transacciones.

El precio del servicio compuesto lo fija su publicador, plano o [dinámico](/publica-un-servicio/handler-y-precios), y se queda con la diferencia entre lo que cobra y lo que paga.

## Cómo se unen los pagos al pedido

1. El gateway entrega al servicio el id de la llamada que está atendiendo en la cabecera `X-Kiba-Call-Id`, dentro de la llamada firmada por la plataforma.
2. Todo lo que el servicio pague con `ctx.kiba` viaja con `X-Kiba-Parent-Call` y ese id.
3. El gateway liga la llamada hija a la padre solo si la padre existe y sigue en curso. El id lo conocen únicamente el gateway y el servicio al que se lo entregó.
4. `call_agent`, `get_result`, `GET /v1/results/:id` y el dashboard devuelven la cascada como `subCalls`.

Funciona en cadena: un servicio contratado por otro puede a su vez pagar a terceros, y cada nivel queda ligado al pedido que lo originó.
