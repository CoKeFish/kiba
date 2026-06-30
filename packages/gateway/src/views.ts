/**
 * HTML views simples server-rendered. Inline CSS — sin frameworks.
 */

/** Escapa texto para interpolar de forma segura en HTML (anti-XSS). */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

/* ── Legacy gateway pages (login, signup, dashboard) — original dark theme ── */

const css = `
  * { box-sizing: border-box; }
  body {
    background: #0a0a0a; color: #f5f5f5; font-family: -apple-system, system-ui, sans-serif;
    margin: 0; padding: 0;
  }
  .wrap { max-width: 480px; margin: 60px auto; padding: 0 24px; }
  .wrap-wide { max-width: 720px; margin: 60px auto; padding: 0 24px; }
  h1 { font-size: 32px; margin: 0 0 8px; }
  h1 span { color: #9945FF; }
  h2 { font-size: 20px; margin: 32px 0 16px; }
  p.muted { color: #888; margin: 0 0 24px; }
  .panel {
    background: #141414; border: 1px solid #272727; border-radius: 8px;
    padding: 24px; margin-bottom: 16px;
  }
  label { display: block; font-size: 14px; color: #aaa; margin-bottom: 6px; }
  input[type=email], input[type=password], input[type=text] {
    width: 100%; padding: 10px 12px; background: #0a0a0a; color: #f5f5f5;
    border: 1px solid #272727; border-radius: 4px; font-size: 14px;
  }
  input:focus { outline: none; border-color: #9945FF; }
  button {
    background: #9945FF; color: white; border: 0; padding: 10px 20px;
    border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer;
    margin-top: 12px;
  }
  button:hover { background: #7c34d8; }
  button.secondary { background: transparent; border: 1px solid #272727; }
  button.secondary:hover { border-color: #9945FF; }
  .row { display: flex; gap: 12px; align-items: center; }
  .row > * { flex: 1; }
  a { color: #14F195; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .err { color: #ff6363; font-size: 13px; margin: 12px 0; }
  .ok { color: #14F195; font-size: 13px; margin: 12px 0; }
  .stat-row { display: flex; gap: 16px; }
  .stat { flex: 1; background: #141414; border: 1px solid #272727; border-radius: 8px; padding: 16px; }
  .stat-label { color: #888; font-size: 12px; text-transform: uppercase; }
  .stat-value { font-size: 28px; font-weight: 600; margin-top: 4px; }
  .stat-value.green { color: #14F195; }
  pre.code {
    background: #0a0a0a; border: 1px solid #272727; border-radius: 4px;
    padding: 12px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;
    color: #14F195; font-family: ui-monospace, Menlo, monospace;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #272727; }
  th { color: #888; font-weight: 500; }
  .topup-pill {
    display: inline-block; padding: 6px 16px; border: 1px solid #272727;
    border-radius: 999px; cursor: pointer; margin-right: 8px;
  }
  .topup-pill:hover { border-color: #9945FF; }

  .scopes { list-style: none; padding: 0; margin: 16px 0 0; }
  .scopes li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; color: #d7d7d7; font-size: 14px; }
  .scopes .tick { color: #14F195; font-weight: 700; flex-shrink: 0; }
  .who {
    display: flex; align-items: center; gap: 9px; background: #181818;
    border: 1px solid #242424; border-radius: 10px; padding: 10px 12px;
    margin-bottom: 18px; font-size: 13px; color: #bbb;
  }
  .who .dot { width: 8px; height: 8px; border-radius: 50%; background: #14F195; flex-shrink: 0; }
`;

const layout = (title: string, body: string) => `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Kiba</title>
<style>${css}</style>
</head><body>${body}</body></html>`;

/* ── OAuth consent (/auth/consent) — light theme aligned with dashboard ── */

