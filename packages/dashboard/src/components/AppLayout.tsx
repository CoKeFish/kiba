import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  Receipt,
  Bot,
  Play,
  Key,
  CreditCard,
  Coins,
  Settings as SettingsIcon,
  LogOut,
  Wallet,
  Tag,
  Rocket,
  Store,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMode, type DashboardMode } from "@/lib/mode";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUsd, formatKibs, usdToKibs, KIBS_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";

const consumerNav = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/agents", label: "Agents", icon: Bot },
  { to: "/app/playground", label: "Playground", icon: Play },
  { to: "/app/usage", label: "Usage", icon: BarChart3 },
  { to: "/app/transactions", label: "Transactions", icon: Receipt },
  { to: "/app/credentials", label: "Credentials", icon: Key },
  { to: "/app/billing", label: "Billing", icon: CreditCard },
  { to: "/app/platform", label: "Platform", icon: Coins },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon },
];

const publisherNav = [
  { to: "/app/publisher", label: "Revenue", icon: Coins, end: true },
  { to: "/app/publisher/agents", label: "My Agents", icon: Bot },
  { to: "/app/publisher/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/publisher/payouts", label: "Payouts", icon: Wallet },
  { to: "/app/publisher/pricing", label: "Pricing", icon: Tag },
  { to: "/app/publisher/publish", label: "Publish", icon: Rocket },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useMode();
  const navigate = useNavigate();

  const nav = mode === "publisher" ? publisherNav : consumerNav;

  const switchMode = (m: DashboardMode) => {
    setMode(m);
    navigate(m === "publisher" ? "/app/publisher" : "/app");
  };
  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: api.balance,
    refetchInterval: 15_000,
  });

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Sidebar */}
      <aside
        className="w-60 flex flex-col"
        style={{
          background: "var(--color-bg-soft)",
          borderRight: "1px solid var(--color-border)",
        }}
      >
        {/* Brand */}
        <div
          className="px-5 py-4 flex items-center"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-display)",
              fontSize: 24,
              fontWeight: 800,
              color: "var(--color-fg)",
              letterSpacing: "-0.06em",
            }}
          >
            Kiba
            <span className="kiba-dot" aria-hidden="true" />
          </span>
        </div>

        {/* Mode switch — Consumer ⇄ Publisher (same account) */}
        <div className="px-3 pt-3">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              padding: 4,
              borderRadius: 999,
              background: "var(--color-bg-soft)",
              border: "1px solid var(--color-border)",
            }}
          >
            {([
              { m: "consumer" as DashboardMode, label: "Consumer", icon: ShoppingBag },
              { m: "publisher" as DashboardMode, label: "Publisher", icon: Store },
            ]).map(({ m, label, icon: Icon }) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  fontWeight: 700,
                  background: mode === m ? "var(--color-primary)" : "transparent",
                  color: mode === m ? "var(--color-primary-fg)" : "var(--color-fg-subtle)",
                  transition: "all var(--dur-fast) var(--ease-out)",
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }: { isActive: boolean }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderRadius: 999,
                textDecoration: "none",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "var(--color-primary)" : "var(--color-fg-subtle)",
                background: isActive
                  ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
                  : "transparent",
                transition: "all var(--dur-fast) var(--ease-out)",
              })}
              className="nav-item"
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div
          className="p-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {user?.email && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-fg-subtle)",
                marginBottom: 8,
                paddingLeft: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.email}
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "var(--color-fg-subtle)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              cursor: "pointer",
              transition: "all var(--dur-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "color-mix(in srgb, var(--color-danger) 12%, transparent)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-danger)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-fg-subtle)";
            }}
          >
            <LogOut size={15} />
            Log out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-6"
          style={{
            height: 56,
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-soft)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-subtle)",
              letterSpacing: "0.04em",
            }}
          >
            {user?.email}
          </div>
          <div className="flex items-center gap-3">
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--color-fg-subtle)",
              }}
            >
              Balance:{" "}
              <span style={{ color: "var(--color-fg)", fontWeight: 600 }}>
                {balance ? `${formatKibs(usdToKibs(balance.balance_usd))} ${KIBS_LABEL}` : "—"}
              </span>
              {balance && (
                <span style={{ color: "var(--color-fg-subtle)", marginLeft: 6 }}>
                  (= {formatUsd(balance.balance_usd)})
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => navigate("/app/billing")}>
              Top up
            </Button>
          </div>
        </header>

        <main
          className="flex-1 overflow-y-auto"
          style={{ padding: 24, background: "#f4f7fb" }}
        >
          <Outlet />
        </main>
      </div>

      <style>{`
        .nav-item:hover {
          background: color-mix(in srgb, var(--color-primary) 10%, transparent) !important;
          color: var(--color-fg) !important;
        }
      `}</style>
    </div>
  );
}
