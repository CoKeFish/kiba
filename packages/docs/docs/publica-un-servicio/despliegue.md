---
title: "Despliegue"
description: "Publica tu servicio en una URL HTTPS estable, conserva su identidad y conoce las rutas que expone."
---

# Despliegue

Aloja el proceso donde obtenga una **URL HTTPS pública estable** (VPS, plataforma de contenedores, función serverless). Define `endpoint` (o `PUBLIC_ENDPOINT`) con esa URL: es lo que llaman los clientes y queda guardada on-chain al registrar.

## Conserva la identidad

Persiste el archivo de keypair o pasa el secreto por `AGENT_WALLET_SECRET` (un secreto `S…`) para mantener la misma cuenta Stellar entre reinicios y redespliegues. Esa cuenta es su registro y donde llegan sus ganancias.

## Cambiar precio, descripción o endpoint

Cambia la opción y reinicia. Volver a ejecutar `bootstrap()` reconcilia el registro on-chain automáticamente.

## Sin express

Con Fastify, Hono o serverless, omite `listen()` y monta el núcleo agnóstico de framework:

```ts
const { status, body } = await provider.verifyAndServe({
  body,      // JSON parseado
  headers,   // headers de la petición
  rawBody,   // bytes exactos de la petición (necesarios para verificar llamadas firmadas por la plataforma)
  ip,        // para limitar tasa
});
```

`express` es una peer dependency opcional; solo se necesita para `provider.app` y `provider.listen()`.

## Lista de verificación

- [ ] Endpoint HTTPS público alcanzable desde internet.
- [ ] Keypair persistido, o secreto inyectado.
- [ ] Definidos para la red objetivo: `STELLAR_CONTRACT_ID`, `KIBA_PLATFORM_PUBLIC_KEY` y, por Trustless Work, `TRUSTLESS_WORK_API_KEY` y `KIBA_PLATFORM_ADDRESS`. <TW />
- [ ] Reloj del host sincronizado: las llamadas firmadas se rechazan si el reloj se desvía más de ~2 minutos.

## Rutas que expone el servidor integrado

| Ruta | Para qué |
|---|---|
| `POST /service` | El endpoint de pago. Sin pago responde `402` con una cotización; con un header `X-PAYMENT` válido o una firma de plataforma ejecuta el handler. |
| `GET /manifest` | Nombre del servicio, wallet del dueño, precio y descripción. Lo usan el descubrimiento y la [verificación de endpoint](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
| `GET /health` | Comprobación de vida. |
