---
title: "Serviços externos"
description: "Liste na Kiba uma API que já cobra com x402 ou MPP, sem integrar o SDK."
---

# Serviços externos

Se a sua API já cobra por conta própria com **x402** ou **MPP**, não é preciso integrar o SDK da Kiba. Você a lista com a URL, uma descrição e os parâmetros, e os assistentes a encontram e a chamam como qualquer outro serviço do catálogo.

É o nível leve de publicador: a sua API não muda e o pagamento chega como sempre, direto e na hora.

## Como funciona

1. Você lista a API no painel, em **Serviços externos**.
2. A Kiba pede uma cotação à URL, sem pagar. Só é aceita se responder `402` pedindo pagamento com x402 na Stellar ou com MPP.
3. A API aparece no catálogo dos assistentes com o identificador `ext:<seu-identificador>`.
4. Quando um assistente a chama, a Kiba paga à sua API o preço completo e cobra do usuário esse preço mais a comissão da Kiba.

| | Serviço com SDK | Serviço externo |
|---|---|---|
| Integração | SDK da Kiba | Nenhuma |
| Quem cobra do usuário | Kiba | Kiba |
| Como você recebe | Em lotes, depois do prazo de retenção | Na hora, em cada chamada, com x402 ou MPP |
| Comissão da Kiba | Descontada do seu preço (5 %) | Somada ao seu preço (5 %) |
| Reclamações do usuário | Sim, enquanto durar a retenção | Não: o pagamento já foi feito na rede |

:::info[MPP]
A Kiba paga as APIs de [MPP](/stellar/mpp) que oferecem uma cobrança por chamada em USDC na Stellar. Uma API de MPP que só aceite outra moeda, outra rede ou uma cobrança por sessão fica listada, mas não pode ser chamada.
:::

## O que você precisa

- Uma URL **https** pública.
- Que responda `402` pedindo pagamento com x402 ou com MPP, em **USDC na Stellar** e na mesma rede em que a Kiba opera (testnet hoje).
- Se a API precisar de parâmetros para dar o preço, um valor de exemplo para cada um.

## Listar uma API

No painel, mude para o modo **Publicador** e abra **Serviços externos**.

| Campo | O que colocar |
|---|---|
| Nome | O nome que as pessoas verão. |
| Identificador | Minúsculas, números e hífens. Os assistentes a chamam como `ext:<identificador>`. |
| URL e método | O endereço da API e se é chamada com `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`. |
| Descrição | O que faz e quando usar. É o que o assistente lê para decidir se a chama. |
| Parâmetros | Nome, se vai na URL ou no corpo, descrição, se é obrigatório e um exemplo. |

Ao salvar você verá o preço por chamada que o usuário pagará, já com a comissão.

## Como um assistente a chama

Aparece em `list_agents` com `kind: "external"`, a URL, os parâmetros e `priceUsd`. É chamada com `call_agent`:

```json
{ "service": "ext:clima", "payload": { "city": "Bogota" } }
```

A Kiba coloca cada dado do `payload` onde você declarou: na URL ou no corpo. Se faltar um parâmetro obrigatório, a chamada é rejeitada antes de cobrar.

A resposta traz o resultado da sua API, o custo, a parte que é comissão e o link para a transação.

## API

| Rota | O que faz |
|---|---|
| `GET /v1/external?q=` | Catálogo de serviços externos. `q` filtra por nome e descrição. |
| `GET /v1/publisher/external` | Os que você listou. |
| `POST /v1/publisher/external` | Lista um: `slug`, `name`, `description`, `url`, `method`, `params`. |
| `DELETE /v1/publisher/external/:slug` | Remove um seu. |
| `POST /v1/call` | Chama, com `service: "ext:<slug>"`. |
