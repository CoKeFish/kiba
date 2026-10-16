---
title: "Deploy"
description: "Publique seu serviço em uma URL HTTPS estável, mantenha a identidade e conheça as rotas que ele expõe."
---

# Deploy

Hospede o processo onde ele tenha uma **URL HTTPS pública e estável** (VPS, plataforma de contêineres, função serverless). Defina `endpoint` (ou `PUBLIC_ENDPOINT`) com essa URL: é o que os clientes chamam e fica gravado on-chain no registro.

## Mantenha a identidade

Persista o arquivo do keypair ou passe o segredo por `AGENT_WALLET_SECRET` (um segredo `S…`) para manter a mesma conta Stellar entre reinícios e novos deploys. Essa conta é o registro dele e onde os ganhos chegam.

## Mudar preço, descrição ou endpoint

Mude a opção e reinicie. Executar `bootstrap()` de novo reconcilia o registro on-chain automaticamente.

## Sem express {/* #sin-express */}

Com Fastify, Hono ou serverless, pule o `listen()` e monte o núcleo agnóstico de framework:

```ts
const { status, body } = await provider.verifyAndServe({
  body,      // JSON já parseado
  headers,   // headers da requisição
  rawBody,   // bytes exatos da requisição (necessários para verificar chamadas assinadas pela plataforma)
  ip,        // para o limite de taxa
});
```

`express` é uma peer dependency opcional; só é necessária para `provider.app` e `provider.listen()`.

## Lista de verificação

- [ ] Endpoint HTTPS público acessível pela internet.
- [ ] Keypair persistido, ou segredo injetado.
- [ ] Definidos para a rede alvo: `STELLAR_CONTRACT_ID`, `KIBA_PLATFORM_PUBLIC_KEY` e, pela Trustless Work, `TRUSTLESS_WORK_API_KEY` e `KIBA_PLATFORM_ADDRESS`. <TW />
- [ ] Relógio do host sincronizado: as chamadas assinadas são rejeitadas se o relógio desviar mais de ~2 minutos.

## Rotas expostas pelo servidor embutido {/* #rutas-que-expone-el-servidor-integrado */}

| Rota | Para quê |
|---|---|
| `POST /service` | O endpoint de pagamento. Sem pagamento responde `402` com uma cotação; com um header `X-PAYMENT` válido ou uma assinatura da plataforma, executa o handler. |
| `GET /manifest` | Nome do serviço, wallet do dono, preço e descrição. Usado pela descoberta e pela [verificação de endpoint](/publica-un-servicio/nombres-y-confianza#verificación-de-endpoint). |
| `GET /health` | Verificação de disponibilidade. |
