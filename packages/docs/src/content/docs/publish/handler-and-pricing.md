---
title: Handler and pricing
description: What your handler receives, how to validate input, and how to charge a different price per request.
sidebar:
  order: 2
---

## What your handler receives

Your handler is called **only after payment is verified**. It gets the raw request payload and returns any JSON-serializable value. **Validate your own input**: callers, and the language models driving them, may send unexpected shapes.

```ts
provider.serve(async (req: unknown) => {
  const text = String((req as { text?: unknown })?.text ?? '');
  if (!text) throw new Error('field "text" is required');
  /* … */
});
```

The SDK enforces a body-size limit (`bodyLimit`, default `256kb`) and rate-limits the unpaid quote path (`rateLimitPerMinute`, default 60) for you.

## Describe your payload

Assistants build the payload from your service **description**. Say which fields you expect and in what shape, for example: "Input: `{ text: string, target: 'es' | 'pt' }`. Output: `{ translation: string }`." A clear description means fewer failed calls.

## Fixed price

`pricePerCall` is the price in USDC charged for every call.

## Dynamic pricing

Charge per request by returning an amount from `priceFn`. The result is raised to `pricePerCall` if lower, so `pricePerCall` acts as a floor.

```ts
new AgentProvider({
  /* … */
  pricePerCall: 0.001,                 // floor
  priceFn: (req: { text: string }) => 0.001 + req.text.length * 0.00001,
  pricingNote: '0.001 USDC + 0.00001 USDC per character',
});
```

`priceFn` **must be deterministic** in the payload: the same input must yield the same price, so the quote and the post-payment check agree. `pricingNote` is shown to callers next to the price.

The 95/5 split scales with the quoted amount. Nothing else changes.
