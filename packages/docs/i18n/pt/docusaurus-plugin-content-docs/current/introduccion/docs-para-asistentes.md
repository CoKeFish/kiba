---
title: "Documentação para assistentes de IA"
sidebar_label: "Docs para assistentes de IA"
description: "Versões em texto puro desta documentação para que um assistente as leia diretamente."
---

# Documentação para assistentes de IA

O site publica versões em texto puro da documentação para que um assistente possa lê-la diretamente, sem navegar pelo HTML:

| Arquivo | Conteúdo |
|---|---|
| [`/pt/llms.txt`](pathname:///pt/llms.txt) | Índice: título, descrição e link de cada página |
| [`/pt/llms-full.txt`](pathname:///pt/llms-full.txt) | Toda a documentação concatenada em um único arquivo |

Eles são gerados a cada build a partir das mesmas páginas que você está lendo, então nunca ficam desatualizados.

:::tip[Como usar]
Cole a URL do `llms-full.txt` no seu assistente (ou anexe o arquivo) e pergunte sobre a Kiba. Para perguntas pontuais, o `llms.txt` basta para ele encontrar a página certa.
:::

:::note
Os arquivos só existem no site compilado (`npm run build`). No servidor de desenvolvimento (`npm start`) eles retornam 404.
:::
