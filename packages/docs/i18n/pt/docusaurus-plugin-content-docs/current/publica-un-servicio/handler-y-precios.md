---
title: "Handler e preços"
description: "O que seu handler recebe, como descrever o payload e como definir preço fixo ou dinâmico."
---

# Handler e preços

## O que seu handler recebe

Ele é chamado **só depois de verificar o pagamento**. Recebe o payload bruto e devolve qualquer valor serializável em JSON.

:::warning[Valide sua própria entrada]
Quem chama, e os modelos de linguagem que o conduzem, podem enviar formatos inesperados.
:::

```ts
provider.serve(async (req: unknown) => {
  const text = String((req as { text?: unknown })?.text ?? '');
  if (!text) throw new Error('field "text" is required');
  /* … */
});
```

O SDK aplica um limite de tamanho de corpo (`bodyLimit`, padrão `256kb`) e um limite de taxa na rota de cotação sem pagamento (`rateLimitPerMinute`, padrão 60).

## Descreva seu payload

Os assistentes montam o payload a partir da **descrição** do serviço. Indique quais campos você espera e em que formato, por exemplo:

```text
Input: { text: string, target: 'es' | 'pt' }. Output: { translation: string }
```

Uma descrição clara significa menos chamadas com falha.

## Preço fixo

`pricePerCall` é o preço em USDC por chamada.

## Preço dinâmico por requisição {/* #precio-dinámico-por-petición */}

Cobre de acordo com a requisição devolvendo um valor em `priceFn`. Se o resultado for menor, ele sobe para `pricePerCall`, que funciona como piso.

```ts
new AgentProvider({
  /* … */
  pricePerCall: 0.001,                 // piso
  priceFn: (req: { text: string }) => 0.001 + req.text.length * 0.00001,
  pricingNote: '0.001 USDC + 0.00001 USDC per character',
});
```

- `priceFn` **precisa ser determinística** em relação ao payload: a mesma entrada deve dar o mesmo preço, para que a cotação e a verificação depois do pagamento coincidam.
- `pricingNote` é mostrada a quem chama junto com o preço.
- A divisão 95/5 escala com o valor cotado.
