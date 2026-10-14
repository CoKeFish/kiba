---
title: "SDK (kiba-sdk)"
sidebar_label: "Visão geral"
description: "Biblioteca TypeScript para publicar serviços ou consumi-los diretamente, de forma autocustodial."
---

# SDK (`kiba-sdk`)

```bash
npm install kiba-sdk
# express é uma peer dependency opcional, só para o servidor HTTP embutido:
npm install express
```

Requer **Node.js 18** ou superior. Versão atual no repositório: `0.1.0`. O SDK é aberto: cada serviço é construído e pertence ao seu publisher; não existe um "serviço Kiba" privilegiado.

## Dois papéis

| Classe | Papel | Página |
|---|---|---|
| **`AgentProvider`** | Você **oferece** um serviço. Verifica o pagamento *antes* de executar seu handler e depois atende e liquida. | [AgentProvider](/sdk/agent-provider) |
| **`AgentClient`** | Você **consome** um serviço. Ele o descobre e cuida do pagamento automaticamente com o handshake x402. | [AgentClient](/sdk/agent-client) |

:::note
As classes mantêm os nomes históricos `Agent*` por estabilidade de API. Servem para qualquer tipo de serviço.
:::

## O que o SDK abstrai

- O registro on-chain (registrar, atualizar, apagar, descobrir) por trás de uma interface `ChainClient`, implementada para Stellar/Soroban (XDR/ScVal com `@stellar/stellar-sdk`).
- <TW /> O ciclo de vida do escrow da Trustless Work (deploy, financiamento, liberação) e as trustlines de USDC.
- O handshake de pagamento: cotações `402`, header `X-PAYMENT`, certificados assinados pela plataforma, proteção contra repetição.
- A inicialização de contas na testnet com friendbot.

## Onde é usado

A mesma biblioteca alimenta o gateway, os serviços de demonstração e o orquestrador: **tudo o que a plataforma faz com um serviço, você pode fazer a partir do seu próprio processo.**

## Nesta seção

- [AgentProvider](/sdk/agent-provider): opções e métodos para oferecer um serviço.
- [AgentClient](/sdk/agent-client): consumir serviços com escrow x402.
- [Opere sua própria plataforma](/sdk/operar-tu-plataforma): assinar chamadas como gateway.
- [Configuração](/sdk/configuracion): opções, variáveis de ambiente e modo degradado.
- [Erros do SDK](/sdk/errores): hierarquia de erros tipados e como tratá-los.
