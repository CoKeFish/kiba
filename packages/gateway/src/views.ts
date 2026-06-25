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

export function signupView(error?: string): string {
  return layout(
    'Crear cuenta',
    `<div class="wrap">
      <h1>Crear cuenta</h1>
      <p class="muted">Empieza con $5 de crédito gratis</p>
      <form method="POST" action="/signup" class="panel">
        <label>Email</label>
        <input type="email" name="email" required>
        <label style="margin-top:16px">Contraseña</label>
        <input type="password" name="password" required minlength="6">
        ${error ? `<div class="err">${error}</div>` : ''}
        <button type="submit">Crear cuenta</button>
        <p class="muted" style="margin-top:16px">¿Ya tienes cuenta? <a href="/login">Inicia sesión</a></p>
      </form>
    </div>`,
  );
}

export function loginView(error?: string, next?: string): string {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  return layout(
    'Iniciar sesión',
    `<div class="wrap">
      <h1>Iniciar sesión</h1>
      <form method="POST" action="${action}" class="panel">
        <label>Email</label>
        <input type="email" name="email" required>
        <label style="margin-top:16px">Contraseña</label>
        <input type="password" name="password" required>
        ${error ? `<div class="err">${error}</div>` : ''}
        <button type="submit">Entrar</button>
        <p class="muted" style="margin-top:16px">¿Sin cuenta? <a href="/signup">Crear una</a></p>
      </form>
    </div>`,
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
    `<div class="wrap">
      <h1>Autorizar acceso</h1>
      <p class="muted">Iniciaste sesión como <strong>${escapeHtml(data.email)}</strong> · Saldo: $${data.balanceUsd.toFixed(2)}</p>

      <div class="panel">
        <h2 style="margin-top:0">${escapeHtml(data.clientName)}</h2>
        <p>Esta aplicación solicita acceso para:</p>
        <ul>
          <li>Llamar agentes en tu nombre</li>
          <li>Descontar de tu saldo USD</li>
          <li>Ver tu balance e historial</li>
        </ul>
        <p class="muted" style="margin-top:16px">Puedes revocar este acceso en cualquier momento desde tu dashboard.</p>

        <form method="POST" action="/auth/authorize" style="margin-top:24px">
          <input type="hidden" name="session_id" value="${data.sessionId}">
          <button type="submit">Autorizar</button>
          <a href="/dashboard"><button type="button" class="secondary">Cancelar</button></a>
        </form>
      </div>
    </div>`,
  );
}

export function authorizedView(): string {
  return layout(
    'Autorizado',
    `<div class="wrap">
      <h1>✓ Autorizado</h1>
      <p class="muted">Tu agente IA ahora tiene acceso a Kiba.</p>
      <div class="panel">
        <p>Puedes cerrar esta pestaña.</p>
        <a href="/dashboard"><button class="secondary">Ir al dashboard</button></a>
      </div>
    </div>`,
  );
}
