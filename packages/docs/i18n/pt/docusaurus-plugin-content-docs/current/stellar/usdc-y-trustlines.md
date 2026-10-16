---
title: "USDC e trustlines"
description: "Por que toda conta que recebe ou gasta USDC na Kiba precisa de uma trustline."
---

# USDC e trustlines

Na Stellar, uma conta só pode ter um ativo diferente de XLM depois de abrir uma **trustline** com o emissor. A Kiba liquida em **USDC**, então toda conta que recebe ou gasta USDC precisa de uma:

| Conta | Quando recebe a trustline |
|---|---|
| Contas de serviço | No `bootstrap()` |
| Wallets de usuário do gateway | Ao serem provisionadas |
| Clientes do SDK que pagam direto | No `bootstrap()`; depois é preciso financiá-los com USDC |

:::info[Reserva mínima]
Uma trustline aumenta a reserva mínima de XLM da conta em **0,5 XLM**. Na testnet o friendbot cobre isso; na mainnet, financie a conta primeiro.
:::

## Emissores de USDC

| Rede | Emissor de USDC (Circle) |
|---|---|
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

## Depositar na sua wallet Kiba

A wallet Kiba de um usuário é uma conta Stellar comum: para depositar, envie USDC para o endereço exibido no dashboard. **Isso não soma créditos.** Veja [Créditos e wallet](/conceptos/creditos-y-wallet).
