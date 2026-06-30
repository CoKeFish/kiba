/**
 * HTML views simples server-rendered. Inline CSS — sin frameworks.
 * Visual system aligned with dashboard auth (light, Baloo 2, playful).
 */

/** Escapa texto para interpolar de forma segura en HTML (anti-XSS). */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

const brandLogo = `<div class="brand"><img src="/logo.png" alt="Kiba" class="brand-logo-img" /></div>`;

const css = `
  @import url("https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap");

  *, *::before, *::after { box-sizing: border-box; }

  :root {
    --color-bg: #ffffff;
    --color-fg: #0b0b12;
    --color-fg-muted: #66626f;
    --color-fg-subtle: #8e89a0;
    --color-border: color-mix(in srgb, #0b0b12 11%, transparent);
    --color-border-strong: color-mix(in srgb, #0b0b12 18%, transparent);
    --color-primary: #4fa3c7;
    --color-success: #22c55e;
    --color-danger: #f5556e;
    --c-purple: #6c48ff;
    --c-pink: #ff6ec7;
    --font-display: "Baloo 2", ui-rounded, system-ui, sans-serif;
    --font-sans: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, monospace;
    --dur-fast: 140ms;
    --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  body {
    margin: 0;
    padding: 0;
    background: var(--color-bg);
    color: var(--color-fg);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--c-purple); text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }

  .wrap { max-width: 480px; margin: 60px auto; padding: 0 24px; }
  .wrap-wide { max-width: 720px; margin: 60px auto; padding: 0 24px; }
  h1 { font-family: var(--font-display); font-size: 28px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.03em; }
  h2 { font-family: var(--font-display); font-size: 18px; font-weight: 700; margin: 32px 0 16px; }
  p.muted { color: var(--color-fg-subtle); margin: 0 0 24px; line-height: 1.5; }

  .panel {
    background: #fff;
    border: 1px solid var(--color-border);
    border-radius: 20px;
    padding: 24px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-fg) 4%, transparent),
      0 10px 28px color-mix(in srgb, var(--color-fg) 4%, transparent);
  }

  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-fg-muted);
    margin-bottom: 6px;
  }

  input[type=email], input[type=password], input[type=text] {
    width: 100%;
    padding: 12px 14px;
    background: #fff;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    font-family: var(--font-sans);
    font-size: 14px;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  }

  button {
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--c-purple) 100%);
    color: #fff;
    border: 0;
    padding: 10px 20px;
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    margin-top: 12px;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  button:hover { opacity: 0.92; }
  button.secondary {
    background: #fff;
    color: var(--c-purple);
    border: 1.5px solid color-mix(in srgb, var(--c-purple) 55%, transparent);
    box-shadow: none;
  }
  button.secondary:hover { background: color-mix(in srgb, var(--c-purple) 8%, transparent); }

  .row { display: flex; gap: 12px; align-items: center; }
  .row > * { flex: 1; }
  .err { color: var(--color-danger); font-size: 13px; margin: 12px 0; }
  .ok { color: var(--color-success); font-size: 13px; margin: 12px 0; }

  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .stat {
    flex: 1;
    min-width: 140px;
    background: #fff;
    border: 1px solid var(--color-border);
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-fg) 4%, transparent);
  }
  .stat-label { color: var(--color-fg-subtle); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .stat-value { font-family: var(--font-display); font-size: 24px; font-weight: 700; margin-top: 4px; }
  .stat-value.green { color: var(--color-success); }

  pre.code {
    background: #f8fafc;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px;
    font-size: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    color: var(--color-fg);
    font-family: var(--font-mono);
  }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--color-border); }
  th { color: var(--color-fg-subtle); font-weight: 600; }

  .topup-pill {
    display: inline-block;
    padding: 6px 16px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    margin-right: 8px;
    background: #fff;
  }
  .topup-pill:hover { border-color: var(--color-primary); }

  /* ── Auth pages (login / signup / consent) ───────────────── */
  .auth-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #ffffff;
    position: relative;
    overflow: hidden;
  }

  .auth-blob {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(60px);
    width: 420px;
    height: 420px;
    bottom: -120px;
    left: -100px;
    background: color-mix(in srgb, var(--c-purple) 28%, transparent);
  }

  .auth-dots {
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

  .auth-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 420px;
    background: #fff;
    border: 1px solid var(--color-border);
    border-radius: 20px;
    padding: 32px 28px 28px;
    box-shadow:
      0 1px 2px color-mix(in srgb, var(--color-fg) 4%, transparent),
      0 16px 40px color-mix(in srgb, var(--color-fg) 6%, transparent);
  }

  .brand { display: flex; align-items: center; margin-bottom: 22px; }
  .brand-logo-img { height: 28px; width: auto; display: block; object-fit: contain; }

  .auth-title {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 6px;
  }

  .app-name {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 2px;
    letter-spacing: -0.02em;
  }

  .auth-sub {
    color: var(--color-fg-subtle);
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 22px;
  }

  .auth-card label { margin-top: 14px; }
  .auth-card label.first { margin-top: 0; }

  .btn-primary {
    width: 100%;
    margin-top: 22px;
    padding: 13px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    border: 0;
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--c-purple) 100%);
    box-shadow: 0 8px 28px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  .btn-primary:hover { opacity: 0.92; filter: none; }

  .btn-ghost {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 12px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    text-decoration: none;
    background: #fff;
    color: var(--c-purple);
    border: 1.5px solid color-mix(in srgb, var(--c-purple) 55%, transparent);
    box-shadow: none;
  }

  .btn-ghost:hover {
    background: color-mix(in srgb, var(--c-purple) 8%, transparent);
    text-decoration: none;
  }

  .auth-foot {
    text-align: center;
    color: var(--color-fg-subtle);
    font-size: 13px;
    margin: 18px 0 0;
  }

  .scopes { list-style: none; padding: 0; margin: 16px 0 0; }
  .scopes li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 0;
    color: var(--color-fg-muted);
    font-size: 14px;
    line-height: 1.45;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .scopes li:last-child { border-bottom: 0; }
  .scopes .tick { color: var(--color-success); font-weight: 700; flex-shrink: 0; }

  .who {
    display: flex;
    align-items: center;
    gap: 9px;
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
    border-radius: 12px;
    padding: 10px 12px;
    margin-bottom: 18px;
    font-size: 13px;
    color: var(--color-fg-muted);
  }

  .who .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-success);
    flex-shrink: 0;
  }

  .auth-success-icon {
    font-size: 42px;
    line-height: 1;
    margin: 6px 0 4px;
    color: var(--color-success);
  }

  .auth-card--center { text-align: center; }
  .auth-card--center .brand { justify-content: center; }
`;

