---
title: "AgentClient"
description: "Consumir serviços com o AgentClient: descoberta e pagamento x402 automático."
---

# `AgentClient` (consumir serviços)

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

`client.call()` descobre o serviço no registro on-chain (com fallback no backend de descoberta), financia um escrow da Trustless Work <TW /> que nomeia o serviço como recebedor e chama de novo com prova de pagamento. O resultado traz um campo `_payment` com os detalhes do escrow.

## Métodos

| Método | O que faz |
|---|---|
| `bootstrap()` | Financia a conta na testnet e configura a trustline de USDC. |
| `call(service, payload)` | Handshake x402 completo. Lento (15 a 150 s), mas sem confiança. |
| `callWithTrace(service, payload)` | O mesmo, mais uma linha do tempo passo a passo (cotação, escrow aberto, serviço respondeu…), útil para depurar e para UIs. |
| `callSigned(endpoint, payload, { signer, service })` | Chamada assinada pela plataforma, para operadores que têm a chave privada da plataforma. Rápida e fora da cadeia. Veja [Opere sua própria plataforma](/sdk/operar-tu-plataforma). |
| `listRegisteredServices()` | Lê o registro diretamente. |

## Opções relevantes

| Opção | Observações |
|---|---|
| `wallet` / `secret` / `signer` | Precisa ter USDC na rede. |
| `network`, `contractId`, `rpcUrl` | Veja [Configuração](/sdk/configuracion). |
| `trustlessWork.*` <TW /> | API key e endereço da plataforma para o escrow. |
| `discoveryUrl` | Fallback de consulta do registro (`KIBA_DISCOVERY_URL`). |
| `verifyEndpoint` | Confere o `/manifest` com o registro. Veja [Nomes e confiança](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
