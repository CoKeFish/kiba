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
      refill?: { signature: string; lamports: number };
      trace: X402Trace;
    }>("/v1/call", {
      method: "POST",
      body: JSON.stringify({ service, payload }),
    }),

  // Agent management — registry CRUD a nombre del user (su custodial wallet firma)
  myAgents: () => request<MyAgent[]>("/v1/agents/mine"),
  registerAgent: (params: {
    service: string;
    pricePerCallLamports: number;
    endpoint: string;
    description: string;
  }) =>
    request<{ signature: string; pda: string; owner: string }>("/v1/agents", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  updateAgent: (
    service: string,
    params: {
      pricePerCallLamports?: number;
      endpoint?: string;
      description?: string;
    },
  ) =>
    request<{ signature: string; pda: string }>(`/v1/agents/${encodeURIComponent(service)}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),
  deregisterAgent: (service: string) =>
    request<{ signature: string; service: string; rentRecovered: number }>(
      `/v1/agents/${encodeURIComponent(service)}`,
      { method: "DELETE" },
    ),

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

  // Platform stats — treasury balance + marketplace metrics + revenue
  platformStats: () => request<PlatformStats>("/v1/platform/stats"),
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
  pricePerCall: number; // en unidades del token de la cadena (SOL/XLM)
  ownerWallet: string;
  acceptedToken: "SOL" | "XLM" | "USDC";
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

export type MyAgent = {
  pda: string;
  owner: string;
  service: string;
  pricePerCallLamports: number;
  pricePerCallSol: number;
  endpoint: string;
  description: string;
  totalCalls: number;
  totalEarnedLamports: number;
  totalEarnedSol: number;
  createdAt: number;
};

export type X402Step =
  | {
      type: "discover";
      service: string;
      endpoint: string;
      pricePerCall: number;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "402_received";
      quote: { amount: string; payTo: string; asset: string; nonce: string; expiresAt: number };
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "escrow_opened";
      signature: string;
      amount: string;
      nonce: string;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "service_responded";
      status: number;
      claimSignature?: string;
      claimedAmount?: string;
      durationMs: number;
      timestamp: number;
    };

export type X402Trace = {
  service: string;
  endpoint: string;
  totalDurationMs: number;
  steps: X402Step[];
};

export type PlatformStats = {
  treasury: {
    pubkey: string;
    lamports: number;
    sol: number;
    usd: number;
  };
  fee: { bps: number; pct: number };
  marketplace: {
    total_agents: number;
    total_agents_on_chain: number;
    total_calls: number;
  };
  lifetime: {
    total_volume_sol: number;
    total_volume_usd: number;
    owner_earnings_sol: number;
    owner_earnings_usd: number;
    estimated_fees_sol: number;
    estimated_fees_usd: number;
  };
};
