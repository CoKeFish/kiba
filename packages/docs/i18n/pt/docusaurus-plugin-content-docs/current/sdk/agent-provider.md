---
title: "AgentProvider"
description: "Oferecer um serviço: opções e métodos do AgentProvider."
---

# `AgentProvider` (oferecer um serviço)

Para um guia passo a passo, veja [Publique um serviço](/publica-un-servicio/quickstart).

## Opções

| Opção | Obrigatória | Observações |
|---|---|---|
| `wallet` / `secret` / `signer` | Uma delas | Identidade Stellar do serviço. `loadOrCreateKeypair(path)` cria e persiste uma. |
| `service` | Sim | Nome único, máx. 32 caracteres. |
| `pricePerCall` | Sim | Preço em USDC. É o piso quando há `priceFn`. |
| `priceFn`, `pricingNote` | Não | [Preço dinâmico](/publica-un-servicio/handler-y-precios#precio-dinámico-por-petición). |
| `description` | Sim | Aparece na busca. Descreva o payload esperado. |
| `endpoint` | Sim | URL pública gravada on-chain. |
| `network`, `contractId`, `rpcUrl` | Veja [Configuração](/sdk/configuracion) | Ajustes de cadeia. |
| `trustlessWork.apiKey`, `trustlessWork.platformAddress` <TW /> | Para escrow | Sem eles, as chamadas com escrow não conseguem liquidar. |
| `platform.publicKey` | Para aceitar chamadas do gateway | Chave pública da plataforma. Omita para exigir escrow em toda chamada. |
| `bodyLimit` | Não | Padrão `256kb`. |
| `rateLimitPerMinute` | Não | Limite na rota de cotação sem pagamento, padrão 60. |
| `allowUnverified` | Não | Só demos locais: servir sem cadeia. |

## Métodos

| Método | O que faz |
|---|---|
| `serve(handler)` | Registra o handler. Só é chamado depois de verificar o pagamento. |
| `bootstrap()` | Financia na testnet, configura a trustline de USDC e registra ou reconcilia a entrada on-chain. |
| `listen(port)` | Servidor express embutido; `provider.app` expõe o app. Veja as [rotas expostas](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado). |
| `verifyAndServe({ body, headers, rawBody, ip })` | Núcleo agnóstico de framework; devolve `{ status, body }`. Veja [Sem express](/publica-un-servicio/despliegue#sin-express). |
