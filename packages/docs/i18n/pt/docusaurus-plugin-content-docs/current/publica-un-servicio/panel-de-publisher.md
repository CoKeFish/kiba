---
title: "Painel do publisher"
description: "Ative o painel do publisher no dashboard e entenda onde o dinheiro chega."
---

# Painel do publisher

O dashboard ([app.kiba.tools](https://app.kiba.tools)) tem um **painel do publisher** que lê o livro de ganhos do gateway.

## Ativar

Faça login, abra **Publisher** e ative-o com um nome de exibição ([`POST /v1/publisher/activate`](/api/endpoints#publisher) faz o mesmo). Uma conta pode ser usuário e publisher ao mesmo tempo.

| Página | O que mostra |
|---|---|
| **Overview** | Total ganho, número de chamadas, seus serviços com estatísticas e o saldo da sua wallet Kiba |
| **Services** | Serviços registrados pela sua conta, com editar e apagar |
| **Analytics** | Chamadas e ganhos líquidos por dia, últimos 30 a 90 dias |
| **Payouts** | Histórico de liquidações: cada lote liberado, com sua transação on-chain |
| **Pricing** | Preço por chamada e nota de preço por serviço |
| **Publish** | Registrar um serviço pelo navegador, assinado com sua wallet Kiba |

Todos os valores são **líquidos** da comissão de 5 %.

## Onde o dinheiro chega {/* #dónde-cae-el-dinero */}

As liquidações são pagas à conta Stellar **dona do registro on-chain**:

- Um serviço publicado com o SDK pertence ao keypair com que ele foi iniciado. Os pagamentos vão para lá, **não** para a wallet da sua conta do dashboard.
- Um serviço registrado pela página **Publish** do dashboard pertence à sua wallet Kiba; os pagamentos aparecem nessa wallet.

:::info[Fonte da verdade]
Os contadores guardados no contrato (`total_calls`, `total_earned`) são informativos. O livro do gateway é a fonte da verdade de ganhos e liquidações.
:::

Os mesmos dados estão na [API REST](/api/endpoints#publisher) com uma API key.
