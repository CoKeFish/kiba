---
title: "Serviços que pagam serviços"
sidebar_label: "Serviços que pagam serviços"
description: "Um serviço Kiba pode contratar e pagar outros serviços e APIs x402 a partir do seu código, com o saldo do seu publicador. O usuário paga uma vez e vê a cascata completa de pagamentos na Stellar."
---

# Serviços que pagam serviços

Um serviço não precisa saber fazer tudo. Ele pode **contratar outros serviços** do catálogo, ou qualquer API que cobre com [x402 padrão](/stellar/x402), e pagá-los a partir do próprio código com o saldo do seu publicador. O usuário pede uma coisa e paga uma vez; a Kiba liga cada pagamento feito pelo serviço a esse pedido e o mostra completo: a quem pagou, quanto e a transação na Stellar de cada pagamento.

## Como o usuário vê

O usuário pede ao assistente "faça um resumo desta página em espanhol". O assistente chama `web-brief`, que, para atender ao pedido:

1. Paga `web-scraper` para ler e resumir a página.
2. Paga `translator-pro` para traduzir o resumo.
3. Devolve o resumo.

A resposta de `call_agent` traz o resultado, o que o usuário pagou e, em `subCalls`, os dois pagamentos do serviço com as suas transações. No dashboard, o resultado mostra o cartão **Pagamentos do serviço** com a mesma cascata e o total que o serviço pagou aos seus fornecedores.

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

Os `subCalls` trazem serviço, estado, custo e transação. Nunca os corpos dessas chamadas: eles pertencem à conta do serviço, não à do usuário.

## Como se escreve

O handler recebe um segundo argumento, o **contexto da chamada**. O seu cliente `kiba` já vem ligado à chamada que o serviço está atendendo:

```ts
import { AgentProvider } from 'kiba-sdk';

const agent = new AgentProvider({
  wallet,
  service: 'web-brief',
  pricePerCall: 0.02,
  description: 'Resumo de qualquer página web no seu idioma.',
  endpoint: process.env.PUBLIC_ENDPOINT,
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY! },
  // A conta com a qual este serviço paga os seus fornecedores.
  gateway: { url: process.env.KIBA_URL, apiKey: process.env.KIBA_API_KEY },
});

agent.serve(async (req: { url: string; lang: string }, ctx) => {
  const page = await ctx.kiba.call<{ extracted: { summary: string } }>('web-scraper', {
    url: req.url,
    prompt: 'Resuma a página em 5 frases.',
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

| No contexto | O que é |
|---|---|
| `ctx.kiba.call(service, payload)` | Chama um serviço do catálogo e paga por ele. Devolve `result`, `cost`, `resultId` e `explorerUrl`. Se o serviço demora, espera o resultado guardado até `gateway.timeoutMs` (10 minutos por padrão). |
| `ctx.kiba.callUrl(url, opções)` | Paga uma API que cobra com x402 padrão na Stellar, ou a chama de graça se não cobrar. Aceita `method`, `body`, `headers` e `maxUsd`. |
| `ctx.kiba.balanceUsd()` | O saldo com o qual o serviço paga. |
| `ctx.callId` | O id da chamada do usuário, quando chega pelo gateway da Kiba. |
| `ctx.via` | Como esta chamada foi paga: `platform` (gateway da Kiba), `x402` ou `escrow`. |

Os handlers que recebem um único argumento continuam funcionando igual.

## Com qual conta o serviço paga

Com uma conta Kiba do publicador: a sua chave de API vai em `gateway.apiKey` ou na variável `KIBA_API_KEY` (a mesma que o conector `kiba-mcp` usa), e a URL do gateway em `gateway.url` ou `KIBA_URL`. As chamadas são cobradas dessa conta como qualquer outra: com créditos ou com a carteira de pagamentos, e ficam nos seus resultados e transações.

O preço do serviço composto é definido pelo seu publicador, fixo ou [dinâmico](/publica-un-servicio/handler-y-precios), e ele fica com a diferença entre o que cobra e o que paga.

## Como os pagamentos se ligam ao pedido

1. O gateway entrega ao serviço o id da chamada que está atendendo no cabeçalho `X-Kiba-Call-Id`, dentro da chamada assinada pela plataforma.
2. Tudo o que o serviço paga com `ctx.kiba` viaja com `X-Kiba-Parent-Call` e esse id.
3. O gateway liga a chamada filha à chamada pai só se a pai existe e ainda está em andamento. Só o gateway e o serviço que recebeu o id o conhecem.
4. `call_agent`, `get_result`, `GET /v1/results/:id` e o dashboard devolvem a cascata como `subCalls`.

Funciona em cadeia: um serviço contratado por outro pode, por sua vez, pagar terceiros, e cada nível fica ligado ao pedido que o originou.
