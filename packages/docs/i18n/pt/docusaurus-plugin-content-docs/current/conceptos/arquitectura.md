---
title: "Arquitetura"
description: "Os componentes da Kiba, onde ficam e os três canais de integração."
---

# Arquitetura

A Kiba é um conjunto de serviços pequenos em volta de um registro on-chain. Os componentes recebem o nome do **que são**, não de quem os usa.

```mermaid
graph LR
    subgraph clients["Superfícies de cliente"]
        MCP["Servidor MCP<br/>Claude, Cursor, IDEs"]
        SDK["kiba-sdk<br/>Integração direta"]
        DASH["Dashboard (3020)<br/>SPA web"]
    end

    subgraph platform["Serviços da plataforma"]
        BE["Backend (4000)<br/>Descoberta híbrida<br/>FTS5 + embeddings"]
        GW["Gateway (8000)<br/>OAuth, wallets, créditos<br/>liquidação em lote"]
        ORCH["Orquestrador (6001)<br/>Planejador de intenção"]
    end

    subgraph agents["Serviços especializados"]
        A1["serviço 1"]
        A2["serviço 2"]
        A3["serviço N"]
    end

    subgraph chain["Stellar (Soroban) · testnet"]
        SC["Contrato Soroban<br/>Registro de serviços"]
        TW["Trustless Work<br/>Escrow + divisão 95/5 · USDC"]
    end

    MCP -->|OAuth 2.0 PKCE| GW
    DASH -->|cookie de sessão| GW
    SDK -->|autocustodial| TW
    GW -->|chamada assinada| A1
    GW -->|liquidação em lote| TW
    ORCH -->|plano + x402| A2
    BE -.->|indexa o registro| SC
    A1 & A2 & A3 -.->|register_agent| SC
```

<TW /> No diagrama, o escrow e a divisão hoje são a Trustless Work.

## Componentes

| Componente | Papel | Host público |
|---|---|---|
| Gateway | Servidor OAuth 2.0, endpoint MCP remoto, livro de créditos, wallets de usuário, chamadas em nome do usuário, livro do publisher e liquidação em lote | `api.kiba.tools` |
| Backend de descoberta | Indexa o contrato e serve a busca híbrida | `data.kiba.tools` |
| Dashboard | App web para usuários e publishers | `app.kiba.tools` |
| Landing | Site de apresentação | `kiba.tools` |
| Docs | Este site | `docs.kiba.tools` |
| Adaptador MCP (`kiba-mcp`) | Ponte stdio local para clientes sem conector remoto | npm |
| SDK (`kiba-sdk`) | Biblioteca para publicar ou consumir serviços | npm |
| Contrato de registro | Contrato Soroban com uma entrada por serviço | Stellar testnet |
| Orquestrador | Planejador LLM de intenção + executor paralelo (Anthropic SDK); porta 6001, `POST /intent` | Interno |
| <TW /> Trustless Work | Escrow e divisão 95/5 em USDC | Externo |

## Canais de integração

| | Conector MCP | API REST do gateway | SDK |
|---|---|---|---|
| **Empacotamento** | URL, ou `npx kiba-mcp` | HTTPS | npm `kiba-sdk` |
| **Wallet** | Gerenciada pelo gateway | Gerenciada pelo gateway | Seu próprio keypair |
| **Autenticação** | OAuth 2.0 com PKCE | API key ou bearer OAuth | Keypair Stellar |
| **Cobrança** | Créditos em USD | Créditos em USD | Escrow em USDC por chamada |
| **Latência típica** | ~200 ms | ~200 ms | 15 a 150 s |
| **Guia** | [Conecte seu assistente](/conecta-tu-asistente) | [API REST](/api) | [SDK](/sdk) |

Os mesmos endpoints `/v1/*` atendem o dashboard (cookie de sessão), os conectores (bearer OAuth) e os scripts (bearer com API key).
