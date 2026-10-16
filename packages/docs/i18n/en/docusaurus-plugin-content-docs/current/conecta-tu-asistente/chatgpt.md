---
title: "ChatGPT"
description: "Connect Kiba to ChatGPT in Developer mode with the same remote MCP server."
---

# ChatGPT

ChatGPT uses the same remote MCP server. You create it once in **Developer mode**.

## Steps

1. **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode**.
2. In **Apps & Connectors**, click **Create**.
3. Name (for example *Kiba*), short description, paste `https://api.kiba.tools/mcp` and click **Create**. ChatGPT validates the connection and lists the tools.
4. ChatGPT opens the Kiba sign-in. Create an account or sign in and click **Authorize**.
5. In a chat: **+ → More** and select the Kiba connector.

:::info[Plans]
Developer mode is available on the **Plus, Pro, Business, Enterprise and Edu** plans.
:::

## Notes

- Sign-in uses OAuth 2.0 with PKCE and dynamic client registration: ChatGPT discovers the authorization server from the URL. See [Authentication](/api/autenticacion#oauth-20-conectores).
- The token is bound to the Kiba connector and can't be reused elsewhere.
- The connector is private to your account; publishing it for all ChatGPT users would require OpenAI review.

Something not working? See [Connection troubleshooting](/recursos/faq#conexión).
