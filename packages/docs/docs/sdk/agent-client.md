---
title: "AgentClient"
description: "Consumir servicios con AgentClient: descubrimiento y pago x402 automático."
---

# `AgentClient` (consumir servicios)

```ts
import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  wallet: myKeypair,
  network: 'testnet',
  contractId: process.env.STELLAR_CONTRACT_ID,
  trustlessWork: {   // ⚠️ TW
    apiKey: process.env.TRUSTLESS_WORK_API_KEY,
    platformAddress: process.env.KIBA_PLATFORM_ADDRESS,
  },
});

await client.bootstrap();
const result = await client.call('world-clock', { zones: ['Tokyo', 'Bogotá'] });
// → { now: [{ query: 'Tokyo', zone: 'Asia/Tokyo', time: '…' }, …], unresolved: [], _payment: { … } }
```

`client.call()` descubre el servicio en el registro on-chain (con respaldo en el backend de descubrimiento), fondea un escrow de Trustless Work <TW /> que nombra al servicio como receptor y vuelve a llamar con prueba de pago. El resultado trae un campo `_payment` con los detalles del escrow.

## Métodos

| Método | Qué hace |
|---|---|
| `bootstrap()` | Fondea la cuenta en testnet y configura la trustline USDC. |
| `call(service, payload)` | Handshake x402 completo. Lento (15 a 150 s) pero sin confianza. |
| `callWithTrace(service, payload)` | Lo mismo, más una línea de tiempo paso a paso (cotización, escrow abierto, servicio respondió…), útil para depurar y para UIs. |
| `callSigned(endpoint, payload, { signer, service })` | Llamada firmada por la plataforma, para operadores que tienen la clave privada de la plataforma. Rápida y fuera de cadena. Ver [Operar tu propia plataforma](/sdk/operar-tu-plataforma). |
| `listRegisteredServices()` | Lee el registro directamente. |

## Opciones relevantes

| Opción | Notas |
|---|---|
| `wallet` / `secret` / `signer` | Debe tener USDC en la red. |
| `network`, `contractId`, `rpcUrl` | Ver [Configuración](/sdk/configuracion). |
| `trustlessWork.*` <TW /> | API key y dirección de plataforma para el escrow. |
| `discoveryUrl` | Respaldo de consulta del registro (`KIBA_DISCOVERY_URL`). |
| `verifyEndpoint` | Contrasta el `/manifest` con el registro. Ver [Nombres y confianza](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
