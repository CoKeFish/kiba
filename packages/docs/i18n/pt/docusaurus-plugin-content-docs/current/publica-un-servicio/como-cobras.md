---
title: "Como você recebe"
description: "As duas rotas pelas quais você recebe, a comissão e onde o dinheiro chega."
---

# Como você recebe

| Rota | Quando | Velocidade | Confiança |
|---|---|---|---|
| **Assinada pela plataforma** | Via gateway Kiba (assistentes, usuários com crédito) | Centenas de ms | Você verifica a assinatura da plataforma; liquidação em lote |
| **Escrow x402** | Quem chama diretamente, sem confiar na plataforma | 15 a 150 s | Totalmente sem confiança, on-chain |

A comissão da plataforma (**5 %**) é aplicada na liquidação. Você recebe o restante em **USDC**, na conta Stellar com que seu serviço foi registrado.

:::warning[Trustless Work]
<TW /> A comissão e a liberação são aplicadas pela Trustless Work. Na mainnet a TW cobra também a própria comissão (0,3 % segundo a nota de integrações de setembro), que se somaria à da Kiba.
:::

Acompanhe seus ganhos no [painel do publisher](/publica-un-servicio/panel-de-publisher). Os detalhes da liquidação em lote estão em [Pagamentos e liquidação](/conceptos/pagos-y-liquidacion#liquidación-por-lotes-gateway).
