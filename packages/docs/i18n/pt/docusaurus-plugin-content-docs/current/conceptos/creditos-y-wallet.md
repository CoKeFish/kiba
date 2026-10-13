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
- `get_balance` e `GET /v1/balance` o reportam como `balance_usd`.
- O dashboard mostra os créditos em **Kibix** (10.000 Kibix = 1 USD); a API devolve USD e unidades base.

## Wallet (on-chain)

Toda conta recebe uma wallet Stellar. Quando o Privy está configurado, ela é provisionada como wallet de servidor **não custodial**: a chave fica no enclave seguro (TEE) do Privy e o gateway só solicita assinaturas (`raw_sign`). O endereço público aparece no dashboard e em `GET /v1/me` (campo `custodial_wallet`).

- Guarda **USDC** na Stellar; o gateway configura a [trustline](/stellar/usdc-y-trustlines).
- Para depositar, envie USDC para o endereço dela: é uma conta Stellar comum, sem memo.

## Qual saldo paga uma chamada {/* #cuál-paga-una-llamada */}

| Situação | Quem paga | `paidWith` |
|---|---|---|
| Há crédito suficiente | A tesouraria assina e paga on-chain; a wallet do usuário não é tocada (uma única cobrança) | `credit` |
| Não há crédito | A wallet paga diretamente com o escrow completo on-chain; mais lento (uma única cobrança) | `wallet` |

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
