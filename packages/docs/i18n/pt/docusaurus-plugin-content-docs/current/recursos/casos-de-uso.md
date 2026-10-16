---
title: "Casos de uso"
description: "O que dá para fazer com a Kiba como usuário de um assistente e como publisher."
---

# Casos de uso

## Para usuários de um assistente

- **Respostas especializadas dentro de um chat normal.** Peça ao Claude ou ao ChatGPT uma tradução, um preço de mercado, uma revisão de código, uma página extraída ou uma avaliação de risco e deixe que ele pague o especialista que faz isso bem em vez de adivinhar.
- **Um saldo para todas as ferramentas.** Você recarrega uma vez; todos os serviços são pagos com os mesmos créditos, com o preço visível antes de cada chamada e um histórico depois.
- **Sem contas para administrar.** Sem chaves de API para copiar nem assinaturas de uma ferramenta que você precisa uma vez.

## Para publishers

- **Monetizar um modelo ou uma API por chamada.** Envolva-o com o SDK, defina um preço e deixe que todos os assistentes conectados o descubram. Cobrança, descoberta e autenticação são tarefa do trilho.
- **Vender dados.** Indexadores, feeds e datasets cobrados por consulta, com preço dinâmico conforme o tamanho da requisição.
- **Agentes que pagam agentes.** Um serviço pode consumir outros com o SDK, pagando com a própria wallet, sem confiança.
- **Ferramentas internas para os assistentes de uma equipe.** Publique um serviço e aponte os assistentes da equipe para ele; uso e ganhos são registrados por chamada.

## Onde o pagamento por chamada se encaixa

| Setor | Exemplo de serviço |
|---|---|
| Idiomas | Tradução, revisão de localização, transcrição |
| Finanças e cripto | Feeds de preços, busca de rendimento, auditoria de risco de contratos inteligentes |
| Software | Revisão de código, auditoria de dependências, geração de testes |
| Dados | Web scraping, extração de documentos, consulta de entidades |
| Operações | Geocodificação, conversão de fusos horários, agendamento |

Os serviços de demonstração ([`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents)) são modelos funcionais para vários desses casos: `translator-pro`, `yield-hunter`, `risk-auditor`, `price-oracle`, `code-reviewer`, `web-scraper`, `world-clock` e `randomizer`.

## Segmento identificado em entrevistas

Usuários com assinaturas premium de ferramentas (Cursor Ultra, acesso ao Grok) que não têm a experiência ou a motivação para construir agentes, mas pagariam por serviços prontos: **comprar, não construir**.
