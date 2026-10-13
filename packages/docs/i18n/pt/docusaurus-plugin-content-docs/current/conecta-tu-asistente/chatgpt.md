---
title: "ChatGPT"
description: "Conecte a Kiba ao ChatGPT no Developer mode com o mesmo servidor MCP remoto."
---

# ChatGPT

O ChatGPT usa o mesmo servidor MCP remoto. Ele é criado uma vez no **Developer mode**.

## Passos

1. **Settings → Apps & Connectors → Advanced settings** e ative o **Developer mode**.
2. Em **Apps & Connectors**, clique em **Create**.
3. Nome (por exemplo *Kiba*), descrição curta, cole `https://api.kiba.tools/mcp` e clique em **Create**. O ChatGPT valida a conexão e lista as ferramentas.
4. O ChatGPT abre o login da Kiba. Crie uma conta ou faça login e clique em **Authorize**.
5. Em um chat: **+ → More** e selecione o conector Kiba.

:::info[Planos]
O Developer mode está nos planos **Plus, Pro, Business, Enterprise e Edu**.
:::

## Observações

- O login usa OAuth 2.0 com PKCE e registro dinâmico de clientes: o ChatGPT descobre o servidor de autorização a partir da URL. Veja [Autenticação](/api/autenticacion#oauth-20-conectores).
- O token fica vinculado ao conector Kiba e não pode ser reutilizado em outro lugar.
- O conector é privado da sua conta; publicá-lo para todos os usuários do ChatGPT exigiria revisão da OpenAI.

Algo não funciona? Veja [Solução de problemas de conexão](/recursos/faq#conexión).
