/**
 * Adaptador OAuth para el endpoint MCP remoto.
 *
 * El gateway ya tiene un flujo OAuth PKCE propio (oauth.ts) para el cliente
 * stdio. Aquí exponemos lo que el SDK de MCP y los connectors remotos
 * (Claude.ai, ChatGPT Apps) necesitan ADEMÁS, todo aditivo:
 *
 *  - `mcpTokenVerifier`: valida el Bearer en cada request a /mcp. Reutiliza los
 *    mismos tokens OAuth opacos y las API keys sk_live_ que ya valida requireAuth.
 *  - `authServerMetadata` / `protectedResourceMetadata`: documentos de
 *    descubrimiento OAuth 2.0 (RFC 8414 / RFC 9728) que los clientes leen para
 *    auto-configurarse (endpoints + DCR).
 *
 * No usamos el `mcpAuthRouter` del SDK a propósito: ese router es de express 5
 * y el gateway corre express 4. Los endpoints estándar (/authorize, /token,
 * /register) se montan a mano en index.ts sobre express 4.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { db } from './db';
import { getUser } from './auth';
import { getUserByApiKey } from './api-keys';

// Las API keys no expiran (o usan su propio expires_at); requireBearerAuth EXIGE
// un expiresAt numérico, así que les damos una ventana larga sintética.
const API_KEY_VERIFY_TTL = 365 * 24 * 60 * 60;

/** Origin público del gateway, contra el que se valida la audiencia del token. */
function gatewayOrigin(): string {
  try {
    return new URL(process.env.PUBLIC_URL || 'http://localhost:8000').origin;
  } catch {
    return 'http://localhost:8000';
  }
}

/**
 * Verifica un access token (OAuth opaco o API key) y devuelve el AuthInfo que el
 * middleware requireBearerAuth adjunta como `req.auth`. `extra.userId` es lo que
 * usan las tools MCP para actuar a nombre del usuario.
 */
export const mcpTokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Token OAuth emitido por el gateway (PKCE flow).
    const tokenRow = db
      .prepare('SELECT user_id, expires_at, resource FROM oauth_tokens WHERE token = ? AND revoked = 0')
      .get(token) as { user_id: number; expires_at: number; resource: string | null } | undefined;
    if (tokenRow && tokenRow.expires_at > now) {
      // RFC 8707: si el token se ligó a una audiencia (`resource`), su origin debe
      // coincidir con el de este gateway. Comparamos solo el origin (lenient): es
      // robusto ante la ambigüedad origin-vs-/mcp de ChatGPT y los trailing slashes.
      // resource NULL = sin binding (tokens stdio/legacy) → se acepta.
      let resourceUrl: URL | undefined;
      if (tokenRow.resource) {
        try {
          resourceUrl = new URL(tokenRow.resource);
        } catch {
          throw new InvalidTokenError('Invalid token audience');
        }
        if (resourceUrl.origin !== gatewayOrigin()) {
          throw new InvalidTokenError('Token audience mismatch');
        }
      }
      const user = getUser(tokenRow.user_id);
      if (user) {
        return {
          token,
          clientId: 'kiba-oauth',
          scopes: [],
          expiresAt: tokenRow.expires_at,
          resource: resourceUrl,
          extra: { userId: user.id, email: user.email },
        };
      }
    }

    // 2. API key sk_live_ (acceso server-side de larga vida).
    const apiUser = getUserByApiKey(token);
    if (apiUser) {
      const user = getUser(apiUser.id);
      if (user) {
        return {
          token,
          clientId: 'kiba-api-key',
          scopes: [],
          expiresAt: now + API_KEY_VERIFY_TTL,
          extra: { userId: user.id, email: user.email },
        };
      }
    }

    throw new InvalidTokenError('Invalid or expired token');
  },
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Authorization Server Metadata (RFC 8414).
 * Servida en /.well-known/oauth-authorization-server.
 */
export function authServerMetadata(publicUrl: string) {
  const base = trimTrailingSlash(publicUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [] as string[],
  };
}

/**
 * Protected Resource Metadata (RFC 9728).
 * Servida en /.well-known/oauth-protected-resource[/mcp].
 */
export function protectedResourceMetadata(publicUrl: string) {
  const base = trimTrailingSlash(publicUrl);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: [] as string[],
    resource_name: 'Kiba',
  };
}

/** URL del documento de protected-resource-metadata, para el header WWW-Authenticate. */
export function protectedResourceMetadataUrl(publicUrl: string): string {
  return `${trimTrailingSlash(publicUrl)}/.well-known/oauth-protected-resource/mcp`;
}
