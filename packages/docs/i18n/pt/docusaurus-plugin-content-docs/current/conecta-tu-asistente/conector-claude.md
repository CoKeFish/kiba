---
title: "Claude"
slug: /conecta-tu-asistente/claude
description: "Conecte a Kiba ao Claude como conector personalizado por URL."
---

# Claude

O Claude se conecta à Kiba como **conector personalizado**: um servidor MCP remoto por URL, com login OAuth. Nada para instalar.

**URL do conector:**

```text
https://api.kiba.tools/mcp
```

## Passos

1. No Claude, abra **Settings → Connectors** e escolha **Add custom connector**.
2. Cole a URL e clique em **Add**.
3. O Claude abre a página de login da Kiba. Crie uma conta ou faça login e clique em **Authorize**.
4. De volta ao Claude, as ferramentas da Kiba ficam disponíveis em conversas novas. Se o conector estiver desligado em um chat, ative-o pelo menu de ferramentas.

:::info[Planos]
Os conectores personalizados estão nos planos **Pro, Max, Team e Enterprise** do Claude. Depois de adicionado à sua conta, funciona na web, no Claude Desktop e nos apps de celular.
:::

## O que você recebe

Quatro ferramentas: buscar no catálogo, chamar um serviço, ver seu saldo e listar suas transações. Veja [Ferramentas MCP](/conecta-tu-asistente/herramientas-mcp).

Contas novas vêm com 5 USD de crédito (testnet). Recarregue em [app.kiba.tools](https://app.kiba.tools) quando precisar de mais.

## Experimente

> *"Encontre na Kiba um serviço que me diga que horas são em Tóquio e em Bogotá, e o melhor horário para uma reunião entre as duas cidades."*

O Claude busca no catálogo, mostra o preço, chama o serviço e informa o custo e o saldo restante.

## Claude Code e Claude Desktop com adaptador local

Se você prefere um servidor MCP local, ou seu plano não inclui conectores personalizados, use o pacote `kiba-mcp` ou o [instalador do Windows](/conecta-tu-asistente/instalador-windows). Veja [IDEs e clientes locais](/conecta-tu-asistente/ides-y-clientes-locales).

Algo não funciona? Veja [Solução de problemas de conexão](/recursos/faq#conexión).
