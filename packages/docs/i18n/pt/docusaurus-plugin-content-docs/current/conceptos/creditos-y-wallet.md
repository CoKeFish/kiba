---
title: "Créditos e wallet"
description: "Os dois saldos de uma conta Kiba: créditos fora da cadeia e wallet on-chain."
---

# Créditos e wallet

Toda conta do gateway tem **dois saldos separados**, fáceis de confundir.

:::warning[Eles não se misturam]
Depositar na wallet **não** soma créditos, e recarregar créditos não move USDC para a sua wallet. São independentes.
:::

## Créditos (fora da cadeia)

Saldo em USD no livro do gateway. É o que um assistente gasta ao chamar um serviço.

- Contas novas começam com **5 USD** de crédito (testnet).
- Recarregue pela página **Billing** do dashboard ou com [`POST /v1/topup`](/api/endpoints#cuenta).
- O gasto é imediato e fora da cadeia: é debitado em milissegundos.
- `GET /v1/balance` os reporta como `balance_usd`.
- A API devolve USD e unidades base. No dashboard, valores como recargas, histórico e uso aparecem em **Kibix** (10.000 Kibix = 1 USD).

## Wallet (on-chain)

Toda conta recebe uma wallet Stellar. Quando o Privy está configurado, ela é provisionada como wallet de servidor **não custodial**: a chave fica no enclave seguro (TEE) do Privy e o gateway só solicita assinaturas (`raw_sign`). O endereço público aparece no dashboard e em `GET /v1/me` (campo `custodial_wallet`).

- Guarda **USDC** na Stellar; o gateway configura a [trustline](/stellar/usdc-y-trustlines).
- Para depositar, envie USDC para o endereço dela: é uma conta Stellar comum, sem memo.

## Depósito retirável

Quem prefere pagar com a própria wallet deixa um **depósito** em um canal de pagamento da Stellar. O depósito continua sendo do usuário: a Kiba só cobra o que foi consumido, e o resto pode ser retirado quando o usuário quiser.

- **Depositar.** Em **Billing**, o usuário escolhe um valor e assina uma transação com a sua wallet: a da Kiba com Privy, ou uma externa como Freighter, xBull ou Lobstr. Essa transação cria o canal dele e move o USDC da wallet para o canal. O mínimo é 1 USDC.
- **Recarregar.** Outra transação assinada pelo usuário soma ao depósito.
- **Pagar.** Cada chamada é descontada do depósito na hora, sem assinatura e sem transação na cadeia. A Kiba cobra o consumo do contrato em lotes: quando o pendente chega a 0,10 USDC ou está há dez minutos sem ser cobrado. Uma transação cobre todas as chamadas do lote, e o contrato nunca paga mais do que foi depositado.
- **Retirar.** A Kiba cobra o consumo pendente e o resto volta para a wallet do usuário na mesma transação. O canal é fechado; para continuar pagando com a wallet, abre-se outro.
- **Retirar sem passar pela Kiba.** O usuário solicita a retirada diretamente ao contrato. A Kiba detecta, deixa de aceitar gasto contra esse depósito e cobra o que está pendente. Depois do prazo de espera do canal, de cerca de uma hora, o usuário retira tudo o que sobrar.
- **Sem uso.** Um depósito que passa 90 dias sem depósitos, recargas nem chamadas é devolvido automaticamente: a Kiba cobra o consumo pendente e o resto volta para a wallet. O dashboard avisa 7 dias antes, e qualquer chamada ou recarga reinicia a contagem.

A Kiba paga as taxas de rede de todas essas transações: o usuário não precisa de XLM. Ela também mantém o canal vivo na rede: a Stellar arquiva os contratos cujo prazo de permanência vence, e a Kiba renova esse prazo antes disso, de modo que o depósito está sempre disponível para pagar ou retirar.

O contrato é o [canal de pagamento unidirecional da Stellar](https://github.com/stellar-experimental/one-way-channel), o mesmo usado pelo MPP Session. Há um canal por usuário, criado por uma fábrica. O endereço do canal e cada movimentação aparecem no dashboard com o link para o explorador.

| Endpoint | O que faz |
|---|---|
| `GET /v1/channel` | Estado do depósito: depositado, consumido, disponível e movimentações |
| `POST /v1/channel/open` | Prepara a abertura do canal com o depósito inicial |
| `POST /v1/channel/topup` | Prepara uma recarga |
| `POST /v1/channel/liquidate` | Retira: a Kiba cobra o consumo e o resto volta para a wallet |
| `POST /v1/channel/close-start` | Prepara a solicitação de retirada sem passar pela Kiba |
| `POST /v1/channel/refund` | Prepara a retirada, passado o prazo de espera |

As transações preparadas são assinadas pelo usuário e enviadas com `POST /v1/spend/submit`.

## Seu saldo {/* #tu-saldo */}

O dashboard (barra superior e página **Billing**) e a ferramenta [`get_balance`](/conecta-tu-asistente/herramientas-mcp#get_balance) mostram **um único saldo em USD**: seus créditos mais o que resta para gastar do seu depósito. É o que seu assistente tem para pagar serviços.

- O dashboard trunca o valor em vez de arredondar: nunca mostra mais do que você tem.
- Na API é `total_usd` de [`GET /v1/balance`](/api/endpoints#cuenta).

## Qual saldo paga uma chamada {/* #cuál-paga-una-llamada */}

| Situação | Quem paga | `paidWith` |
|---|---|---|
| Há crédito suficiente | A tesouraria assina e paga on-chain; a wallet do usuário não é tocada (uma única cobrança) | `credit` |
| Não há crédito e há um depósito aberto | O preço é descontado do depósito na hora; a Kiba cobra do canal em lotes | `wallet` |
| Não há crédito nem depósito | A chamada não é feita: recarregue créditos ou abra um depósito | — |

Os publishers recebem **on-chain**, não em créditos.

## Métodos de recarga

Todos em sandbox/teste. São selecionados com `PAYMENT_PROVIDER`; o padrão é `bre-b-sandbox`.

| Método | Detalhe |
|---|---|
| Stripe | Cartão |
| PayPal | Conta PayPal |
| Wompi | PSP colombiano |
| Bre-B | QR ou chave, confirmação manual |
| Depósito de USDC na Stellar | Detecção por memo via Horizon |
