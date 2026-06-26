/**
 * HTML views simples server-rendered. Inline CSS — sin frameworks.
 */

/** Escapa texto para interpolar de forma segura en HTML (anti-XSS). */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

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

  /* ── Auth pages (login / signup / consent) ───────────────── */
  .auth-page {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: radial-gradient(900px 500px at 50% -15%, #11233b 0%, #0a0a0a 60%);
  }
  .auth-card {
    width: 100%; max-width: 400px; background: #121212; border: 1px solid #232323;
    border-radius: 16px; padding: 32px 28px; box-shadow: 0 24px 70px rgba(0,0,0,.55);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
  .brand-logo {
    width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
    background: linear-gradient(135deg, #14F195, #2f80ed);
    display: flex; align-items: center; justify-content: center;
    color: #052016; font-weight: 800; font-size: 19px;
  }
  .brand-name { font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  .auth-title { font-size: 22px; font-weight: 650; margin: 0 0 6px; }
  .app-name { font-size: 19px; font-weight: 650; margin: 0 0 2px; }
  .auth-sub { color: #8a8a8a; font-size: 14px; line-height: 1.5; margin: 0 0 22px; }
  .auth-card label { margin-top: 14px; }
  .auth-card label.first { margin-top: 0; }
  .auth-card input { padding: 12px 13px; border-radius: 10px; font-size: 15px; }
  .auth-card input:focus { border-color: #14F195; }
  .btn-primary {
    width: 100%; margin-top: 22px; padding: 12px; border-radius: 10px;
    font-size: 15px; font-weight: 600; color: #04130d; cursor: pointer; border: 0;
    background: linear-gradient(135deg, #14F195, #10b981);
  }
  .btn-primary:hover { filter: brightness(1.06); }
  .btn-ghost {
    display: block; width: 100%; margin-top: 10px; padding: 12px; border-radius: 10px;
    font-size: 14px; font-weight: 500; cursor: pointer; text-align: center;
    background: transparent; color: #cfcfcf; border: 1px solid #2c2c2c;
  }
  .btn-ghost:hover { border-color: #3a3a3a; background: #181818; }
  .auth-foot { text-align: center; color: #777; font-size: 13px; margin: 18px 0 0; }
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
<title>${title} · Kiba</title>
<style>${css}</style>
</head><body>${body}</body></html>`;

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
  return layout(
    'Crear cuenta',
    `<div class="auth-page"><div class="auth-card">
      <div class="brand"><div class="brand-logo">K</div><div class="brand-name">Kiba</div></div>
      <h1 class="auth-title">Crea tu cuenta</h1>
      <p class="auth-sub">Marketplace de agentes IA con micro-pagos x402 · Stellar testnet. Empiezas con <strong>$5</strong> de crédito gratis.</p>
      <form method="POST" action="${action}">
        <label class="first">Email</label>
        <input type="email" name="email" autocomplete="email" required>
        <label>Contraseña</label>
        <input type="password" name="password" autocomplete="new-password" required minlength="6">
        ${error ? `<div class="err">${error}</div>` : ''}
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
    `<div class="auth-page"><div class="auth-card">
      <div class="brand"><div class="brand-logo">K</div><div class="brand-name">Kiba</div></div>
      <h1 class="auth-title">Inicia sesión</h1>
      <p class="auth-sub">${connecting ? 'Inicia sesión para autorizar la conexión con tu cuenta de Kiba.' : 'Accede a tu cuenta de Kiba.'}</p>
      <form method="POST" action="${action}">
        <label class="first">Email</label>
        <input type="email" name="email" autocomplete="email" required>
        <label>Contraseña</label>
        <input type="password" name="password" autocomplete="current-password" required>
        ${error ? `<div class="err">${error}</div>` : ''}
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
      <h1>Dashboard</h1>
      <p class="muted">${data.email} · <a href="/logout">cerrar sesión</a></p>

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
          <input type="text" id="wallet-pubkey" readonly value="${data.walletPubkey}" style="flex:3;font-family:ui-monospace,Menlo,monospace;font-size:12px">
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
    `<div class="auth-page"><div class="auth-card">
      <div class="brand"><div class="brand-logo">K</div><div class="brand-name">Kiba</div></div>
      <h1 class="app-name">${escapeHtml(data.clientName)}</h1>
      <p class="auth-sub">quiere conectarse a tu cuenta de Kiba</p>
      <div class="who"><span class="dot"></span> ${escapeHtml(data.email)} · Saldo $${data.balanceUsd.toFixed(2)}</div>
      <p style="font-size:14px;color:#cfcfcf;margin:0">Esta aplicación podrá:</p>
      <ul class="scopes">
        <li><span class="tick">✓</span> Descubrir y llamar agentes en tu nombre</li>
        <li><span class="tick">✓</span> Descontar micro-pagos de tu saldo</li>
        <li><span class="tick">✓</span> Ver tu balance e historial de transacciones</li>
      </ul>
      <form method="POST" action="/auth/authorize">
        <input type="hidden" name="session_id" value="${data.sessionId}">
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
    `<div class="auth-page"><div class="auth-card" style="text-align:center">
      <div class="brand" style="justify-content:center"><div class="brand-logo">K</div><div class="brand-name">Kiba</div></div>
      <div style="font-size:42px;line-height:1;margin:6px 0 4px;color:#14F195">✓</div>
      <h1 class="auth-title" style="text-align:center">Conectado</h1>
      <p class="auth-sub" style="text-align:center">Tu app de IA ya tiene acceso a Kiba. Puedes cerrar esta pestaña.</p>
      <a href="/dashboard" class="btn-ghost">Ir al dashboard</a>
    </div></div>`,
  );
}