const consentCss = `
  @import url("https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap");

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    background: #ffffff;
    color: #0b0b12;
    font-family: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  a { color: #6c48ff; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }

  .consent-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .consent-blob {
    position: absolute;
    width: 420px;
    height: 420px;
    bottom: -120px;
    left: -100px;
    border-radius: 50%;
    background: color-mix(in srgb, #6c48ff 28%, transparent);
    filter: blur(60px);
    pointer-events: none;
  }

  .consent-dots {
    position: absolute;
    top: 72px;
    right: 8%;
    width: 120px;
    height: 80px;
    opacity: 0.35;
    background-image: radial-gradient(circle, #c4c0d0 1.5px, transparent 1.5px);
    background-size: 18px 18px;
    pointer-events: none;
  }

  .consent-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 420px;
    background: #fff;
    border: 1px solid color-mix(in srgb, #0b0b12 11%, transparent);
    border-radius: 20px;
    padding: 32px 28px 28px;
    box-shadow:
      0 1px 2px color-mix(in srgb, #0b0b12 4%, transparent),
      0 16px 40px color-mix(in srgb, #0b0b12 6%, transparent);
  }

  .consent-brand img {
    height: 28px;
    width: auto;
    display: block;
    object-fit: contain;
    margin-bottom: 22px;
  }

  .consent-app {
    font-family: "Baloo 2", ui-rounded, system-ui, sans-serif;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 4px;
  }

  .consent-sub {
    color: #8e89a0;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 20px;
  }

  .consent-who {
    display: flex;
    align-items: center;
    gap: 9px;
    background: color-mix(in srgb, #4fa3c7 8%, transparent);
    border: 1px solid color-mix(in srgb, #4fa3c7 18%, transparent);
    border-radius: 12px;
    padding: 10px 12px;
    margin-bottom: 18px;
    font-size: 13px;
    color: #66626f;
  }

  .consent-who .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    flex-shrink: 0;
  }

  .consent-label {
    font-size: 14px;
    color: #66626f;
    margin: 0 0 8px;
    font-weight: 600;
  }

  .consent-scopes {
    list-style: none;
    padding: 0;
    margin: 0 0 4px;
  }

  .consent-scopes li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 0;
    color: #66626f;
    font-size: 14px;
    line-height: 1.45;
    border-bottom: 1px solid color-mix(in srgb, #0b0b12 8%, transparent);
  }

  .consent-scopes li:last-child { border-bottom: 0; }
  .consent-scopes .tick { color: #22c55e; font-weight: 700; flex-shrink: 0; }

  .consent-btn-primary {
    width: 100%;
    margin-top: 20px;
    padding: 13px;
    border-radius: 999px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    border: 0;
    background: linear-gradient(135deg, #4fa3c7 0%, #6c48ff 100%);
    box-shadow: 0 8px 28px color-mix(in srgb, #4fa3c7 35%, transparent);
  }

  .consent-btn-primary:hover { opacity: 0.92; }

  .consent-btn-ghost {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 12px;
    border-radius: 999px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    text-decoration: none;
    background: #fff;
    color: #6c48ff;
    border: 1.5px solid color-mix(in srgb, #6c48ff 55%, transparent);
  }

  .consent-btn-ghost:hover {
    background: color-mix(in srgb, #6c48ff 8%, transparent);
    text-decoration: none;
  }

  .consent-foot {
    text-align: center;
    color: #8e89a0;
    font-size: 13px;
    margin: 18px 0 0;
    line-height: 1.45;
  }
`;

const consentLayout = (title: string, body: string) => `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/favicon.png" />
<title>${escapeHtml(title)} · Kiba</title>
<style>${consentCss}</style>
</head><body>${body}</body></html>`;

/* ── Auth pages (login / signup) — light theme aligned with dashboard ── */

