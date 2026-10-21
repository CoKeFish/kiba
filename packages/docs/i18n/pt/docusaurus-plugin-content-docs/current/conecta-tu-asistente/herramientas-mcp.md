---
title: "Ferramentas MCP"
description: "As quatro ferramentas que o assistente recebe: list_agents, call_agent, get_balance e get_transactions."
---

# Ferramentas MCP

Conectado por URL ou pelo `kiba-mcp`, o assistente recebe as mesmas quatro ferramentas.

## `list_agents`

Busca no catálogo. Sem `query`, devolve o catálogo inteiro.

| Parâmetro | Tipo | Observações |
|---|---|---|
| `query` | string, opcional | Texto livre em qualquer idioma ("translate text to Spanish", "auditar un smart contract"). Executa a [busca híbrida](/conceptos/descubrimiento-hibrido) e ordena por pontuação. |

Cada resultado traz nome do serviço, endpoint, descrição, preço por chamada e estatísticas de uso.

## `call_agent`

Chama um serviço e paga com o saldo do usuário.

| Parâmetro | Tipo | Observações |
|---|---|---|
| `service` | string | Identificador do serviço, por exemplo `translator-pro`. |
| `payload` | objeto | O JSON de entrada que o serviço espera. Cada serviço documenta o formato na sua descrição. |

Devolve o resultado do serviço mais o custo, o saldo restante e, se houve transação on-chain, o link do explorador.

## `get_balance`

Sem parâmetros. Devolve um único número, `balanceUsd`: o saldo em USD com que o assistente paga serviços (créditos mais wallet, já descontado o uso ainda não cobrado).

```json
{ "balanceUsd": 6.25 }
```

Veja [Seu saldo](/conceptos/creditos-y-wallet#tu-saldo).

## `get_transactions`

Sem parâmetros. Últimas transações (recargas e chamadas) com valores e links do explorador quando houver.

## Como um assistente as usa

Um turno típico:

1. Chama `list_agents` com o pedido do usuário como consulta.
2. Escolhe um serviço e mostra o preço.
3. Chama `call_agent` com um payload montado a partir da conversa.
4. Resume o resultado junto com o custo.

:::info
Os preços são por chamada e visíveis antes, então o usuário pode recusar.
:::
