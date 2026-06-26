# Remote MCP connector (Claude + ChatGPT)

El gateway expone Kiba como **un servidor MCP remoto sobre Streamable HTTP con
OAuth 2.0**, conectable desde Claude (web, desktop, móvil) y ChatGPT (Developer Mode)
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

Tras el consentimiento, el flujo estándar responde con un **redirect HTTP 302** al
callback del cliente (OAuth 2.1) llevando `code` + `state`. El access token queda
**ligado a la audiencia** (`resource`, RFC 8707): solo es válido contra este `/mcp`.
El flujo stdio local (`/auth/connect`) conserva su página intermedia de loopback.

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

## Conectar ChatGPT (Developer Mode)

Disponible en **todos los planes** (Plus/Pro/Business/Enterprise/Edu) desde el
2025-11-13. El conector usa el mismo MCP + OAuth que Claude.

1. **Settings → Apps & Connectors → Advanced settings** → activar **Developer mode**.
   Aparece un botón **Create** en *Settings → Apps & Connectors*.
2. **Create** → nombre + descripción + URL pública `https://<gateway>/mcp` → **Create**.
   ChatGPT valida la conexión y lista las tools advertidas.
3. ChatGPT descubre el OAuth (DCR + PKCE S256), abre el navegador para login +
   consentimiento del gateway, y al autorizar vuelve por **302** a su callback
   (`https://chatgpt.com/connector/oauth/{id}`).
4. Para usarlo en un chat: **+ → More → seleccionar el conector**.
5. Para publicarlo a todos los usuarios hay que **enviarlo a review** de OpenAI.

> ChatGPT exige **HTTPS** y manda `resource=` en el OAuth (audience binding, RFC 8707),
> que el gateway ya liga y valida. `PUBLIC_URL` debe ser el origen HTTPS real (es el
> `issuer`/`resource`); si queda en localhost, ChatGPT rechaza por issuer mismatch.

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
> público**. Sin deploy, exponé el gateway local con un túnel y reiniciá con el
> `PUBLIC_URL` del túnel:
>
> ```bash
> cloudflared tunnel --url http://localhost:8000   # o: ngrok http 8000
> # con la URL https que te da (ej. https://xxx.trycloudflare.com):
> PUBLIC_URL=https://xxx.trycloudflare.com docker compose up -d gateway
> ```

## Fuera de alcance (siguiente iteración)
- Widgets de UI inline en ChatGPT (`@modelcontextprotocol/ext-apps`).
- Submission a los directorios de Claude y ChatGPT.
- `refresh_token` grant (hoy los access tokens duran 30 días).
