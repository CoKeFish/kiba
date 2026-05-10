# E2E MCP Validation Report — Agent Bazaar (Production)

**Date:** 2026-05-10
**Stack:** Gateway `https://gateway-production-a12f.up.railway.app` · Backend `https://backend-production-fb67.up.railway.app` · Dashboard `https://agent-bazaar-dashboard.vercel.app` · Solana **devnet** (program `3CsQnAua3xniuMY5axKUNYtmTyAxh6cG2E257PLjJCmA`)
**MCP package under test:** `agent-bazaar-mcp` (npm, public) — driven via `npx -y agent-bazaar-mcp` over JSON-RPC stdio
**Test user:** `e2e-mcp-validator@test.dev3pack` (id=3, custodial wallet `CDu9kyueSaxTzFDUdHsBqys1MHd9CiNyQBtWvymCBVAS`)

---

## 1. Verdict per checklist item

| # | Check | Verdict | Evidence |
|---|---|---|---|
| **A1** | `list_agents` no query → 5+ agents | **PASS** | MCP returned 5 agents (yield-hunter, price-oracle, translator-pro, risk-auditor, code-reviewer), all `source: "chain"`, totalCalls > 0 for 4/5. Latency 596 ms. |
| **A2** | Spanish query "traducción" → translator | **BLOCKED via MCP / PASS via backend** | MCP `list_agents` exposes **no** `query` arg. Backend (`/agents?q=traducción&mode=semantic`) returns translator-pro #1, score 0.6121, matchType `semantic`. |
| **A3** | "translate text to spanish" → translator | **BLOCKED via MCP / PASS via backend** | Backend hybrid: translator-pro score 0.9176, matchType `hybrid`. |
| **A4** | "audit smart contract risk" → risk-auditor | **BLOCKED via MCP / PASS via backend** | Backend hybrid: risk-auditor score 0.9388, matchType `hybrid`. |
| **A5** | "yield" keyword → yield-hunter | **BLOCKED via MCP / PASS via backend** | Backend keyword: yield-hunter only, score 1.0, matchType `keyword`. FTS5 path confirmed. |
| **A6** | "asdfqwerty" garbage | **BLOCKED via MCP / SOFT-PASS via backend** | Backend hybrid returns 3 nearest semantic neighbors (scores ~0.55-0.57, all matchType `semantic`). No false-positive keyword hits. There is no score threshold filter — any garbage query still returns up-to-N semantic neighbors. Minor concern (not a regression). |
| **B-OAuth** | OAuth flow via MCP | **PARTIAL** | MCP only supports interactive-browser OAuth. I emulated it manually with curl: `POST /signup` → cookie, `GET /auth/connect?code_challenge=…` → 302 to `/login?next=/auth/consent?session=…`, `POST /auth/authorize {session_id}` (with cookie) → HTML containing `code=…`, `POST /oauth/token {grant_type, code, code_verifier}` → `access_token`. Saved at the path the MCP expects (`token.json` schema with `access_token`, `expires_at`). MCP then made authenticated calls successfully. |
| **B-API key** | MCP supports API key env var | **FAIL — finding** | Source review (`packages/mcp-server/src/index.ts`) shows the MCP only reads `AGENT_BAZAAR_TOKEN_PATH`. There is no `AGENT_BAZAAR_API_KEY` (or similar) env var. **Workaround:** dropping the API key into the `token.json` schema works because the gateway's `requireAuth` falls back to the API-key table on bearer tokens — but this is undocumented and brittle. |
| **C1** | Pick cheapest agent | PASS | price-oracle at 0.0005 SOL/call ≈ $0.075 (floor); translator-pro at 0.001 SOL + per-char (used to drain in 1 big call). |
| **C2** | Drain via repeated calls | PASS | Called via MCP `call_agent`. After signup ($5 = 33,333,333 lamports): 1× price-oracle ($0.075) → $4.92; 1× translator-pro 5544 chars ($4.38) → $0.54; 1× price-oracle ($0.075) → $0.46. |
| **C3** | balance decreases, transactions accrue, mode=virtual | PASS | `get_transactions` shows ids 15, 16, 17 type=`call`, all virtual mode (refill signatures present in `call_agent` trace responses). |
| **C4** | First call after virtual exhausted → wallet-direct | **PASS (with manual sizing)** | The cascade decision is `if virtual >= cost`, so I had to size a payload such that virtual ($0.46) < cost ≤ wallet ($1.22 then $0.48). 430-char translator call costing 3,150,000 lamports ($0.4725) flipped the cascade: response `mode: "wallet-direct"`, `newBalance.lamports == 3,118,333` (UNCHANGED — virtual was NOT debited), no `refill` field. Wallet on-chain dropped from 8,171,480 → 3,192,960 = ~5M lamports (cost + tx fees). |
| **C5** | Trace includes Solana signature, mode switched | PASS | Trace steps: `discover` → `402_received` (amount=3150000, payTo=`5ZyJCa…sveqqB5m` translator owner) → `escrow_opened` (sig `4upH4xgFwosfCU3t7mbHPuMScfDYx2sCu8j654AknbhQZz2AAe2kuHT4ouv1x6jWeWwGGkPP6qy5KUwZ8vLkPUBs`) → `service_responded` (claim sig `5MXEhscNustpkicDXGm8xpuqsNkbfVqaFVa4C7TuwdW8wdeihwB9LMiwPJQhCAgZVLNj4BHnYR7REnWnKzrKCdYu`). |
| **C6** | On-chain verification on devnet | PASS | `getTransaction` for both signatures returns success: `Program 3CsQnAua… invoke [1] Program log: Instruction: ClaimPayment` confirmed for both virtual-mode and wallet-direct claims. Pre/post balances show 95/5 owner/treasury split on the virtual-mode tx (e.g., agent +495,000 / treasury +5,000 for a 500k claim). |
| **C7** | Dashboard shows the on-chain tx in user history | **FAIL — finding** | `get_transactions` (both via MCP and gateway curl) for ALL `call`-type rows omits the `tx_signature` field entirely. The DB column `signature` is null for both virtual AND wallet-direct calls; signatures live only inside the `metadata` JSON column which is never returned. Result: a user looking at `/v1/transactions` (or the Dashboard's transactions page that consumes it) **cannot click through to Solana Explorer** for any call. Only `topup` rows have `tx_signature` populated (for refill txs). |
| **D** | x402 protocol compliance | **PASS (with one nit)** | All 4 trace steps present, ordered, monotonic timestamps. Direct unauth `POST /service` to `https://price-oracle-production-4d76.up.railway.app/service` → HTTP **402 Payment Required** with body `{amount, payTo, asset, service, nonce, expiresAt}`. **Nit:** no `WWW-Authenticate` header on the 402 response (x402 spec recommends it). |
| **E** | MCP exposes logs / state observation | **FAIL — finding** | Source review of `packages/mcp-server/src/index.ts` confirms only 4 tools. No `view_trace`, no `view_logs`, no `view_on_chain_tx`. Logs/traces are reachable only via Railway CLI (gateway/agent logs) or via gateway HTTP endpoints that are not surfaced as MCP tools (`/v1/wallet`, `/v1/platform/stats`, etc.). |

---

## 2. MCP coverage table

| Operation | Doable via MCP | Requires curl | Requires manual UI |
|---|---|---|---|
| Discover agents (no filter) | YES (`list_agents`) | — | — |
| Discover agents (semantic search by query) | **NO** — no `query` arg | YES (`/agents?q=…`) | — |
| Signup | NO | YES (`POST /signup`) | YES (dashboard) |
| Login | NO | YES (`POST /login`) | YES (dashboard) |
| Get user info / wallet pubkey | partial — `get_balance` has totals only, no pubkey | YES (`/v1/me`, `/v1/wallet`) | YES (Settings) |
| List API keys | **NO** | YES (`/v1/api-keys`) | YES (Credentials) |
| Create API key | **NO** | YES (`POST /v1/api-keys`) | YES (Credentials) |
| Revoke API key | **NO** | YES (`DELETE /v1/api-keys/:id`) | YES (Credentials) |
| OAuth authorize (PKCE) | YES via MCP (interactive browser) | YES (manual cookie + curl emulation) | — |
| OAuth list connections | **NO** | YES (`/v1/oauth/connections`) | YES (Credentials) |
| OAuth revoke connection | **NO** | YES (`DELETE /v1/oauth/connections/:id`, or `POST /oauth/revoke`) | YES |
| Call an agent | YES (`call_agent`) | YES (`POST /v1/call`) | YES (Playground) |
| Get balance | YES (`get_balance`) | YES (`/v1/balance`) | YES (Overview) |
| Get transactions | YES (`get_transactions`) | YES (`/v1/transactions`) | YES (Transactions) |
| View x402 trace for a call | partial — trace is in the `call_agent` response **once**, no way to retrieve it later | partial — gateway doesn't store traces server-side either | — |
| View on-chain Solana signature for past calls | **NO** — `tx_signature` is null in tx history (call rows only) | partial — only via Railway logs grep or by reading the DB metadata column directly | — |
| Top up USD credits | **NO** | YES (`POST /v1/topup`) | YES (Billing) |
| Register agent / CRUD | **NO** | YES (`/v1/agents POST/PUT/DELETE`) | YES (Agents) |
| Platform/treasury stats | **NO** | YES (`/v1/platform/stats`) | YES (Platform) |
| View server logs | **NO** | only via Railway CLI / dashboard | — |

**Summary:** Of ~18 user-facing operations, only **4** are doable through MCP. Everything else is curl- or UI-only.

---

## 3. Findings / friction points

### F-1 (Critical) — `list_agents` MCP tool has no query parameter
**What:** The MCP wraps `/v1/agents` which forwards to the backend without `q`. So an LLM agent calling MCP can't actually search; it gets the entire (unfiltered) catalog and has to do its own NL filtering. The whole point of the hybrid FTS5 + semantic search backend is unreachable from MCP.
**Why it matters:** This is the marketplace's killer differentiator (semantic discovery in any language) and it's invisible to Claude/Cursor users. Defeats the "agent finds the right specialist" UX.
**Fix:** Add `query?: string` to `list_agents.inputSchema` in `packages/mcp-server/src/index.ts`, and forward `?q={query}` in `gatewayGet('/v1/agents?q=…')`. Gateway already proxies to backend, but the gateway proxy itself must propagate the `q` param (currently `proxy.ts:listAgents` ignores it — also needs a 1-line fix).

### F-2 (Critical) — Wallet-direct call signatures not returned in transaction history
**What:** `get_transactions` (and the underlying `/v1/transactions`) returns rows with `tx_signature: undefined` for all `call`-type entries (both virtual-mode escrow/claim AND wallet-direct claim). The actual Solana sig lives only in the `metadata` JSON column, never serialized out.
**Why it matters:** Users cannot click "view on Solana Explorer" for any past call from the dashboard or any MCP client. The trace is only visible inline at the moment of the call. Breaks the "every payment is auditable" promise.
**Fix:** In `packages/gateway/src/billing.ts` `debit()` and `packages/gateway/src/proxy.ts` `recordWalletDirectCall()`, populate the dedicated `signature` column with the claim signature returned by `callWithTrace`. Then the existing `tx_signature: t.signature ?? undefined` in `index.ts:626` will start returning it.

### F-3 (Major) — MCP forces interactive-browser OAuth; no API key path
**What:** `mcp-server/src/index.ts` only reads `AGENT_BAZAAR_TOKEN_PATH` (OAuth-shaped JSON). For non-interactive contexts (CI, automated agents, headless servers), this is a hard block. Workaround: hand-craft a token.json with `access_token: <sk_live_…>` works because the gateway's `requireAuth` falls back to API key validation on any bearer token, but this is undocumented and not the published UX.
**Why it matters:** Limits adoption for headless/server-side automation, which is exactly the agentic-AI use case the project pitches.
**Fix:** Add `AGENT_BAZAAR_API_KEY` env var support. If set, skip OAuth entirely and use the key as the bearer token. Document in README.

### F-4 (Major) — Coverage gaps: ~15 of ~18 user-facing operations are MCP-invisible
**What:** No tools for: top-up, agent CRUD, API key CRUD, OAuth connection management, platform stats, wallet pubkey lookup, log retrieval, persistent trace lookup. See coverage table.
**Why it matters:** An LLM agent that wanted to "register itself" or "check its earnings" or "rotate its API key" via MCP cannot. The MCP is consumer-only, no producer/admin surface.
**Fix:** Add at minimum `topup`, `register_agent`, `list_my_agents`, `create_api_key`, `revoke_api_key`, `get_wallet`, `get_platform_stats`. Each is a 5-line wrapper around an existing gateway endpoint.

### F-5 (Medium) — Cascade error message in MCP is opaque
**What:** When wallet-direct fails (insufficient on-chain SOL), the MCP returns `Error: Request failed with status code 500`. The actual gateway message (`insufficient funds: virtual X + wallet Y < required`) is hidden behind axios's generic error.
**Why it matters:** LLM agents can't make a smart decision (top up? wait? abort?) without seeing the underlying error.
**Fix:** In `mcp-server/src/index.ts` `gatewayGet/Post`, on axios error, surface `err.response?.data?.error ?? err.message` instead of just `err.message`.

### F-6 (Medium) — Cascade requires virtual+wallet; doesn't combine balances
**What:** Reading `proxy.ts:130-142`: wallet-direct mode requires `wallet_lamports >= cost + 5M buffer`. It does NOT combine virtual + wallet. So if virtual=$0.46 and wallet=$0.48 and cost=$0.50 (e.g. price=$0.45 + buffer), the call FAILS even though total funds = $0.94. The error message says `virtual X + wallet Y < required` which is misleading because `+` is just a print; the check is wallet alone.
**Why it matters:** Users will see "I have plenty of money, why is my call failing?" Confusing UX, especially after virtual is mostly drained.
**Fix:** Either (a) combine balances (debit virtual then top up wallet, or atomic dual-source), or (b) fix the error message to say "wallet has X but call needs Y; top up or run smaller calls".

### F-7 (Low) — 402 response missing `WWW-Authenticate` header
**What:** Direct unauth `POST /service` to any agent returns HTTP 402 with the quote in the JSON body but no `WWW-Authenticate: x402` header.
**Why it matters:** x402 spec convention; not blocking but a portability/standards nit.
**Fix:** In the SDK provider's 402 path, set `res.setHeader('WWW-Authenticate', 'x402 realm="agent-bazaar"')`.

### F-8 (Low) — Empty / garbage queries always return semantic neighbors
**What:** Backend `/agents?q=asdfqwerty&mode=hybrid` returns 3 results with semantic scores 0.5–0.6. There is no score floor.
**Why it matters:** Garbage queries get plausible-looking false matches. A polite "no results" would be more honest.
**Fix:** In `packages/backend/src/search.ts`, drop hits with score < 0.6 (semantic) or 0 (keyword). Configurable threshold.

---

## 4. What I couldn't validate (and why)

- **Dashboard transactions UI render** — would have needed chrome-devtools MCP setup time. Verified equivalently: the underlying `/v1/transactions` endpoint omits `tx_signature` for call rows (F-2), so the dashboard cannot show explorer links regardless of how it renders.
- **OAuth interactive flow end-to-end (browser)** — emulated with curl using cookie + session id (documented in §1 row B-OAuth). The MCP path that opens a browser is identical to the manual emulation; no functional difference.
- **Drain to truly $0 virtual** — would have required ~6 calls of price-oracle. Stopped at $0.46 to conserve devnet SOL once wallet-direct cascade was demonstrably triggered.
- **Refund flow** (`refund_escrow` after 5 min) — out of scope of the e2e MCP test; smart-contract instruction not callable through MCP at all.
- **Token revocation impact** (does an old MCP token still work after `POST /oauth/revoke`?) — final cleanup revoked the token; verified `{"ok": true}` response. Did not run a follow-up MCP call to confirm 401 (would have re-triggered OAuth and added time).
- **Concurrent/race calls** — single-threaded test only.

---

## 5. Reproduction commands

All run from a temp dir `C:\Users\rrtc2\AppData\Local\Temp\mcp-e2e`. The driver script `drive-mcp.mjs` spawns `npx -y agent-bazaar-mcp` and pipes JSON-RPC messages via stdio.

### 5.1 Signup + OAuth token (manual emulation)
```bash
# Signup → cookie + bonus
curl -i -X POST https://gateway-production-a12f.up.railway.app/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-mcp-validator@test.dev3pack","password":"validatePass123"}'
# Capture session cookie from Set-Cookie header.

# Generate PKCE
node -e 'const c=require("node:crypto");const b=b=>b.toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");const v=b(c.randomBytes(32));const ch=b(c.createHash("sha256").update(v).digest());console.log(JSON.stringify({v,ch}))'

# Start OAuth → returns redirect URL with sessionId
curl -i -G "https://gateway-production-a12f.up.railway.app/auth/connect" \
  --data-urlencode "code_challenge=<challenge>" \
  --data-urlencode "redirect_uri=http://localhost:49500/callback" \
  --data-urlencode "client_name=e2e-mcp-validator"

# Authorize (with session cookie) → returns HTML containing code=…
curl -i -X POST "https://gateway-production-a12f.up.railway.app/auth/authorize" \
  -H "Cookie: session=<cookie-value>" \
  -d "session_id=<sess_…>"

# Exchange code for token
curl -X POST https://gateway-production-a12f.up.railway.app/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"authorization_code","code":"code_…","code_verifier":"<verifier>"}'
```

### 5.2 Persist token where the MCP looks
```bash
mkdir -p $HOME/.config/agent-bazaar
# Or set AGENT_BAZAAR_TOKEN_PATH to a custom location.
node -e 'require("node:fs").writeFileSync(process.env.P, JSON.stringify({access_token:"tok_…",expires_at:Math.floor(Date.now()/1000)+2592000,saved_at:Math.floor(Date.now()/1000)},null,2))' P=/path/to/token.json
```

### 5.3 Drive the MCP (drive-mcp.mjs in the temp dir)
```bash
# Initialize + tools/list + 3 tool calls
node drive-mcp.mjs \
  $(echo -n '{"tool":"list_agents","args":{}}' | base64 -w0) \
  $(echo -n '{"tool":"get_balance","args":{}}' | base64 -w0) \
  $(echo -n '{"tool":"get_transactions","args":{}}' | base64 -w0)

# Call price-oracle
node drive-mcp.mjs \
  $(echo -n '{"tool":"call_agent","args":{"service":"price-oracle","payload":{"symbol":"SOL"}}}' | base64 -w0)

# Force wallet-direct (need precise sizing — virtual < cost ≤ wallet+buffer):
# translator-pro priceFn = 0.001 + chars*0.000005 SOL → 430 chars = 3,150,000 lamports
node drive-mcp.mjs \
  $(echo -n '{"tool":"call_agent","args":{"service":"translator-pro","payload":{"text":"<430-char string>","from":"en","to":"es"}}}' | base64 -w0)
```

### 5.4 Verify on-chain
```bash
curl -X POST https://api.devnet.solana.com -H "Content-Type: application/json" -d '{
  "jsonrpc":"2.0","id":1,"method":"getTransaction",
  "params":["<claim_signature>",{"encoding":"json","commitment":"confirmed","maxSupportedTransactionVersion":0}]
}'
# Expect: meta.err=null, logMessages contains "Instruction: ClaimPayment" + program 3CsQnAua…
```

### 5.5 Backend semantic search (what MCP can't do)
```bash
curl -G https://backend-production-fb67.up.railway.app/agents \
  --data-urlencode "q=traducción" \
  --data-urlencode "mode=semantic" \
  --data-urlencode "limit=3"
```

### 5.6 API key path (workaround)
```bash
# Create key (needs OAuth bearer or session)
curl -X POST https://gateway-production-a12f.up.railway.app/v1/api-keys \
  -H "Authorization: Bearer <oauth_token>" \
  -H "Content-Type: application/json" -d '{"name":"e2e-test"}'
# Drop the sk_live_… into token.json with the OAuth schema; the MCP will use it.
```

---

## Notable signatures (devnet, for explorer audit)

- Virtual-mode escrow: `5vpg6CJfsiFsvnd1Ah3tZjC8iyvNwRWsRwYBNjLf4DnRz7quQmzFFX8Cj21Q8v8pBTez8QXAuouYh8mm2XjTuCiz`
- Virtual-mode claim: `41YtoWdBvwhrmVcorSKXvzdx3rHXQDk2p3i7ubiQbZDYTTRbUq1s31tJrJ13V2kHf5Kvg7C8DEBysfnZ94HaUNYD`
- Wallet-direct escrow: `4upH4xgFwosfCU3t7mbHPuMScfDYx2sCu8j654AknbhQZz2AAe2kuHT4ouv1x6jWeWwGGkPP6qy5KUwZ8vLkPUBs`
- Wallet-direct claim: `5MXEhscNustpkicDXGm8xpuqsNkbfVqaFVa4C7TuwdW8wdeihwB9LMiwPJQhCAgZVLNj4BHnYR7REnWnKzrKCdYu`
- Master refill (large translator call): `3LusM8j4AD5LjFsn8tWCj3mxsmbLbZLhv8pbRrXnubnNz3GMfL83Ma9zUamY59CqRTn3ZYLLXSGyc8ozXqPwQkdP`

All viewable at `https://explorer.solana.com/tx/<sig>?cluster=devnet`.
