# Remote MCP connector (Claude + ChatGPT)

El gateway expone Kiba como **un servidor MCP remoto sobre Streamable HTTP con
OAuth 2.0**, conectable desde Claude (web, desktop, móvil) y ChatGPT (Apps SDK)
**sin instalar nada** — solo pegando una URL. Es la misma pieza para ambas
plataformas porque las dos convergieron en MCP + OAuth con descubrimiento
automático.

> El adaptador stdio local (`packages/mcp-server`, `npx kiba-mcp`) sigue
> funcionando igual; esto es aditivo, no lo reemplaza.

## Endpoint

```
https://<gateway>/mcp            # Streamable HTTP MCP (Bearer obligatorio)
```

Tools expuestas: `list_agents`, `call_agent`, `get_balance`, `get_transactions`.

## Descubrimiento OAuth (automático)

Los clientes lo resuelven solos a partir de la URL del MCP. Endpoints publicados:

| Endpoint | Estándar | Para qué |
|---|---|---|
| `/.well-known/oauth-protected-resource[/mcp]` | RFC 9728 | El recurso `/mcp` apunta a su authorization server |
| `/.well-known/oauth-authorization-server` | RFC 8414 | Endpoints OAuth (authorize/token/register) + PKCE S256 |
| `POST /register` | RFC 7591 (DCR) | Claude/ChatGPT se auto-registran (obtienen `client_id`) |
| `GET /authorize` | OAuth 2.1 + PKCE | Login + pantalla de consentimiento existente |
| `POST /token` | OAuth 2.1 + PKCE | Code → access token |
| `POST /revoke` | RFC 7009 | Revocación de token |

Una request a `/mcp` sin Bearer devuelve `401` con
`WWW-Authenticate: Bearer ... resource_metadata="…/.well-known/oauth-protected-resource/mcp"`,
que es como el cliente arranca el flujo.

**Requisito de despliegue:** servir sobre **HTTPS** y setear `PUBLIC_URL` al origen
público (se usa como `issuer` y como `resource`). En Coolify: `PUBLIC_URL=https://<tu-dominio>`.

## Conectar Claude

### Claude.ai (web / móvil) y Claude Desktop — custom connector
1. Settings → **Connectors** → *Add custom connector*.
2. URL: `https://<gateway>/mcp`.
3. Claude descubre el OAuth, abre el navegador, te logueas + autorizas (pantalla de
   consentimiento del gateway), y quedan disponibles las 4 tools.

Disponible en planes Pro/Max/Team/Enterprise. Para aparecer en el **directorio de
Connectors** de Anthropic hace falta review aparte (no bloquea el uso por URL).

## Conectar ChatGPT (Apps SDK)

1. Activar **Developer Mode** en ChatGPT (Settings → Connectors / Apps).
2. *Add MCP server* → URL `https://<gateway>/mcp`.
3. ChatGPT corre DCR + OAuth y expone las tools dentro del chat.
4. Para publicarlo a todos los usuarios hay que **enviarlo a review** de OpenAI.

## Probar localmente (sin deploy)

```bash
# 1) Arrancar el gateway (modo dev, vía tsx)
cd packages/gateway
PORT=8921 PUBLIC_URL=http://localhost:8921 DB_PATH=/tmp/gw.db JWT_SECRET=dev \
  node --import tsx src/index.ts

# 2) Discovery
curl http://localhost:8921/.well-known/oauth-authorization-server
curl http://localhost:8921/.well-known/oauth-protected-resource/mcp

# 3) /mcp sin token → 401 + WWW-Authenticate
curl -i -X POST http://localhost:8921/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 4) Handshake real: crear API key (/v1/api-keys) y usar el
#    @modelcontextprotocol/inspector o el SDK Client con
#    Authorization: Bearer sk_live_… apuntando a http://localhost:8921/mcp
```

> La prueba end-to-end real desde Claude/ChatGPT necesita un endpoint **HTTPS
> público** — se hace después de desplegar el gateway.

## Fuera de alcance (siguiente iteración)
- Widgets de UI inline en ChatGPT (`@modelcontextprotocol/ext-apps`).
- Submission a los directorios de Claude y ChatGPT.
- `refresh_token` grant (hoy los access tokens duran 30 días).
