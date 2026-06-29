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
  balance: () => request<BalanceResponse>("/v1/balance"),
  wallet: () => request<WalletResponse>("/v1/wallet"),
  topup: (amount_usd: number) =>
    request<TopupResponse>("/v1/topup", {
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

  // Publisher mode — misma cuenta; habilita gestión de agentes + ingresos
  activatePublisher: (name?: string) =>
    request<{ is_publisher: boolean; publisher_name: string | null }>("/v1/publisher/activate", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  publisherOverview: () => request<PublisherOverview>("/v1/publisher/overview"),

  // Pagos fiat (Bre-B / Stripe / Wompi) → créditos. Varios métodos a la vez.
  paymentsConfig: () => request<PaymentsConfig>("/v1/payments/config"),
  createCharge: (provider: string, amountCop: number, redirectUrl?: string) =>
    request<PaymentCharge>("/v1/payments/breb/charge", {
      method: "POST",
      body: JSON.stringify({ provider, amountCop, redirectUrl }),
    }),
  getCharge: (id: string) => request<PaymentCharge>(`/v1/payments/charge/${encodeURIComponent(id)}`),
  simulateBreb: (chargeId: string) =>
    request<{ charge: PaymentCharge; new_balance_usd: number; new_balance_kibs: number }>(
      "/v1/payments/breb/simulate",
      { method: "POST", body: JSON.stringify({ chargeId }) },
    ),
  // Redirect providers (Wompi/Stripe): tras volver del checkout, confirma y acredita.
  // transactionId = tx id (Wompi) o session id (Stripe).
  verifyPayment: (chargeId: string, transactionId: string) =>
    request<{
      charge: PaymentCharge;
      status: string;
      new_balance_usd: number;
      new_balance_kibs: number;
    }>("/v1/payments/verify", {
      method: "POST",
      body: JSON.stringify({ chargeId, transactionId }),
    }),
};

export type User = {
  id: string;
  email: string;
  custodial_wallet: string;
  /** Modo publisher activo (misma cuenta). Habilita la gestión de agentes + ingresos. */
  is_publisher?: boolean;
  publisher_name?: string | null;
  /** Símbolo del activo de liquidación de la cadena activa. */
  asset: "SOL" | "XLM";
  /** Nombre de la unidad base (lamports/stroops). */
  base_unit_name: "lamports" | "stroops";
  /** Crédito USD del user, en unidades base del activo (chain-agnostic). */
  balance_base_units: number;
  balance_usd: number;
  created_at: number;
  /** @deprecated use balance_base_units (mismo valor numérico) */
  balance_lamports: number;
};

/** Respuesta de `/v1/balance` — chain-agnostic, con aliases legacy. */
export type BalanceResponse = {
  asset: "SOL" | "XLM";
  base_unit_name: "lamports" | "stroops";
  balance_base_units: number;
  balance_usd: number;
  wallet_base_units: number;
  wallet_asset_amount: number;
  wallet_usd: number;
  total_base_units: number;
  total_asset_amount: number;
  total_usd: number;
  /** @deprecated use balance_base_units */
  balance_lamports: number;
  /** @deprecated use wallet_base_units */
  wallet_lamports: number;
  /** @deprecated use wallet_asset_amount */
  wallet_sol: number;
  /** @deprecated use total_base_units */
  total_lamports: number;
  /** @deprecated use total_asset_amount */
  total_sol: number;
};

/** Respuesta de `/v1/wallet` — chain-agnostic, con aliases legacy. */
export type WalletResponse = {
  pubkey: string;
  asset: "SOL" | "XLM";
  base_unit_name: "lamports" | "stroops";
  base_units: number;
  asset_amount: number;
  master_wallet: string;
  /** @deprecated use base_units */
  lamports: number;
  /** @deprecated use asset_amount */
  sol: number;
};

export type TopupResponse = {
  ok: boolean;
  new_balance_base_units?: number;
  /** @deprecated use new_balance_base_units */
  new_balance_lamports: number;
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

export type PaymentMethod = {
  provider: string;
  label: string;
  country: string | null;
  mode: "qr" | "redirect";
  sandbox: boolean;
};

export type PaymentsConfig = {
  cop_usd_rate: number;
  kibs_per_usd: number;
  methods: PaymentMethod[];
};

export type PaymentCharge = {
  id: string;
  method: string;
  reference: string;
  amount_cop: number;
  amount_usd: number;
  kibs: number;
  status: "pending" | "paid" | "expired";
  detail: {
    llave?: string;
    qrPayload?: string;
    instructions?: string;
    checkoutUrl?: string;
  };
  created_at: number;
  paid_at: number | null;
};

export type PublisherOverview = {
  asset: "SOL" | "XLM";
  base_unit_name: "lamports" | "stroops";
  is_publisher: boolean;
  publisher_name: string | null;
  fee: { bps: number; pct: number };
  totals: {
    agents: number;
    calls: number;
    earned_asset: number;
    earned_usd: number;
  };
  wallet: {
    pubkey: string;
    base_units: number;
    asset_amount: number;
    usd: number;
  };
  agents: MyAgent[];
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
  asset: "SOL" | "XLM";
  base_unit_name: "lamports" | "stroops";
  treasury: {
    pubkey: string;
    base_units: number;
    asset_amount: number;
    usd: number;
    /** @deprecated use base_units */
    lamports: number;
    /** @deprecated use asset_amount */
    sol: number;
  };
  fee: { bps: number; pct: number };
  marketplace: {
    total_agents: number;
    total_agents_on_chain: number;
    total_calls: number;
  };
  lifetime: {
    total_volume_asset: number;
    total_volume_usd: number;
    owner_earnings_asset: number;
    owner_earnings_usd: number;
    estimated_fees_asset: number;
    estimated_fees_usd: number;
    /** @deprecated use total_volume_asset */
    total_volume_sol: number;
    /** @deprecated use owner_earnings_asset */
    owner_earnings_sol: number;
    /** @deprecated use estimated_fees_asset */
    estimated_fees_sol: number;
  };
};
