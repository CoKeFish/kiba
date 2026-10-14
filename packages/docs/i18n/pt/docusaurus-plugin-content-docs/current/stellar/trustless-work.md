---
title: "Trustless Work"
description: "Escrow e divisão 95/5 de cada pagamento via Trustless Work: como funciona hoje e seu status."
---

# Trustless Work (escrow e divisão)

:::warning[Status: implementado hoje, será substituído por escrows próprios]
Em outubro de 2026 a equipe decidiu deixar a Trustless Work e usar **escrows próprios da Kiba**. Enquanto eles são construídos, o código continua usando a Trustless Work, e esta página descreve o que ele faz **hoje**. Cada lugar desta documentação que depende da Trustless Work tem a etiqueta <TW />.
:::

A [Trustless Work](https://www.trustlesswork.com) é um serviço de escrow não custodial sobre Stellar/Soroban (escrow-as-a-service). A Kiba a usa para o escrow e a divisão de receita de cada pagamento, em USDC, em vez de um contrato de pagamentos próprio.

## Como funciona

API REST (`https://dev.api.trustlesswork.com` na testnet, `https://api.trustlesswork.com` na mainnet) autenticada com o header `x-api-key`. O padrão:

1. Um `POST` devolve uma **transação não assinada** (XDR).
2. Quem chama a **assina** localmente com seu keypair Stellar.
3. `POST /helper/send-transaction` com o XDR assinado a envia para a rede.

A Trustless Work **implanta um contrato por escrow**, então um escrow é identificado pelo seu `contractId` (o SDK o chama de `escrowId`; ele viaja no header `X-PAYMENT`).

## Mapeamento de papéis

| Papel na Trustless Work | Na Kiba |
|---|---|
| `serviceProvider`, `receiver`, `releaseSigner`, `approver` | O dono do serviço (atende e libera para si mesmo) |
| `platformAddress`, `disputeResolver` | A tesouraria da Kiba (recebe o `platformFee`, resolve disputas e reembolsos) |
| Signatário do deploy e do financiamento | Quem paga: a tesouraria (modo crédito) ou a wallet de quem chama (modo direto) |

`platformFee = 5` (%) é a divisão 95/5.

## Ciclo de uma chamada direta

```text
abrir:      POST /deployer/single-release             → assinar → enviar   (→ contractId)
            POST /escrow/single-release/fund-escrow   → assinar → enviar
            (o serviço atende a requisição)
liberar:    POST /escrow/single-release/release-funds → assinar → enviar
reembolso:  fluxo de disputa da Trustless Work, resolvido pelo disputeResolver
```

## Liquidação em lote nas chamadas do gateway

As chamadas pelo gateway **não** abrem um escrow cada uma. A tesouraria financia um **escrow de liquidação por publisher e ciclo** conforme as chamadas acontecem e, periodicamente, o libera e transfere o restante para a wallet do publisher (`release` + `withdraw_remaining_funds`, este último por invocação direta ao contrato porque a API REST da Trustless Work não o expõe). A Trustless Work aplica os 5 % ao liberar.

## Configuração

```bash title=".env"
TRUSTLESS_WORK_API_KEY=                # do BackOffice dApp da Trustless Work
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com
TRUSTLESS_WORK_PLATFORM_ADDRESS=       # tesouraria (platformFee + disputas)
TRUSTLESS_WORK_PLATFORM_FEE=5
TRUSTLESS_WORK_TRUSTLINE_ADDRESS=      # emissor do ativo do escrow (testnet: USDC)
TRUSTLESS_WORK_TRUSTLINE_SYMBOL=USDC
TRUSTLESS_WORK_FEE_ADDRESS=            # wallet de comissão da TW (withdraw_remaining_funds)
```

:::info[Sem API key]
Sem `TRUSTLESS_WORK_API_KEY` o SDK inicia com o escrow desativado: o registro e a descoberta continuam funcionando e qualquer operação de escrow lança um erro claro.
:::

**Obter uma API key:** BackOffice dApp da Trustless Work → criar perfil → gerar a chave da rede alvo. A [documentação da Trustless Work](https://docs.trustlesswork.com) cobre a dApp e a API em detalhe.
