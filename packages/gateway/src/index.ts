/**
 * Kiba Gateway — UX layer encima del SDK + smart contract.
 *
 *  - Sign-up + login (email + password)
 *  - Custodial wallet por usuario (transparente)
 *  - Saldo en USD (rate fijo demo, en prod oracle)
 *  - OAuth 2.0 PKCE para MCP clients
 *  - /v1/call que descuenta saldo y llama al SDK por debajo
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { db } from './db';
import {
  authenticate,
  createUser,
  getUser,
  getUserByToken,
  setPublisher,
  signJwt,
  verifyJwt,
} from './auth';
import {
  authorizeSession,
  createOAuthSession,
  exchangeCodeForToken,
  getOAuthClient,
  getOAuthSession,
  refreshAccessToken,
  registerOAuthClient,
  revokeToken,
} from './oauth';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  authServerMetadata,
  mcpTokenVerifier,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from './mcp-oauth';
import { handleMcpRequest } from './mcp';
import { getBalance, getTransactions, lamportsToUsd, topup } from './billing';
import {
  getPaymentProvider,
  getProvider,
  listProviders,
  getCharge as getChargeById,
  verifyCharge as verifyChargeRouted,
  COP_USD_RATE,
} from './payments';
import { callOnBehalf, listAgents, masterWalletPubkey, platformPublicKey } from './proxy';
import { settleAgent, settleAllDue } from './settlement';
import { getMasterWallet, getOnChainBalance, getUserBalances, userOnChainBalance } from './wallets';
import { ASSET, ASSET_USD_RATE, BASE_UNITS_PER_TOKEN } from './chain';
import { BASE_UNIT_NAME } from './wallets';
import { PLATFORM_FEE_BPS, BPS_DENOMINATOR } from '@kiba/sdk';
import {
  deregisterAgent,
  listMyAgents,
  registerAgent,
  updateAgent,
  validateRegisterInput,
  validateUpdateInput,
} from './agents';
import {
  createApiKey,
  getUserByApiKey,
  listApiKeys,
  listOAuthConnections,
  revokeApiKey,
  revokeOAuthByPrefix,
} from './api-keys';
import {
  authorizeView,
  authorizedView,
  dashboardView,
  landingView,
  loginView,
  signupView,
} from './views';

const PORT = Number(process.env.PORT) || 8000;

const app = express();
// CORS con credentials habilitado para los frontends locales (dashboard SPA + landing).
// Express acepta también un origin function que refleja el origin del request si está en allowlist.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:3020,http://localhost:3010,http://localhost:5173,http://localhost:4321,http://localhost:8000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Self-origin: cuando el gateway sirve HTML (consent page, login page) el form
// hace POST al propio gateway. El browser manda Origin = el propio dominio,
// pero no es cross-origin de verdad — los browsers nativamente lo permiten.
// Express cors() no distingue, así que añadimos PUBLIC_URL a la allowlist si
// está seteada para que no se rechace.
const PUBLIC_URL = process.env.PUBLIC_URL;
if (PUBLIC_URL && !ALLOWED_ORIGINS.includes(PUBLIC_URL)) {
  ALLOWED_ORIGINS.push(PUBLIC_URL);
}
// Base URL pública del gateway: issuer en la metadata OAuth y resource del /mcp.
const MCP_ISSUER = (PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

// CORS: allowlist con credentials para los frontends propios. Pero los endpoints
// públicos del connector remoto (discovery OAuth, DCR, token, /mcp) los consumen
// Claude/ChatGPT desde orígenes arbitrarios → CORS permisivo (refleja el origin).
const allowlistCors = cors({
  origin: (origin, cb) => {
    // Sin origin (curl, server-to-server) → permitido
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} no permitido`));
  },
  credentials: true,
});
const mcpPublicCors = cors({
  origin: true, // refleja cualquier origin
  exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'],
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
});
const MCP_PUBLIC_PATHS = [
  /^\/\.well-known\//,
  /^\/register$/,
  /^\/authorize$/,
  /^\/token$/,
  /^\/revoke$/,
  /^\/mcp(?:\/|$)/,
];
app.use((req, res, next) =>
  MCP_PUBLIC_PATHS.some((re) => re.test(req.path))
    ? mcpPublicCors(req, res, next)
    : allowlistCors(req, res, next),
);
// Guarda el cuerpo crudo (req.rawBody) además de parsear JSON: Stripe firma el webhook
// sobre el body EXACTO, así que necesitamos los bytes originales para verificar.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Session middleware ───────────────────────────────────────
interface SessionUser {
  id: number;
  email: string;
}
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      bearerUser?: { id: number; email: string };
    }
  }
}

function loadSession(req: Request, _res: Response, next: NextFunction) {
  const cookie = req.cookies?.session;
  if (!cookie) return next();
  const payload = verifyJwt<SessionUser>(cookie);
  if (payload) req.user = { id: payload.id, email: payload.email };
  next();
}

function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    const next_url = req.originalUrl;
    return res.redirect(`/login?next=${encodeURIComponent(next_url)}`);
  }
  next();
}

/**
 * Auth middleware that accepts EITHER:
 *   - Session cookie (set on /login, used by the dashboard)
 *   - Bearer token (OAuth-issued or API key, used by MCP/SDK clients)
 *
 * Populates req.bearerUser so downstream handlers don't care which path was used.
 */
