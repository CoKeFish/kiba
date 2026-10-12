---
title: Authentication
description: API keys for scripts, OAuth 2.0 for connectors, and the discovery endpoints clients use.
sidebar:
  order: 2
---

The gateway accepts three credentials on the same endpoints:

| Credential | For | How |
| --- | --- | --- |
| **API key** | scripts, servers, CI | `Authorization: Bearer sk_live_…` |
| **OAuth 2.0 access token** | MCP connectors (Claude, ChatGPT, `kiba-mcp`) | `Authorization: Bearer <token>` obtained through the PKCE flow |
| **Session cookie** | the dashboard | set by the sign-in form |

## API keys

Create a key in the dashboard under **Credentials**, or with the API once you hold any credential:

```bash
curl -X POST https://api.kiba.tools/v1/api-keys \
  -H "Authorization: Bearer $KIBA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-script"}'
```

The plain key is returned **once**; the gateway stores only a hash. Revoke with `DELETE /v1/api-keys/:id`. Keys do not expire.

## OAuth 2.0 (connectors)

The gateway is an OAuth 2.0 authorization server with PKCE (S256) and dynamic client registration, so MCP clients configure themselves from the connector URL:

| Endpoint | Standard | Purpose |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 | Points the `/mcp` resource at its authorization server |
| `/.well-known/oauth-authorization-server` | RFC 8414 | Lists `authorize`, `token`, `register`, and the supported methods |
| `POST /register` | RFC 7591 | Clients self-register and get a `client_id` |
| `GET /authorize` | OAuth 2.1 + PKCE | Sign-in and consent screen |
| `POST /token` | OAuth 2.1 + PKCE | Exchanges the code for an access token |
| `POST /revoke` | RFC 7009 | Revokes a token |

A request to `/mcp` without a bearer returns `401` with a `WWW-Authenticate` header that points at the resource metadata, which is how a client starts the flow. Access tokens are bound to the `/mcp` resource (RFC 8707) and are valid for 30 days. Authorized apps are listed at `GET /v1/oauth/connections` and disconnected with `DELETE /v1/oauth/connections/:id`.

## MCP endpoint

`POST /mcp` is the remote MCP server (Streamable HTTP) behind the OAuth flow above. It exposes the four [tools](/connect/tools/).