const authDecor = `
  <div class="auth-blob" aria-hidden="true"></div>
  <div class="auth-dots" aria-hidden="true"></div>
`;

const layout = (title: string, body: string, headExtra = '') => `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/favicon.png" />
<title>${escapeHtml(title)} · Kiba</title>
${headExtra}
<style>${css}</style>
</head><body>${body}</body></html>`;

export function landingView(loggedIn: boolean): string {
  return layout(
    'Kiba',
    `<div class="wrap-wide">
      ${brandLogo}
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
  return layout(
    'Crear cuenta',
    `<div class="auth-page">${authDecor}<div class="auth-card">
      ${brandLogo}
      <h1 class="auth-title">Crea tu cuenta</h1>
      <p class="auth-sub">Marketplace de agentes IA con micro-pagos x402 · Stellar testnet. Empiezas con <strong>$5</strong> de crédito gratis.</p>
      <form method="POST" action="${action}">
        <label class="first">Email</label>
        <input type="email" name="email" autocomplete="email" required>
        <label>Contraseña</label>
        <input type="password" name="password" autocomplete="new-password" required minlength="6">
        ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
        <button type="submit" class="btn-primary">Crear cuenta</button>
      </form>
      <p class="auth-foot">¿Ya tienes cuenta? <a href="${loginHref}">Inicia sesión</a></p>
    </div></div>`,
  );
}

export function loginView(error?: string, next?: string): string {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : '/signup';
  const connecting = !!next && next.includes('/auth/consent');
  return layout(
    'Iniciar sesión',
    `<div class="auth-page">${authDecor}<div class="auth-card">
      ${brandLogo}
      <h1 class="auth-title">Inicia sesión</h1>
      <p class="auth-sub">${connecting ? 'Inicia sesión para autorizar la conexión con tu cuenta de Kiba.' : 'Accede a tu cuenta de Kiba.'}</p>
      <form method="POST" action="${action}">
        <label class="first">Email</label>
        <input type="email" name="email" autocomplete="email" required>
        <label>Contraseña</label>
        <input type="password" name="password" autocomplete="current-password" required>
        ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
        <button type="submit" class="btn-primary">Entrar</button>
      </form>
      <p class="auth-foot">¿Sin cuenta? <a href="${signupHref}">Crear una</a></p>
    </div></div>`,
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
      ${brandLogo}
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
          <div class="stat-value">${data.walletSol.toFixed(4)} <span style="font-size:14px;color:var(--color-fg-subtle)">SOL</span></div>
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
          <input type="text" id="wallet-pubkey" readonly value="${escapeHtml(data.walletPubkey)}" style="flex:3;font-family:var(--font-mono);font-size:12px">
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

export function authorizeView(data: {
  clientName: string;
  email: string;
  balanceUsd: number;
  sessionId: string;
}): string {
  return layout(
    'Autorizar acceso',
    `<div class="auth-page">${authDecor}<div class="auth-card">
      ${brandLogo}
      <h1 class="app-name">${escapeHtml(data.clientName)}</h1>
      <p class="auth-sub">quiere conectarse a tu cuenta de Kiba</p>
      <div class="who"><span class="dot"></span> ${escapeHtml(data.email)} · Saldo $${data.balanceUsd.toFixed(2)}</div>
      <p style="font-size:14px;color:var(--color-fg-muted);margin:0;font-weight:600">Esta aplicación podrá:</p>
      <ul class="scopes">
        <li><span class="tick">✓</span> Descubrir y llamar agentes en tu nombre</li>
        <li><span class="tick">✓</span> Descontar micro-pagos de tu saldo</li>
        <li><span class="tick">✓</span> Ver tu balance e historial de transacciones</li>
      </ul>
      <form method="POST" action="/auth/authorize">
        <input type="hidden" name="session_id" value="${escapeHtml(data.sessionId)}">
        <button type="submit" class="btn-primary">Autorizar</button>
        <a href="/dashboard" class="btn-ghost">Cancelar</a>
      </form>
      <p class="auth-foot">Puedes revocar el acceso cuando quieras desde tu dashboard.</p>
    </div></div>`,
  );
}

export function authorizedView(): string {
  return layout(
    'Autorizado',
    `<div class="auth-page">${authDecor}<div class="auth-card auth-card--center">
      ${brandLogo}
      <div class="auth-success-icon">✓</div>
      <h1 class="auth-title">Conectado</h1>
      <p class="auth-sub">Tu app de IA ya tiene acceso a Kiba. Puedes cerrar esta pestaña.</p>
      <a href="/dashboard" class="btn-ghost">Ir al dashboard</a>
    </div></div>`,
  );
}

/** Página intermedia de redirect tras OAuth stdio (MCP local). */
export function authorizedRedirectView(redirectUrl: string): string {
  const safeUrl = escapeHtml(redirectUrl);
  return layout(
    'Autorizado',
    `<div class="auth-page">${authDecor}<div class="auth-card auth-card--center">
      ${brandLogo}
      <div class="auth-success-icon">✓</div>
      <h1 class="auth-title">Autorizado</h1>
      <p class="auth-sub">Redirigiendo a tu cliente local…</p>
      <p class="auth-foot"><a href="${safeUrl}">Click si no redirige automáticamente</a></p>
      <p class="auth-foot" style="margin-top:12px">Puedes cerrar esta pestaña una vez tu cliente confirme.</p>
    </div></div>`,
    `<meta http-equiv="refresh" content="0;url=${safeUrl}">`,
  );
}