const authLayout = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="stylesheet" href="/auth.css" />
<title>${escapeHtml(title)} · Kiba</title>
</head><body>${body}</body></html>`;

const ICON_MAIL = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;

const ICON_LOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

const ICON_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const ICON_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

const TITLE_SPARKS = `<svg class="auth-sparks" viewBox="0 0 22 18" fill="none" aria-hidden="true"><path d="M11 10V3" stroke="#ffd54a" stroke-width="2.5" stroke-linecap="round"/><path d="M11 10L17 6" stroke="#ffd54a" stroke-width="2.5" stroke-linecap="round"/><path d="M11 10L15 16" stroke="#ffd54a" stroke-width="2.5" stroke-linecap="round"/></svg>`;

const AUTH_PW_TOGGLE_SCRIPT = `<script>
(function(){
  document.querySelectorAll('[data-pw-toggle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var wrap = btn.closest('.auth-input-wrap');
      var input = wrap && wrap.querySelector('input');
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      var open = btn.querySelector('[data-eye-open]');
      var closed = btn.querySelector('[data-eye-closed]');
      if (open && closed) { open.hidden = !show; closed.hidden = show; }
    });
  });
})();
</script>`;

function authPasswordToggle(): string {
  return `<button type="button" class="auth-input-toggle" data-pw-toggle aria-label="Show password">
    <span data-eye-closed>${ICON_EYE}</span>
    <span data-eye-open hidden>${ICON_EYE_OFF}</span>
  </button>`;
}

function authEmailField(): string {
  return `<div class="auth-field">
    <label class="auth-label" for="email">Email</label>
    <div class="auth-input-wrap">
      <span class="auth-input-icon">${ICON_MAIL}</span>
      <input id="email" class="auth-input" type="email" name="email" autocomplete="email" required placeholder="you@example.com">
    </div>
  </div>`;
}

function authPasswordField(opts: { autocomplete: string; placeholder: string; minlength?: number }): string {
  const minAttr = opts.minlength ? ` minlength="${opts.minlength}"` : '';
  return `<div class="auth-field">
    <label class="auth-label" for="password">Password</label>
    <div class="auth-input-wrap">
      <span class="auth-input-icon">${ICON_LOCK}</span>
      <input id="password" class="auth-input" type="password" name="password" autocomplete="${opts.autocomplete}" required${minAttr} placeholder="${escapeHtml(opts.placeholder)}">
      ${authPasswordToggle()}
    </div>
  </div>`;
}

function authShell(opts: {
  headerPrompt: string;
  headerLinkLabel: string;
  headerLinkHref: string;
  headerLinkAccent?: boolean;
  mascot: 'heart' | 'triangle';
  body: string;
}): string {
  const mascot =
    opts.mascot === 'heart'
      ? `<img src="/agents/heart-peek.png" alt="" class="auth-mascot auth-mascot--heart" width="140" height="140" aria-hidden="true" />`
      : `<img src="/agents/triangle.png" alt="" class="auth-mascot auth-mascot--triangle" width="165" height="165" aria-hidden="true" />`;
  const accentClass = opts.headerLinkAccent ? ' auth-header-btn--accent' : '';

  return `<div class="auth-page">
  <div class="auth-blob auth-blob--purple" aria-hidden="true"></div>
  <div class="auth-dots" aria-hidden="true"></div>
  <header class="auth-header">
    <a href="/" class="auth-brand" aria-label="Kiba home">
      <img src="/logo.png" alt="Kiba" class="auth-brand-logo" />
    </a>
    <div class="auth-header-cta">
      <span class="auth-header-prompt">${escapeHtml(opts.headerPrompt)}</span>
      <a href="${escapeHtml(opts.headerLinkHref)}" class="auth-header-btn${accentClass}">${escapeHtml(opts.headerLinkLabel)}</a>
    </div>
  </header>
  <main class="auth-main">
    <div class="auth-scene">
      <div class="auth-card-wrap">
        ${mascot}
        ${opts.body}
      </div>
    </div>
  </main>
  <footer class="auth-footer">
    <span>© 2024 Kiba Technologies, Inc.</span>
    <span class="auth-footer-sep" aria-hidden="true">•</span>
    <a href="#">Privacy</a>
    <span class="auth-footer-sep" aria-hidden="true">•</span>
    <a href="#">Terms</a>
  </footer>
