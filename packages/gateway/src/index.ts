/**
 * Agent Bazaar Gateway — UX layer encima del SDK + smart contract.
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
  signJwt,
  verifyJwt,
} from './auth';
import {
  authorizeSession,
  createOAuthSession,
  exchangeCodeForToken,
  getOAuthSession,
  revokeToken,
} from './oauth';
import { getBalance, getTransactions, lamportsToUsd, topup } from './billing';
import { callOnBehalf, listAgents, masterWalletPubkey } from './proxy';
import { getOnChainBalance, loadUserWallet } from './wallets';
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
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:3020,http://localhost:3010,http://localhost:5173,http://localhost:4321')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Sin origin (curl, server-to-server) → permitido
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} no permitido`));
    },
    credentials: true,
  }),
);
app.use(express.json());
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
  res.json({ ok: true, service: 'agent-bazaar-gateway' });
});

// ─── Signup ────────────────────────────────────────────────────

app.get('/signup', (_req, res) => {
  res.send(signupView());
});

app.post('/signup', (req, res) => {
  const json = wantsJson(req);
  const { email, password } = req.body;
  const fail = (status: number, msg: string) => {
    if (json) return res.status(status).json({ error: msg });
    return res.status(status).send(signupView(msg));
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
        created_at: result.created_at,
      },
    });
  }
  res.redirect('/dashboard');
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

app.get('/dashboard', requireSession, (req, res) => {
  const user = getUser(req.user!.id);
  if (!user) return res.redirect('/logout');

  res.send(
    dashboardView({
      email: user.email,
      balanceUsd: lamportsToUsd(user.balance_lamports),
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
  const codeChallenge = req.query.code_challenge as string;
  const redirectUri = req.query.redirect_uri as string;
  const clientName = (req.query.client_name as string) || 'unknown-client';

  if (!codeChallenge || !redirectUri) {
    return res.status(400).send('Missing code_challenge or redirect_uri');
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

  // Redirige al redirect_uri del MCP con el code
  const url = new URL(session.redirect_uri);
  url.searchParams.set('code', code);
  url.searchParams.set('session', sessionId);

  // Para que el MCP confirme y pida el token, mostramos página intermedia que
  // automáticamente hace fetch al redirect_uri (el MCP local server lo recibe).
  res.send(`<!DOCTYPE html><html><head>
    <title>Autorizado · Agent Bazaar</title>
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
//   API endpoints (Bearer auth)
// ═══════════════════════════════════════════════════════════════

app.get('/v1/me', requireAuth, (req, res) => {
  const user = getUser(req.bearerUser!.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({
    id: String(user.id),
    email: user.email,
    custodial_wallet: user.custodial_wallet_pubkey,
    balance_lamports: user.balance_lamports,
    balance_usd: lamportsToUsd(user.balance_lamports),
    created_at: user.created_at,
  });
});

app.get('/v1/balance', requireAuth, (req, res) => {
  const balance = getBalance(req.bearerUser!.id);
  res.json({ balance_lamports: balance, balance_usd: lamportsToUsd(balance) });
});

/**
 * Estado on-chain de la custodial wallet del user.
 * Útil para mostrar transparencia: lamports reales, no solo USD virtual.
 */
app.get('/v1/wallet', requireAuth, async (req, res) => {
  const user = getUser(req.bearerUser!.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  try {
    const wallet = loadUserWallet(user.id);
    const lamports = await getOnChainBalance(wallet.publicKey);
    res.json({
      pubkey: user.custodial_wallet_pubkey,
      lamports,
      sol: lamports / 1e9,
      master_wallet: masterWalletPubkey(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/v1/agents', requireAuth, async (_req, res) => {
  try {
    const agents = await listAgents();
    res.json(agents);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Agent Bazaar — Gateway                  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Master wallet: ${masterWalletPubkey()}`);
  console.log(`  DB: ${process.env.DB_PATH || '/app/data/gateway.db'}`);
  // touch db to ensure schema applied
  db.pragma('user_version');
});
