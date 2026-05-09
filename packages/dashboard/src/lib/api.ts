const BASE = "/api";
const BACKEND = "/backend";

async function request<T>(
  path: string,
  init: RequestInit = {},
  base = BASE,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  signup: (email: string, password: string) =>
    request<{ user: User }>("/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/logout", { method: "POST" }),
  me: () => request<User>("/v1/me"),

  // Balance & billing
  balance: () => request<{ balance_lamports: number; balance_usd: number }>("/v1/balance"),
  wallet: () =>
    request<{
      pubkey: string;
      lamports: number;
      sol: number;
      master_wallet: string;
    }>("/v1/wallet"),
  topup: (amount_usd: number) =>
    request<{ ok: boolean; new_balance_lamports: number }>("/v1/topup", {
      method: "POST",
      body: JSON.stringify({ amount_usd }),
    }),

  // Transactions
  transactions: (limit = 50) => request<Transaction[]>(`/v1/transactions?limit=${limit}`),

  // Agents (via backend, not gateway — public discovery)
  agents: () => request<Agent[]>("/agents", {}, BACKEND),
  searchAgents: (q: string, mode: "keyword" | "semantic" | "hybrid" = "hybrid", limit = 20) =>
    request<{ query: string; mode: string; count: number; results: AgentSearchHit[] }>(
      `/agents?q=${encodeURIComponent(q)}&mode=${mode}&limit=${limit}`,
      {},
      BACKEND,
    ),

  // Direct call (proxied through gateway, debits balance, opens escrow on-chain, claims)
  call: (service: string, payload: unknown) =>
    request<{
      result: unknown;
      cost: { lamports: number; usd: number };
      newBalance: { lamports: number; usd: number };
    }>("/v1/call", {
      method: "POST",
      body: JSON.stringify({ service, payload }),
    }),

  // OAuth connections (apps the user has authorized)
  oauthConnections: () => request<OAuthConnection[]>("/v1/oauth/connections"),
  revokeOAuth: (token_id: string) =>
    request<void>(`/v1/oauth/connections/${token_id}`, { method: "DELETE" }),

  // API keys (separate from OAuth)
  apiKeys: () => request<ApiKey[]>("/v1/api-keys"),
  createApiKey: (name: string) =>
    request<{ id: string; secret: string; prefix: string }>("/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revokeApiKey: (id: string) => request<void>(`/v1/api-keys/${id}`, { method: "DELETE" }),
};

export type User = {
  id: string;
  email: string;
  custodial_wallet: string;
  balance_lamports: number;
  created_at: number;
};

export type Transaction = {
  id: string;
  user_id: string;
  type: "topup" | "call" | "refund";
  amount_lamports: number;
  service?: string;
  channel?: "sdk" | "rest" | "mcp";
  tx_signature?: string;
  status: "success" | "failed" | "pending";
  created_at: number;
};

export type Agent = {
  service: string;
  description: string;
  endpoint: string;
  pricePerCall: number; // SOL
  ownerWallet: string;
  acceptedToken: "SOL";
  totalCalls: number;
  totalEarned: number;
  createdAt: number;
  source: "chain" | "fallback";
};

export type AgentSearchHit = Agent & {
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
};

export type OAuthConnection = {
  id: string;
  client_name: string;
  scope: string;
  created_at: number;
  last_used_at?: number;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at?: number;
};
