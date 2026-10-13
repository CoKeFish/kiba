---
title: "Roadmap"
description: "O que já está na main, o que vem a seguir, o que é condicional e o que foi descartado."
---

# Roadmap

Status de cada linha. **O que está marcado como "avaliado" não está implementado.**

## Já na `main`

- Registro on-chain, descoberta híbrida, gateway com OAuth e créditos, conector MCP remoto, `kiba-mcp`, instalador Windows, dashboard com painel do publisher, SDK, liquidação em lote.
- Wallets de usuário não custodiais via Privy (quando `PRIVY_APP_ID`/`PRIVY_APP_SECRET` estão configurados).

## A seguir

| Linha | Detalhe |
|---|---|
| **Mainnet** | Deploy na mainnet com **auditoria prévia do contrato Soroban**. Reposição automática da tesouraria e pool de contas-canal (concorrência) como pendências técnicas. |
| **Rampa fiat na Colômbia** | Recarga COP → USDC por PSE e saque USDC → COP para chave Bre-B. Candidato principal: **VANK** (anchor SEP-10/24/6/12/38; sandbox `dev-stable-anchor.thisisvank.com`; a produção exige certificação com 3 casos, acordo de integração e `stellar.toml` com `SIGNING_KEY`). Alternativa: **Koywe** (PSE na entrada, Bre-B/ACH na saída). Também foram considerados PayU, Cobre, Mono e a API do Nequi. Desafio: risco cambial custodial e exposição regulatória. |
| **Desenvolvimento do ecossistema** | Onboarding de publishers, expansão do catálogo por verticais e primeiros usuários pagantes. |
| **OpenZeppelin Relayer + facilitator x402** (avaliado) | Envia as transações e patrocina as taxas, então o agente não precisa de XLM. Substitui o Launchtube (descontinuado pela SDF). Pacote `@x402/stellar` (x402 v2); facilitator de testnet `channels.openzeppelin.com/x402/testnet`. Se a Kiba liquidar por um mecanismo de escrow próprio, talvez só seja necessária a parte do Relayer. |
| **Privy: validar assinatura Soroban** (avaliado) | Confirmar que assina *auth entries* do Soroban na Stellar (necessário para x402), que suas políticas se aplicam à Stellar e que a assinatura delegada pelo servidor não reintroduz custódia. |
| **Stellar 8004** (avaliado) | Registros de identidade, reputação e validação no Soroban (estilo ERC-8004), na mainnet. Publicar atestados dos serviços e manter os sinais próprios da Kiba (chamadas pagas, reembolsos). SDK `@trionlabs/stellar8004`. |
| **OpenZeppelin Smart Account Kit** (avaliado, depois de validar o Privy) | Regras on-chain para agentes (tetos, chaves de sessão). O kit de integração não é auditado. |
| **Preço dinâmico de mercado** (proposta) | Preço conforme o uso do serviço (1 vez vs. 10) e a oferta e a demanda do marketplace. Não implementado. |
| **REAPP** (em avaliação, fase 2) | Padrão de mandatos para melhorar a orquestração multiagente. É complementar: opera na camada de mandato/autorização; a Kiba é a camada de marketplace por cima. |

## Condicional

| Projeto | Condição |
|---|---|
| <TW /> Trustless Work | Só para tarefas longas com marcos e disputas. Veja [Trustless Work](/stellar/trustless-work). |
| Bazaars x402 (Rail402, AgentSmith, Rumble Fish, Vellar) | Esperar a mainnet. Catálogo automático de serviços pagáveis; eles são listados ao liquidar pelo facilitator deles. A Vellar é testnet e sem auditoria. |

## Descartado por enquanto

| Projeto | Motivo |
|---|---|
| **Reflector** (preços on-chain) | O preço dinâmico depende do uso e da demanda internos, não de preços externos. |
| **Pollar** | Duplica o Privy. |
| **DeFindex / rendimento sobre saldos** | Risco regulatório. |
| **Canais MPP** | A Kiba não tem o problema de custo que eles resolvem. |

## Fora do escopo desta versão

Publishers de terceiros e usuários externos em escala, mainnet, auditoria formal, KYC/AML e SLA. Veja [Status do projeto](/introduccion/estado-del-proyecto).
