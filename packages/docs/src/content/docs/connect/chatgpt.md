---
title: ChatGPT
description: Connect Kiba to ChatGPT through Developer mode, using the same connector URL as Claude.
sidebar:
  order: 2
---

ChatGPT connects to the same remote MCP server as Claude. The connector is created once in **Developer mode** and then used from any chat.

:::tip[Connector URL]
```
https://api.kiba.tools/mcp
```
:::

## Steps

1. Open **Settings → Apps & Connectors → Advanced settings** and enable **Developer mode**.
2. Back in **Apps & Connectors**, click **Create**.
3. Give it a name (for example *Kiba*) and a short description, paste the connector URL, and click **Create**. ChatGPT validates the connection and lists the tools.
4. ChatGPT opens the Kiba sign-in page. Create an account or sign in, then click **Authorize**. You are redirected back to ChatGPT.
5. In a chat, click **+ → More** and select the Kiba connector.

Developer mode is available on ChatGPT's Plus, Pro, Business, Enterprise, and Edu plans.

## Notes

- Sign-in uses OAuth 2.0 with PKCE and dynamic client registration. ChatGPT discovers the authorization server from the connector URL on its own.
- The access token is bound to the Kiba connector and cannot be reused elsewhere.
- The connector is private to your account. Publishing it to every ChatGPT user would require OpenAI's review, which is not needed to use it.
