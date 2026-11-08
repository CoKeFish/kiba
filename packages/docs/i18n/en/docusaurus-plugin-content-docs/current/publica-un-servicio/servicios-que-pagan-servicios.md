---
title: "Services that pay services"
sidebar_label: "Services that pay services"
description: "A Kiba service can hire and pay other services and x402 APIs from its code, with its publisher's balance. The user pays once and sees the whole payment cascade on Stellar."
---

# Services that pay services

A service does not have to know how to do everything. It can **hire other services** from the catalog, or any API that charges with [standard x402](/stellar/x402), and pay them from its own code with its publisher's balance. The user asks for one thing and pays once; Kiba links every payment the service made to that request and shows it in full: who was paid, how much, and the Stellar transaction of each payment.

## What the user sees

The user tells their assistant "give me a brief of this page in Spanish". The assistant calls `web-brief`, which, to fulfil the request:

1. Pays `web-scraper` to read and summarise the page.
2. Pays `translator-pro` to translate the summary.
3. Returns the brief.

The `call_agent` response carries the result, what the user paid and, in `subCalls`, the two payments the service made with their transactions. In the dashboard, the result shows the **Payments made by the service** card with the same cascade and the total the service paid its providers.

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

`subCalls` carry service, status, cost and transaction. Never the bodies of those calls: they belong to the service's account, not the user's.

## How it is written

The handler receives a second argument, the **call context**. Its `kiba` client is already bound to the call the service is serving:

```ts
import { AgentProvider } from 'kiba-sdk';

const agent = new AgentProvider({
  wallet,
  service: 'web-brief',
  pricePerCall: 0.02,
  description: 'A brief of any web page in your language.',
  endpoint: process.env.PUBLIC_ENDPOINT,
  platform: { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY! },
  // The account this service pays its providers with.
  gateway: { url: process.env.KIBA_URL, apiKey: process.env.KIBA_API_KEY },
});

agent.serve(async (req: { url: string; lang: string }, ctx) => {
  const page = await ctx.kiba.call<{ extracted: { summary: string } }>('web-scraper', {
    url: req.url,
    prompt: 'Summarise the page in 5 sentences.',
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

| In the context | What it is |
|---|---|
| `ctx.kiba.call(service, payload)` | Calls a catalog service and pays for it. Returns `result`, `cost`, `resultId` and `explorerUrl`. A slow service is awaited through the saved result, up to `gateway.timeoutMs` (10 minutes by default). |
| `ctx.kiba.callUrl(url, options)` | Pays an API that charges with standard x402 on Stellar, or calls it for free if it does not charge. Accepts `method`, `body`, `headers` and `maxUsd`. |
| `ctx.kiba.balanceUsd()` | The balance the service pays with. |
| `ctx.callId` | The id of the user's call, when it arrives through the Kiba gateway. |
| `ctx.via` | How this call was paid: `platform` (Kiba gateway), `x402` or `escrow`. |

Handlers that take a single argument keep working as before.

## Which account the service pays with

A Kiba account of the publisher: its API key goes in `gateway.apiKey` or in the `KIBA_API_KEY` variable (the same one the `kiba-mcp` connector uses), and the gateway URL in `gateway.url` or `KIBA_URL`. Calls are charged to that account like any other: with credits or with the payment wallet, and they appear in its results and transactions.

The composite service's price is set by its publisher, flat or [dynamic](/publica-un-servicio/handler-y-precios), and it keeps the difference between what it charges and what it pays.

## How payments are linked to the request

1. The gateway hands the service the id of the call it is serving in the `X-Kiba-Call-Id` header, inside the platform-signed call.
2. Everything the service pays with `ctx.kiba` travels with `X-Kiba-Parent-Call` and that id.
3. The gateway links the child call to the parent only if the parent exists and is still in progress. Only the gateway and the service it handed the id to know it.
4. `call_agent`, `get_result`, `GET /v1/results/:id` and the dashboard return the cascade as `subCalls`.

It chains: a service hired by another can in turn pay third parties, and every level is linked to the request that started it.