function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Session cookie (loadSession ran first via app.use)
  if (req.user) {
    req.bearerUser = { id: req.user.id, email: req.user.email };
    return next();
  }
  // 2. Bearer token
  const auth = req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    // Try OAuth-issued tokens first
    let user = getUserByToken(token);
    // Then try API keys (sk_live_*)
    if (!user) {
      const apiUser = getUserByApiKey(token);
      if (apiUser) user = getUser(apiUser.id);
    }
    if (user) {
      req.bearerUser = { id: user.id, email: user.email };
      return next();
    }
  }
  res.status(401).json({ error: 'authentication required' });
}

function wantsJson(req: Request): boolean {
  return req.is('application/json') !== false || req.accepts(['html', 'json']) === 'json';
}

app.use(loadSession);

// ═══════════════════════════════════════════════════════════════
//   Public pages
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.send(landingView(!!req.user));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'kiba-gateway' });
});

// ─── Signup ────────────────────────────────────────────────────

app.get('/signup', (req, res) => {
  res.send(signupView(undefined, req.query.next as string | undefined));
});

app.post('/signup', (req, res) => {
  const json = wantsJson(req);
  const { email, password } = req.body;
  const next_url = (req.query.next as string) || '/dashboard';
  const fail = (status: number, msg: string) => {
    if (json) return res.status(status).json({ error: msg });
    return res.status(status).send(signupView(msg, req.query.next as string | undefined));
  };

  if (!email || !password) return fail(400, 'Email y contraseña requeridos');
  if (password.length < 6) return fail(400, 'Mínimo 6 caracteres');

  const result = createUser(email, password);
  if ('error' in result) return fail(400, result.error);

  const token = signJwt({ id: result.id, email: result.email });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });

  if (json) {
    return res.json({
      user: {
        id: String(result.id),
        email: result.email,
        custodial_wallet: result.custodial_wallet_pubkey,
        balance_lamports: result.balance_lamports,
        is_publisher: !!result.is_publisher,
        publisher_name: result.publisher_name ?? null,
        created_at: result.created_at,
      },
    });
  }
  res.redirect(next_url);
});

// ─── Login ─────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  res.send(loginView(undefined, req.query.next as string | undefined));
});

app.post('/login', (req, res) => {
  const json = wantsJson(req);
  const { email, password } = req.body;
  const next_url = (req.query.next as string) || '/dashboard';
  const user = authenticate(email, password);
  if (!user) {
    if (json) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return res.status(401).send(loginView('Email o contraseña incorrectos', next_url));
  }
  const token = signJwt({ id: user.id, email: user.email });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });

  if (json) {
    return res.json({
      user: {
        id: String(user.id),
        email: user.email,
        custodial_wallet: user.custodial_wallet_pubkey,
        balance_lamports: user.balance_lamports,
        is_publisher: !!user.is_publisher,
        publisher_name: user.publisher_name ?? null,
        created_at: user.created_at,
      },
    });
  }
  res.redirect(next_url);
});

app.get('/logout', (_req, res) => {
  res.clearCookie('session');
  res.redirect('/');
});

