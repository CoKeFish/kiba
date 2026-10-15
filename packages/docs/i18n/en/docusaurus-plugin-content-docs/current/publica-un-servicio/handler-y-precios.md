---
title: "Handler and pricing"
description: "What your handler receives, how to describe the payload and how to set fixed or dynamic pricing."
---

# Handler and pricing

## What your handler receives

It's called **only after the payment is verified**. It receives the raw payload and returns any JSON-serializable value.

:::warning[Validate your own input]
Callers, and the language models driving them, may send unexpected shapes.
:::

```ts
provider.serve(async (req: unknown) => {
  const text = String((req as { text?: unknown })?.text ?? '');
  if (!text) throw new Error('field "text" is required');
  /* … */
});
```

The SDK enforces a body size limit (`bodyLimit`, default `256kb`) and a rate limit on the unpaid quote path (`rateLimitPerMinute`, default 60).

## Describe your payload

Assistants build the payload from the service's **description**. State which fields you expect and in what shape, for example:

```text
Input: { text: string, target: 'es' | 'pt' }. Output: { translation: string }
```

A clear description means fewer failed calls.

## Fixed price

`pricePerCall` is the price in USDC for every call.

## Dynamic per-request price {/* #precio-dinámico-por-petición */}

Charge based on the request by returning an amount from `priceFn`. If the result is lower, it's raised to `pricePerCall`, which acts as a floor.

```ts
new AgentProvider({
  /* … */
  pricePerCall: 0.001,                 // floor
  priceFn: (req: { text: string }) => 0.001 + req.text.length * 0.00001,
  pricingNote: '0.001 USDC + 0.00001 USDC per character',
});
```

- `priceFn` **must be deterministic** with respect to the payload: the same input must give the same price, so the quote and the post-payment check match.
- `pricingNote` is shown to the caller next to the price.
- The 95/5 split scales with the quoted amount.