</div>
${AUTH_PW_TOGGLE_SCRIPT}`;
}


export function landingView(loggedIn: boolean): string {
  return layout(
    'Kiba',
    `<div class="wrap-wide">
      <h1>Kiba</h1>
      <p class="muted">Marketplace descentralizado de agentes IA con pagos x402 en Solana</p>

      <div class="panel">
        <h2 style="margin-top:0">¿Cómo funciona?</h2>
        <p>1. Crea cuenta · 2. Carga saldo con tarjeta · 3. Conecta tu agente IA</p>
        <p>Tu agente paga automáticamente a otros agentes especializados con micro-pagos en Solana.</p>
        <p>Tú nunca tocas cripto. El gateway custodia una wallet por ti y firma las transacciones.</p>
      </div>

      <div class="row">
        ${loggedIn
          ? '<a href="/dashboard"><button>Ir a mi dashboard</button></a>'
          : '<a href="/signup"><button>Crear cuenta</button></a><a href="/login"><button class="secondary">Ya tengo cuenta</button></a>'
        }
      </div>
    </div>`,
  );
}

export function signupView(error?: string, next?: string): string {
  const action = next ? `/signup?next=${encodeURIComponent(next)}` : '/signup';
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const card = `<div class="auth-card">
    <div class="auth-title-wrap">
      <h1 class="auth-title">
        <span class="auth-title-create">
          Create
          <svg class="auth-squiggle" viewBox="0 0 72 12" aria-hidden="true"><path d="M2 9 C14 2, 28 10, 42 5 S62 7, 70 4"/></svg>
        </span>
        <span class="auth-title-account"> account${TITLE_SPARKS}</span>
      </h1>
    </div>
    <p class="auth-subtitle">Start calling agents in seconds.</p>
    <form method="POST" action="${action}">
      ${authEmailField()}
      ${authPasswordField({ autocomplete: 'new-password', placeholder: '8+ characters', minlength: 6 })}
      ${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ''}
      <button type="submit" class="auth-submit">Create account →</button>
      <div class="auth-divider">
        <span class="auth-divider-line"></span>
        <span class="auth-divider-text">or</span>
        <span class="auth-divider-line"></span>
      </div>
      <p class="auth-footer-link">Already have an account? <a href="${loginHref}">Log in</a></p>
    </form>
  </div>`;

  return authLayout(
    'Create account',
    authShell({
      headerPrompt: 'Already have an account?',
      headerLinkLabel: 'Log in',
      headerLinkHref: loginHref,
      mascot: 'triangle',
      body: card,
    }),
  );
}

export function loginView(error?: string, next?: string): string {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : '/signup';
  const connecting = !!next && next.includes('/auth/consent');
  const subtitle = connecting
    ? 'Log in to authorize the connection with your Kiba account.'
    : 'Log in to your Kiba account.';

  const card = `<div class="auth-card">
    <div class="auth-title-wrap">
      <h1 class="auth-title">
        <span class="auth-title-create">
          Wel
          <svg class="auth-squiggle auth-squiggle--short" viewBox="0 0 52 12" aria-hidden="true"><path d="M2 9 C12 2, 22 10, 32 5 S44 7, 50 4"/></svg>
        </span>
        come
        <span class="auth-title-account">
          bac<span class="auth-title-k">k${TITLE_SPARKS}</span>
        </span>
      </h1>
    </div>
    <p class="auth-subtitle">${escapeHtml(subtitle)}</p>
    <form method="POST" action="${action}">
      ${authEmailField()}
      ${authPasswordField({ autocomplete: 'current-password', placeholder: 'Enter your password' })}
      <p class="auth-forgot-wrap"><a href="#" class="auth-forgot">Forgot password?</a></p>
      ${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ''}
      <button type="submit" class="auth-submit">Sign in →</button>
      <div class="auth-divider">
        <span class="auth-divider-line"></span>
        <span class="auth-divider-text">or</span>
        <span class="auth-divider-line"></span>
      </div>
      <p class="auth-footer-link">No account? <a href="${signupHref}">Sign up free</a></p>
    </form>
  </div>`;

  return authLayout(
    'Log in',
    authShell({
      headerPrompt: 'New to Kiba?',
      headerLinkLabel: 'Sign up free',
      headerLinkHref: signupHref,
      headerLinkAccent: true,
      mascot: 'heart',
      body: card,
    }),
  );
}

interface DashboardData {
  email: string;
  creditUsd: number;
  walletLamports: number;
  walletSol: number;
  walletUsd: number;
  totalUsd: number;
  totalSol: number;
  walletPubkey: string;
  transactions: { type: string; amount_lamports: number; service: string | null; created_at: number }[];
}

export function dashboardView(data: DashboardData): string {
  const txRows = data.transactions
    .slice(0, 20)
    .map((t) => {
      const date = new Date(t.created_at * 1000).toLocaleString();
      const sign = t.type === 'topup' ? '+' : '-';
      const usd = (Math.abs(t.amount_lamports) / 1e9 * 150).toFixed(4);
      return `<tr><td>${date}</td><td>${t.type}${t.service ? ` · ${t.service}` : ''}</td><td>${sign}$${usd}</td></tr>`;
    })
    .join('');

  return layout(
    'Dashboard',
    `<div class="wrap-wide">
      <h1>Dashboard</h1>
      <p class="muted">${escapeHtml(data.email)} · <a href="/logout">cerrar sesión</a></p>

      <div class="stat-row" style="margin-bottom:12px">
        <div class="stat">
          <div class="stat-label">Total disponible</div>
          <div class="stat-value green">$${data.totalUsd.toFixed(2)}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">${data.totalSol.toFixed(4)} SOL</div>
        </div>
        <div class="stat">
          <div class="stat-label">Crédito USD</div>
          <div class="stat-value">$${data.creditUsd.toFixed(2)}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">se gasta primero</div>
        </div>
        <div class="stat">
          <div class="stat-label">Saldo wallet on-chain</div>
          <div class="stat-value">${data.walletSol.toFixed(4)} <span style="font-size:14px;color:#888">SOL</span></div>
          <div class="muted" style="font-size:12px;margin-top:4px">≈ $${data.walletUsd.toFixed(2)}</div>
        </div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Recargar crédito (mockup)</h2>
        <p class="muted">Demo: en producción sería Stripe Checkout. Aquí simula carga directa al crédito USD.</p>
        <form method="POST" action="/topup">
          <span class="topup-pill"><label><input type="radio" name="amount" value="5" checked> $5</label></span>
          <span class="topup-pill"><label><input type="radio" name="amount" value="10"> $10</label></span>
          <span class="topup-pill"><label><input type="radio" name="amount" value="25"> $25</label></span>
          <button type="submit">Cargar (demo)</button>
        </form>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Fondear tu wallet on-chain</h2>
        <p class="muted">¿Prefieres usar tu propia SOL? Envía desde Phantom/Solflare a la dirección de tu wallet custodia. Una vez confirmada, su saldo se gasta automáticamente cuando se acabe el crédito USD.</p>
        <label style="margin-top:8px">Tu wallet custodia (devnet)</label>
        <div class="row" style="align-items:stretch">
          <input type="text" id="wallet-pubkey" readonly value="${escapeHtml(data.walletPubkey)}" style="flex:3;font-family:ui-monospace,Menlo,monospace;font-size:12px">
          <button type="button" onclick="copyWallet()" class="secondary" style="flex:1;margin-top:0">Copiar</button>
          <a href="/dashboard" style="flex:1"><button type="button" class="secondary" style="width:100%;margin-top:0">Refrescar</button></a>
        </div>
        <p class="muted" style="margin-top:12px;font-size:12px">⚠ Esta es una wallet de devnet. Cualquier SOL enviado a otra red se perderá.</p>
        <script>
          function copyWallet() {
            const el = document.getElementById('wallet-pubkey');
            el.select();
            navigator.clipboard.writeText(el.value);
            event.target.textContent = '✓ Copiado';
            setTimeout(() => { event.target.textContent = 'Copiar'; }, 1500);
          }
        </script>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Conectar tu agente IA</h2>
        <p class="muted">Para Claude Code, Cursor, o cualquier IDE con MCP support, agrega:</p>
        <pre class="code">{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"]
    }
  }
}</pre>
        <p class="muted">Cuando arranques tu IDE, te abrirá una página para autorizar este MCP a usar tu cuenta. Cero API keys, cero copy-paste.</p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Historial reciente</h2>
        ${data.transactions.length === 0
          ? '<p class="muted">No hay transacciones aún.</p>'
          : `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th></tr></thead><tbody>${txRows}</tbody></table>`
        }
      </div>
    </div>`,
  );
}

/** OAuth consent — external auth window (ChatGPT, Cursor, MCP). */
export function authorizeView(data: {
  clientName: string;
  email: string;
  balanceUsd: number;
  sessionId: string;
}): string {
  return consentLayout(
    'Autorizar acceso',
    `<div class="consent-page">
      <div class="consent-blob" aria-hidden="true"></div>
      <div class="consent-dots" aria-hidden="true"></div>
      <div class="consent-card">
        <div class="consent-brand"><img src="/logo.png" alt="Kiba" /></div>
        <h1 class="consent-app">${escapeHtml(data.clientName)}</h1>
        <p class="consent-sub">quiere conectarse a tu cuenta de Kiba</p>
        <div class="consent-who"><span class="dot"></span> ${escapeHtml(data.email)} · Saldo $${data.balanceUsd.toFixed(2)}</div>
        <p class="consent-label">Esta aplicación podrá:</p>
        <ul class="consent-scopes">
          <li><span class="tick">✓</span> Descubrir y llamar agentes en tu nombre</li>
          <li><span class="tick">✓</span> Descontar micro-pagos de tu saldo</li>
          <li><span class="tick">✓</span> Ver tu balance e historial de transacciones</li>
        </ul>
        <form method="POST" action="/auth/authorize">
          <input type="hidden" name="session_id" value="${escapeHtml(data.sessionId)}">
          <button type="submit" class="consent-btn-primary">Autorizar</button>
          <a href="/dashboard" class="consent-btn-ghost">Cancelar</a>
        </form>
        <p class="consent-foot">Puedes revocar el acceso cuando quieras desde tu dashboard.</p>
      </div>
    </div>`,
  );
}

export function authorizedView(): string {
  return layout(
    'Autorizado',
    `<div class="auth-page"><div class="auth-card" style="text-align:center">
      <div class="brand" style="justify-content:center"><div class="brand-logo">K</div><div class="brand-name">Kiba</div></div>
      <div style="font-size:42px;line-height:1;margin:6px 0 4px;color:#14F195">✓</div>
      <h1 class="auth-title" style="text-align:center">Conectado</h1>
      <p class="auth-sub" style="text-align:center">Tu app de IA ya tiene acceso a Kiba. Puedes cerrar esta pestaña.</p>
      <a href="/dashboard" class="btn-ghost">Ir al dashboard</a>
    </div></div>`,
  );
}