app.post('/logout', (_req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// ─── Dashboard ─────────────────────────────────────────────────

app.get('/dashboard', requireSession, async (req, res) => {
  const user = getUser(req.user!.id);
  if (!user) return res.redirect('/logout');

  const balances = await getUserBalances(user.id);

  res.send(
    dashboardView({
      email: user.email,
      creditUsd: balances.creditUsd,
      walletLamports: balances.walletLamports,
      walletSol: balances.walletSol,
      walletUsd: balances.walletUsd,
      totalUsd: balances.totalUsd,
      totalSol: balances.totalSol,
      walletPubkey: user.custodial_wallet_pubkey,
      transactions: getTransactions(user.id),
    }),
  );
});

function handleTopup(req: Request, res: Response) {
  const json = wantsJson(req);
  const amount = Number(req.body.amount ?? req.body.amount_usd);
  const userId = req.bearerUser!.id;

  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
    if (json) return res.status(400).json({ error: 'invalid amount (must be 0 < n <= 1000)' });
    return res.status(400).send('invalid amount');
  }
  // Tope de saldo agregado (créditos virtuales) anti-abuso / drenaje de treasury vía refills.
  const MAX_BALANCE_USD = 10_000;
  if (lamportsToUsd(getBalance(userId)) + amount > MAX_BALANCE_USD) {
    const capMsg = `balance cap exceeded (max $${MAX_BALANCE_USD})`;
    if (json) return res.status(400).json({ error: capMsg });
    return res.status(400).send(capMsg);
  }
  topup(userId, amount);
  const balance = getBalance(userId);

  if (json) {
    return res.json({
      ok: true,
      new_balance_lamports: balance,
      balance_usd: lamportsToUsd(balance),
    });
  }
  res.redirect('/dashboard');
}

app.post('/topup', requireAuth, handleTopup);
app.post('/v1/topup', requireAuth, handleTopup);

// ─── Pagos fiat (Bre-B / PSP) → créditos ──────────────────────────
// Recargas para usuarios locales (Colombia) sin wallet ni web3. El provider
// abstrae la pasarela; hoy corre el sandbox de Bre-B (ver payments.ts).

function chargeToJson(c: import('./payments').Charge) {
  return {
    id: c.id,
    method: c.method,
    reference: c.reference,
    amount_cop: c.amountCop,
    amount_usd: c.amountUsd,
    kibix: c.kibix,
    status: c.status,
    detail: c.detail,
    created_at: c.createdAt,
    paid_at: c.paidAt,
  };
}

app.get('/v1/payments/config', requireAuth, (_req, res) => {
  res.json({
    cop_usd_rate: COP_USD_RATE,
    kibix_per_usd: 10_000,
    // Todos los métodos activos a la vez; el usuario elige en la UI.
    methods: listProviders().map((p) => ({
      provider: p.id,
      label: p.label,
      country: p.country ?? null,
      mode: p.mode, // 'qr' (in-app) | 'redirect' (checkout del PSP)
      sandbox: p.sandbox,
    })),
  });
});

app.post('/v1/payments/breb/charge', requireAuth, async (req, res) => {
  const amountCop = Math.floor(Number(req.body?.amountCop));
  if (!Number.isFinite(amountCop) || amountCop < 1000) {
    return res.status(400).json({ error: 'amountCop must be at least 1000 COP' });
  }
  if (amountCop > 4_000_000) {
    return res.status(400).json({ error: 'amountCop capped at 4,000,000 COP in demo mode' });
  }
  const redirectUrl =
    typeof req.body?.redirectUrl === 'string' ? req.body.redirectUrl : undefined;
  // El cliente elige el método; si no manda, usa el default disponible.
  const providerId =
    typeof req.body?.provider === 'string' && req.body.provider ? req.body.provider : undefined;
  try {
    const provider = providerId ? getProvider(providerId) : getPaymentProvider();
    const charge = await provider.createCharge({ userId: req.bearerUser!.id, amountCop, redirectUrl });
    res.status(201).json(chargeToJson(charge));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    res.status(msg.includes('not available') ? 400 : 500).json({ error: msg });
  }
});

app.get('/v1/payments/charge/:id', requireAuth, (req, res) => {
  const charge = getChargeById(String(req.params.id), req.bearerUser!.id);
  if (!charge) return res.status(404).json({ error: 'charge not found' });
  res.json(chargeToJson(charge));
});

/**
 * Sandbox: simula que el usuario pagó por su app bancaria (representa el webhook
 * del PSP). En producción esto lo dispararía el webhook firmado del PSP, no el cliente.
 */
app.post('/v1/payments/breb/simulate', requireAuth, (req, res) => {
  const chargeId = String(req.body?.chargeId ?? '');
  if (!chargeId) return res.status(400).json({ error: 'chargeId required' });
  // Enruta al provider del PROPIO cobro y exige que sea sandbox: así NO se puede
  // "simular" (auto-acreditar) un cobro real de Stripe/Wompi sin pagar.
  const existing = getChargeById(chargeId, req.bearerUser!.id);
  if (!existing) return res.status(404).json({ error: 'charge not found' });
  const p = getProvider(existing.provider);
  if (!p.sandbox || !p.confirmCharge) {
    return res.status(400).json({ error: 'simulate only available for sandbox charges' });
  }
  try {
    const { charge, newBalanceUsd } = p.confirmCharge(chargeId, req.bearerUser!.id);
    res.json({
      charge: chargeToJson(charge),
      new_balance_usd: newBalanceUsd,
      new_balance_kibix: Math.round(newBalanceUsd * 10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
  }
});

/**
 * Redirect providers (Wompi/Stripe): tras volver del checkout con el id de la
 * transacción/sesión, el front llama aquí para confirmar contra la API del PSP y
 * acreditar si está aprobada. `transactionId` = tx id (Wompi) o session id (Stripe).
 */
app.post(['/v1/payments/verify', '/v1/payments/wompi/verify'], requireAuth, async (req, res) => {
  const chargeId = String(req.body?.chargeId ?? '');
  // providerTxId: tx/session/order id de los redirect providers; vacío para depósitos
  // cripto (Stellar), que se identifican por memo on-chain.
  const providerTxId = String(req.body?.transactionId ?? req.body?.id ?? '');
  if (!chargeId) {
    return res.status(400).json({ error: 'chargeId required' });
  }
  try {
    // Enruta al provider guardado en el cobro (Wompi tx id / Stripe session id / Stellar memo).
    const { charge, newBalanceUsd, status } = await verifyChargeRouted({
      chargeId,
      userId: req.bearerUser!.id,
      providerTxId,
    });
    res.json({
      charge: chargeToJson(charge),
      status,
      new_balance_usd: newBalanceUsd,
      new_balance_kibix: Math.round(newBalanceUsd * 10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
  }
});

/**
 * Webhook firmado del PSP (Wompi `transaction.updated` / Stripe `checkout.session.completed`).
 * Público (sin auth de usuario): la autenticidad la da la firma del PSP (checksum/HMAC sobre
 * el body con el secret). Fuente de verdad para producción; en local el verify por redirect lo cubre.
 */
app.post(
  ['/v1/payments/webhook', '/v1/payments/webhook/wompi', '/v1/payments/webhook/stripe'],
  async (req, res) => {
    // El provider se elige por la ruta (/webhook/stripe → stripe, etc.); el genérico
    // usa el default. Si ese provider no está configurado, 404.
    const fromPath = req.path.endsWith('/stripe')
      ? 'stripe'
      : req.path.endsWith('/wompi')
        ? 'wompi'
        : null;
    let p: import('./payments').PaymentProvider;
    try {
      p = fromPath ? getProvider(fromPath) : getPaymentProvider();
    } catch {
      return res.status(404).json({ error: 'provider not configured' });
    }
    if (!p.handleWebhook) return res.status(404).json({ error: 'no webhook handler' });
    try {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }
      const out = await p.handleWebhook({
        body: req.body,
        rawBody: (req as unknown as { rawBody?: string }).rawBody,
        headers,
      });
      res.status(out.ok ? 200 : 401).json(out);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'unknown error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════
//   OAuth 2.0 PKCE
// ═══════════════════════════════════════════════════════════════

/**
 * GET /auth/connect?code_challenge=X&redirect_uri=Y&client_name=Z
 *
 * MCP cliente abre esto en el browser del usuario.
 * Crea una session, si el usuario está logueado muestra "Authorize?",
 * si no, redirige a login con next.
 */
app.get('/auth/connect', (req, res) => {
  // Normaliza a string: req.query.X puede ser string | string[] | ParsedQs según query parser
  const toStr = (v: unknown, fallback = ''): string => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    return fallback;
  };
  const codeChallenge = toStr(req.query.code_challenge);
  const redirectUri = toStr(req.query.redirect_uri);
  const clientName = toStr(req.query.client_name, 'unknown-client');

  if (!codeChallenge || !redirectUri) {
    return res.status(400).send('Missing code_challenge or redirect_uri');
  }

  // Validación estricta de redirect_uri (anti open-redirect / robo del authorization code).
  // Parseo con WHATWG URL: sin userinfo, esquema http(s), y hostname EXACTO en allowlist
  // (loopback por defecto). 'startsWith' era evadible (http://localhost.evil.com, user@host).
  const allowedRedirectHosts = (process.env.ALLOWED_REDIRECT_ORIGINS ?? 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let redirectOk = false;
  try {
    const u = new URL(redirectUri);
    redirectOk =
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      !u.username &&
      !u.password &&
      allowedRedirectHosts.includes(u.hostname);
  } catch {
    redirectOk = false;
  }
  if (!redirectOk) {
    return res.status(400).send('redirect_uri no permitido');
  }

  const sessionId = createOAuthSession({ codeChallenge, redirectUri, clientName });

  if (!req.user) {
    return res.redirect(`/login?next=/auth/consent?session=${sessionId}`);
  }
  res.redirect(`/auth/consent?session=${sessionId}`);
});

app.get('/auth/consent', requireSession, (req, res) => {
  const sessionId = req.query.session as string;
  const session = getOAuthSession(sessionId);
  if (!session) return res.status(400).send('Invalid or expired session');

  const user = getUser(req.user!.id)!;
  res.send(
    authorizeView({
      clientName: session.client_name,
      email: user.email,
      balanceUsd: lamportsToUsd(user.balance_lamports),
      sessionId,
    }),
  );
});

app.post('/auth/authorize', requireSession, (req, res) => {
  const sessionId = req.body.session_id;
  const session = getOAuthSession(sessionId);
  if (!session) return res.status(400).send('Invalid session');

  const code = authorizeSession(sessionId, req.user!.id);
  if (!code) return res.status(500).send('Failed to authorize');

  // Redirige al redirect_uri del cliente con el code
  const url = new URL(session.redirect_uri);
  url.searchParams.set('code', code);
  // Flujo OAuth estándar (connectors remotos): devolver el `state` recibido.
  if (session.state) url.searchParams.set('state', session.state);

  // Connectors remotos (ChatGPT/Claude): el flujo estándar (GET /authorize) setea
  // client_id en la sesión. OAuth 2.1 exige un redirect HTTP real al callback del
  // cliente, no una página intermedia (un <meta refresh> es frágil y no es lo que
  // espera ChatGPT). El flujo stdio (GET /auth/connect) deja client_id NULL y
  // conserva la página que su server local en loopback intercepta.
  if (session.client_id) {
    return res.redirect(302, url.toString());
  }

  url.searchParams.set('session', sessionId);
  // Para que el MCP local confirme y pida el token, mostramos página intermedia que
  // automáticamente redirige al redirect_uri (el MCP local server lo recibe).
  res.send(`<!DOCTYPE html><html><head>
    <title>Autorizado · Kiba</title>
    <meta http-equiv="refresh" content="0;url=${url.toString()}">
    <style>body{background:#0a0a0a;color:#f5f5f5;font-family:system-ui;text-align:center;padding:80px 20px}h1{color:#14F195}</style>
  </head><body>
    <h1>✓ Autorizado</h1>
    <p>Redirigiendo a tu cliente local...</p>
    <p><a href="${url.toString()}" style="color:#14F195">Click si no redirige automáticamente</a></p>
    <p style="color:#888;margin-top:40px">Puedes cerrar esta pestaña una vez tu cliente confirme.</p>
  </body></html>`);
});

/**
 * POST /oauth/token
 * Body: { code, code_verifier, grant_type: "authorization_code" }
 */
app.post('/oauth/token', (req, res) => {
  const { code, code_verifier, grant_type } = req.body;
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const result = exchangeCodeForToken(code, code_verifier);
  if ('error' in result) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

app.post('/oauth/revoke', (req, res) => {
  const token = req.body.token;
  if (token) revokeToken(token);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//   OAuth estándar + MCP remoto (connectors Claude / ChatGPT)
//   Aditivo: discovery RFC 8414/9728, DCR RFC 7591 y un endpoint
//   Streamable HTTP /mcp. Reutiliza el mismo store de sesiones/tokens,
//   y la pantalla de consentimiento existente (/auth/consent).
// ═══════════════════════════════════════════════════════════════

// Authorization Server Metadata (RFC 8414)
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json(authServerMetadata(MCP_ISSUER));
});

// Protected Resource Metadata (RFC 9728) — describe el recurso /mcp.
const serveProtectedResourceMetadata = (_req: Request, res: Response) => {
  res.json(protectedResourceMetadata(MCP_ISSUER));
};
app.get('/.well-known/oauth-protected-resource', serveProtectedResourceMetadata);
app.get('/.well-known/oauth-protected-resource/mcp', serveProtectedResourceMetadata);

// Dynamic Client Registration (RFC 7591) — Claude/ChatGPT se auto-registran.
app.post('/register', (req, res) => {
  const body = req.body ?? {};
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return res
      .status(400)
      .json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  const client = registerOAuthClient({
    client_name: body.client_name,
    redirect_uris: redirectUris,
    grant_types: body.grant_types,
    response_types: body.response_types,
    scope: body.scope,
    token_endpoint_auth_method: body.token_endpoint_auth_method,
  });
  res.status(201).json({
    client_id: client.client_id,
    client_id_issued_at: client.created_at,
    client_name: client.client_name ?? undefined,
    redirect_uris: JSON.parse(client.redirect_uris),
    grant_types: JSON.parse(client.grant_types ?? '["authorization_code"]'),
    response_types: JSON.parse(client.response_types ?? '["code"]'),
    token_endpoint_auth_method: client.token_endpoint_auth_method ?? 'none',
    scope: client.scope ?? undefined,
  });
});

// Authorization endpoint estándar (response_type=code + PKCE S256).
// Reutiliza la pantalla de consentimiento existente (/auth/consent → /auth/authorize).
app.get('/authorize', (req, res) => {
  const toStr = (v: unknown): string =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '';
  const responseType = toStr(req.query.response_type);
  const clientId = toStr(req.query.client_id);
  const redirectUri = toStr(req.query.redirect_uri);
  const codeChallenge = toStr(req.query.code_challenge);
  const codeChallengeMethod = toStr(req.query.code_challenge_method) || 'S256';
  const state = toStr(req.query.state);
  const resource = toStr(req.query.resource);

  if (responseType !== 'code') {
    return res.status(400).send('unsupported response_type (expected "code")');
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return res.status(400).send('missing client_id, redirect_uri or code_challenge');
  }
  if (codeChallengeMethod !== 'S256') {
    return res.status(400).send('unsupported code_challenge_method (expected "S256")');
  }

  const client = getOAuthClient(clientId);
  if (!client) return res.status(400).send('unknown client_id');
  const registered: string[] = JSON.parse(client.redirect_uris || '[]');
  if (registered.length > 0 && !registered.includes(redirectUri)) {
    return res.status(400).send('redirect_uri not registered for this client');
  }

  const sessionId = createOAuthSession({
    codeChallenge,
    redirectUri,
    clientName: client.client_name ?? clientId,
    state: state || undefined,
    clientId,
    resource: resource || undefined,
  });

  if (!req.user) {
    return res.redirect(`/login?next=/auth/consent?session=${sessionId}`);
  }
  res.redirect(`/auth/consent?session=${sessionId}`);
});

// Token endpoint estándar (authorization_code + PKCE). Reutiliza exchangeCodeForToken.
app.post('/token', (req, res) => {
  const { grant_type, code, code_verifier, refresh_token } = req.body ?? {};

  if (grant_type === 'authorization_code') {
    if (!code || !code_verifier) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const result = exchangeCodeForToken(code, code_verifier);
    if ('error' in result) {
      return res.status(400).json({ error: 'invalid_grant', error_description: result.error });
    }
    return res.json(result);
  }

  // OAuth 2.1: renovación con rotación de refresh token (connectors remotos como
  // Claude renuevan aquí cuando el access expira, sin re-abrir el navegador).
  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const result = refreshAccessToken(refresh_token);
    if ('error' in result) {
      return res.status(400).json(result); // { error: 'invalid_grant' }
    }
    return res.json(result);
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// Token revocation estándar (RFC 7009).
app.post('/revoke', (req, res) => {
  const token = req.body?.token;
  if (token) revokeToken(token);
  res.status(200).json({});
});

// Endpoint MCP remoto (Streamable HTTP). Bearer obligatorio; el 401 incluye
// WWW-Authenticate con resource_metadata para que el cliente descubra el OAuth.
const mcpBearer = requireBearerAuth({
  verifier: mcpTokenVerifier,
  resourceMetadataUrl: protectedResourceMetadataUrl(MCP_ISSUER),
});
app.all('/mcp', mcpBearer, (req, res) => {
  void handleMcpRequest(req, res);
});

// ═══════════════════════════════════════════════════════════════
//   API endpoints (Bearer auth)
// ═══════════════════════════════════════════════════════════════

app.get('/v1/me', requireAuth, async (req, res) => {
  const user = getUser(req.bearerUser!.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const balances = await getUserBalances(user.id);
  res.json({
    id: String(user.id),
    email: user.email,
    custodial_wallet: user.custodial_wallet_pubkey,
    is_publisher: !!user.is_publisher,
    publisher_name: user.publisher_name ?? null,
    // Chain context (preferido para integraciones nuevas).
    asset: balances.asset,
    base_unit_name: balances.baseUnitName,
    balance_base_units: balances.creditBaseUnits,
    balance_usd: balances.creditUsd,
    wallet_base_units: balances.walletBaseUnits,
    wallet_asset_amount: balances.walletAssetAmount,
    wallet_usd: balances.walletUsd,
    total_base_units: balances.totalBaseUnits,
    total_asset_amount: balances.totalAssetAmount,
    total_usd: balances.totalUsd,
    // Legacy (deprecated): mismos valores que los *_base_units / *_asset_amount.
    balance_lamports: balances.creditLamports,
    wallet_lamports: balances.walletLamports,
    wallet_sol: balances.walletSol,
    total_lamports: balances.totalLamports,
    total_sol: balances.totalSol,
    created_at: user.created_at,
  });
});

app.get('/v1/balance', requireAuth, async (req, res) => {
  const balances = await getUserBalances(req.bearerUser!.id);
  res.json({
    asset: balances.asset,
    base_unit_name: balances.baseUnitName,
    balance_base_units: balances.creditBaseUnits,
    balance_usd: balances.creditUsd,
    wallet_base_units: balances.walletBaseUnits,
    wallet_asset_amount: balances.walletAssetAmount,
    wallet_usd: balances.walletUsd,
    total_base_units: balances.totalBaseUnits,
    total_asset_amount: balances.totalAssetAmount,
    total_usd: balances.totalUsd,
    // Legacy (deprecated).
    balance_lamports: balances.creditLamports,
    wallet_lamports: balances.walletLamports,
    wallet_sol: balances.walletSol,
    total_lamports: balances.totalLamports,
    total_sol: balances.totalSol,
  });
});

/**
 * Estado on-chain de la custodial wallet del user.
 * Útil para mostrar transparencia: lamports reales, no solo USD virtual.
 */
app.get('/v1/wallet', requireAuth, async (req, res) => {
  const user = getUser(req.bearerUser!.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  try {
    const baseUnits = await userOnChainBalance(user.id);
    res.json({
      pubkey: user.custodial_wallet_pubkey,
      asset: ASSET,
      base_unit_name: BASE_UNIT_NAME,
      base_units: baseUnits,
      asset_amount: baseUnits / BASE_UNITS_PER_TOKEN,
      master_wallet: masterWalletPubkey(),
      // Legacy (deprecated): mismos valores que base_units / asset_amount.
      lamports: baseUnits,
      sol: baseUnits / BASE_UNITS_PER_TOKEN,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/v1/agents', requireAuth, async (req, res) => {
  try {
    const raw = req.query.q;
    const q =
      typeof raw === 'string' && raw.trim().length > 0
        ? raw.trim()
        : Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0
        ? String(raw[0]).trim()
        : undefined;
    const agents = await listAgents(q);
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Stats agregadas del marketplace + revenue de la plataforma.
 * El balance on-chain de la treasury es la fuente de verdad del revenue;
 * el "estimated_fees_lifetime" se calcula de los agents (sum total_earned * fee/(1-fee))
 * y sirve como sanity check.
 */
app.get('/v1/platform/stats', requireAuth, async (_req, res) => {
  try {
    const [treasuryLamports, agents] = await Promise.all([
      getOnChainBalance(getMasterWallet()),
      listAgents() as Promise<Array<{
        service: string;
        ownerWallet: string;
        pricePerCall: number;
        totalCalls: number;
        totalEarned: number;
        source: 'chain' | 'fallback';
      }>>,
    ]);

    const onChainAgents = agents.filter((a) => a.source === 'chain');
    const totalCalls = onChainAgents.reduce((sum, a) => sum + (a.totalCalls || 0), 0);
    // total_earned ya viene del backend en unidades del activo (SOL o XLM),
    // decoded desde unidades base.
    const totalOwnerEarnedAsset = onChainAgents.reduce((sum, a) => sum + (a.totalEarned || 0), 0);
    // Si owner_amount = amount * (1 - fee_bps/10000), entonces fee = owner_amount * fee_bps / (10000 - fee_bps)
    const estimatedFeesAsset =
      totalOwnerEarnedAsset * (PLATFORM_FEE_BPS / (BPS_DENOMINATOR - PLATFORM_FEE_BPS));
    const totalVolumeAsset = totalOwnerEarnedAsset + estimatedFeesAsset;

    res.json({
      asset: ASSET,
      base_unit_name: BASE_UNIT_NAME,
      treasury: {
        pubkey: masterWalletPubkey(),
        base_units: treasuryLamports,
        asset_amount: treasuryLamports / BASE_UNITS_PER_TOKEN,
        usd: lamportsToUsd(treasuryLamports),
        // Legacy (deprecated): mismos valores que base_units / asset_amount.
        lamports: treasuryLamports,
        sol: treasuryLamports / BASE_UNITS_PER_TOKEN,
      },
      fee: {
        bps: PLATFORM_FEE_BPS,
        pct: PLATFORM_FEE_BPS / 100,
      },
      marketplace: {
        total_agents: agents.length,
        total_agents_on_chain: onChainAgents.length,
        total_calls: totalCalls,
      },
      lifetime: {
        // USD conversion usa ASSET_USD_RATE chain-aware (XLM_USD_RATE o SOL_USD_RATE).
        total_volume_asset: totalVolumeAsset,
        total_volume_usd: totalVolumeAsset * ASSET_USD_RATE,
        owner_earnings_asset: totalOwnerEarnedAsset,
        owner_earnings_usd: totalOwnerEarnedAsset * ASSET_USD_RATE,
        estimated_fees_asset: estimatedFeesAsset,
        estimated_fees_usd: estimatedFeesAsset * ASSET_USD_RATE,
        // Legacy (deprecated): mismos valores que *_asset.
        total_volume_sol: totalVolumeAsset,
        owner_earnings_sol: totalOwnerEarnedAsset,
        estimated_fees_sol: estimatedFeesAsset,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Publisher mode ───────────────────────────────────────────────
// Misma cuenta/login que el consumidor; "publisher" solo habilita las
// superficies de gestión de agentes + ingresos en el dashboard.

app.post('/v1/publisher/activate', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
  const user = setPublisher(req.bearerUser!.id, name);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ is_publisher: true, publisher_name: user.publisher_name ?? null });
});

/**
 * Resumen del publisher: ingresos agregados, # de calls, agentes con sus stats
 * on-chain, y el saldo real de la custodial wallet (donde aterriza el 95%).
 */
app.get('/v1/publisher/overview', requireAuth, async (req, res) => {
  try {
    const userId = req.bearerUser!.id;
    const user = getUser(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const [agents, walletBaseUnits] = await Promise.all([
      listMyAgents(userId),
      userOnChainBalance(userId).catch(() => 0),
    ]);
    const totalCalls = agents.reduce((s, a) => s + (a.totalCalls || 0), 0);
    // totalEarnedSol ya viene en unidades del activo (alias legacy, valor correcto).
    const earnedAsset = agents.reduce((s, a) => s + (a.totalEarnedSol || 0), 0);
    res.json({
      asset: ASSET,
      base_unit_name: BASE_UNIT_NAME,
      is_publisher: !!user.is_publisher,
      publisher_name: user.publisher_name ?? null,
      fee: { bps: PLATFORM_FEE_BPS, pct: PLATFORM_FEE_BPS / 100 },
      totals: {
        agents: agents.length,
        calls: totalCalls,
        earned_asset: earnedAsset,
        earned_usd: earnedAsset * ASSET_USD_RATE,
      },
      wallet: {
        pubkey: user.custodial_wallet_pubkey,
        base_units: walletBaseUnits,
        asset_amount: walletBaseUnits / BASE_UNITS_PER_TOKEN,
        usd: lamportsToUsd(walletBaseUnits),
      },
      agents,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Liquidación BAJO DEMANDA: paga on-chain (vía TW, por lotes) el acumulado de los agentes del
// caller. Respeta SETTLEMENT_MIN_PAYOUT (los que no llegan al mínimo se omiten).
app.post('/v1/publisher/settle', requireAuth, async (req, res) => {
  try {
    const userId = req.bearerUser!.id;
    const agents = await listMyAgents(userId);
    const settlements = [];
    for (const a of agents) {
      settlements.push(await settleAgent(a.service));
    }
    res.json({ settlements });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Agent management (registry CRUD) ─────────────────────────────
// El user firma con su custodial wallet → on-chain queda como owner.

app.get('/v1/agents/mine', requireAuth, async (req, res) => {
  try {
    const agents = await listMyAgents(req.bearerUser!.id);
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/v1/agents', requireAuth, async (req, res) => {
  const input = {
    service: String(req.body?.service ?? '').trim(),
    pricePerCallLamports: Number(req.body?.pricePerCallLamports),
    endpoint: String(req.body?.endpoint ?? '').trim(),
    description: String(req.body?.description ?? '').trim(),
  };
  const err = validateRegisterInput(input);
  if (err) return res.status(400).json({ error: err });

  try {
    const result = await registerAgent(req.bearerUser!.id, input);
    // Publicar un agente convierte al user en publisher (idempotente).
    setPublisher(req.bearerUser!.id);
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    const status = msg.includes('already registered') ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

app.put('/v1/agents/:service', requireAuth, async (req, res) => {
  const service = String(req.params.service).trim();
  const input = {
    pricePerCallLamports:
      req.body?.pricePerCallLamports !== undefined
        ? Number(req.body.pricePerCallLamports)
        : undefined,
    endpoint: req.body?.endpoint !== undefined ? String(req.body.endpoint).trim() : undefined,
    description:
      req.body?.description !== undefined ? String(req.body.description).trim() : undefined,
  };
  if (
    input.pricePerCallLamports === undefined &&
    input.endpoint === undefined &&
    input.description === undefined
  ) {
    return res.status(400).json({ error: 'at least one field required' });
  }
  const err = validateUpdateInput(input);
  if (err) return res.status(400).json({ error: err });

  try {
    const result = await updateAgent(req.bearerUser!.id, service, input);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    const status =
      msg.includes('not found') ? 404 : msg.includes('not the owner') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

app.delete('/v1/agents/:service', requireAuth, async (req, res) => {
  const service = String(req.params.service).trim();
  try {
    const result = await deregisterAgent(req.bearerUser!.id, service);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    const status =
      msg.includes('not found') ? 404 : msg.includes('not the owner') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post('/v1/call', requireAuth, async (req, res) => {
  const { service, payload } = req.body ?? {};
  if (!service) return res.status(400).json({ error: 'service required' });
  // Validación de schema: rechaza campos desconocidos (p.ej. `input` en vez de `payload`) ANTES
  // de cobrar. Sin esto, un campo mal escrito pasaba con payload vacío y cobraba igual.
  const unknownFields = Object.keys(req.body ?? {}).filter((k) => k !== 'service' && k !== 'payload');
  if (unknownFields.length > 0) {
    return res.status(400).json({
      error: `campo(s) no reconocido(s): ${unknownFields.join(', ')}. Los datos del servicio van en 'payload'.`,
    });
  }

  try {
    const result = await callOnBehalf({
      userId: req.bearerUser!.id,
      service,
      payload: payload ?? {},
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: msg });
  }
});

app.get('/v1/transactions', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const txs = getTransactions(req.bearerUser!.id, limit);
  res.json(
    txs.map((t) => ({
      id: String(t.id),
      user_id: String(t.user_id),
      type: t.type,
      amount_lamports: Math.abs(t.amount_lamports),
      service: t.service ?? undefined,
      tx_signature: t.signature ?? undefined,
      status: 'success' as const,
      created_at: t.created_at,
    })),
  );
});

// ─── API Keys (long-lived bearer tokens for direct REST access) ──

app.get('/v1/api-keys', requireAuth, (req, res) => {
  res.json(listApiKeys(req.bearerUser!.id));
});

app.post('/v1/api-keys', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > 64) return res.status(400).json({ error: 'name too long (max 64)' });
  const key = createApiKey(req.bearerUser!.id, name);
  res.json(key);
});

app.delete('/v1/api-keys/:id', requireAuth, (req, res) => {
  const ok = revokeApiKey(req.bearerUser!.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// ─── OAuth connections (apps the user has authorized via PKCE) ────

app.get('/v1/oauth/connections', requireAuth, (req, res) => {
  const conns = listOAuthConnections(req.bearerUser!.id);
  res.json(
    conns.map((c) => ({
      id: c.token.slice(0, 16),
      client_name: c.client_name,
      scope: 'call_agent',
      created_at: c.created_at,
      last_used_at: undefined,
    })),
  );
});

app.delete('/v1/oauth/connections/:id', requireAuth, (req, res) => {
  const ok = revokeOAuthByPrefix(req.bearerUser!.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// ═══════════════════════════════════════════════════════════════

// Guard anti "deploy roto se ve sano": exige config on-chain real en producción.
{
  const onchainId = process.env.STELLAR_CONTRACT_ID;
  if (!onchainId) {
    const warn = '[gateway] Stellar sin STELLAR_CONTRACT_ID — modo degradado: NO se liquida on-chain.';
    if (process.env.NODE_ENV === 'production') throw new Error(`${warn} Requerido en producción.`);
    console.warn(warn);
  } else {
    console.log(`[gateway] on-chain activo: Stellar id=${onchainId.slice(0, 8)}…`);
  }
}

// Railway pipea stdout (sin TTY) → block-buffered → los console.log por-request no se
// vacían. Modo blocking para ver cada log al instante (debug del escrow x402).
try {
  (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true);
  (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true);
} catch {
  /* noop */
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Kiba — Gateway                          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Master wallet: ${masterWalletPubkey()}`);
  console.log(`  Platform auth key (set as KIBA_PLATFORM_PUBLIC_KEY on agents): ${platformPublicKey()}`);
  console.log(`  DB: ${process.env.DB_PATH || '/app/data/gateway.db'}`);
  console.log(`  asset=${ASSET}`);
  // touch db to ensure schema applied
  db.pragma('user_version');
});

// Liquidación PROGRAMADA (opcional): si SETTLEMENT_INTERVAL_MS está seteado, liquida por lotes
// a todos los agentes con acumulado >= mínimo. Vacío = solo bajo demanda (POST /v1/publisher/settle).
const SETTLEMENT_INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS);
if (SETTLEMENT_INTERVAL_MS > 0) {
  setInterval(() => {
    void settleAllDue()
      .then((r) => {
        const paid = r.filter((x) => x.status === 'settled').length;
        if (paid) console.log(`[settlement] lote programado: ${paid} liquidados`);
      })
      .catch((err) => console.error('[settlement] job falló:', (err as Error).message));
  }, SETTLEMENT_INTERVAL_MS);
  console.log(`[settlement] job programado cada ${SETTLEMENT_INTERVAL_MS}ms`);
}
