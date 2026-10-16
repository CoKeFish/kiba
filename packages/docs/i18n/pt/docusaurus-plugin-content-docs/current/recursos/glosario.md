---
title: "Glossário"
description: "Termos usados na documentação da Kiba."
---

# Glossário

| Termo | Significado |
|---|---|
| **Serviço** | Qualquer agente de IA, API, indexador ou ferramenta que responde requisições por um preço e está registrado na Kiba. |
| **Publisher** | Quem constrói e publica um serviço e cobra por chamada. |
| **Assistente** | Claude, ChatGPT, Cursor, Claude Code ou outro cliente MCP que busca e chama serviços pelo usuário. |
| **MCP (Model Context Protocol)** | Protocolo aberto da Anthropic para que um assistente use ferramentas externas. |
| **x402** | Protocolo de pagamento nativo de HTTP (apresentado pela Coinbase): `402 Payment Required` com uma cotação, pagamento e nova tentativa com prova. |
| **Soroban** | Plataforma de contratos inteligentes da Stellar (Rust). |
| **Contrato de registro** | Contrato Soroban onde cada serviço fica registrado on-chain. |
| **USDC** | Stablecoin em dólar (Circle), ativo de liquidação da Kiba. |
| **Trustline** | Opt-in de uma conta Stellar para poder ter um ativo diferente de XLM. |
| **Unidades base / stroops** | Menor unidade do ativo de liquidação: 1 USDC = 10.000.000. |
| **Créditos** | Saldo em USD no livro do gateway que um assistente gasta. |
| **Kibix** | Unidade de exibição dos créditos no dashboard: 10.000 Kibix = 1 USD. |
| **Wallet** | Conta Stellar do usuário (on-chain), independente dos créditos. |
| **Tesouraria (treasury)** | Conta da plataforma que assina liquidações por crédito e recebe a comissão. |
| **Chamada assinada pela plataforma** | Chamada rápida, fora da cadeia, que o serviço autentica com a chave pública da plataforma. |
| **Escrow x402 (direto)** | Pagamento sem confiança: o cliente financia um escrow que nomeia o serviço como recebedor. |
| **Liquidação em lote** | Pagamento periódico dos ganhos acumulados de um publisher. |
| **Bootstrap** | Etapa do `AgentProvider`/`AgentClient` que financia a conta na testnet, configura a trustline e (provider) registra o serviço. |
| **Friendbot** | Faucet da testnet que financia contas novas com XLM de teste. |
| **FTS5 / BM25** | Busca de texto completo do SQLite e seu ranking por relevância. |
| **Embedding** | Vetor (aqui de 384 dimensões) que representa o significado de um texto para a busca semântica. |
| **PKCE** | Extensão do OAuth que impede o roubo do código de autorização em clientes públicos. |
| **Anchor (Stellar)** | Entidade que converte entre dinheiro local e ativos na Stellar (rampas fiat). |
| **Bre-B / PSE** | Trilhos de pagamento colombianos (chaves instantâneas / débito bancário on-line). |
