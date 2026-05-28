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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUsd, lamportsToUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const nav = [
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

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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
        {/* Logo */}
        <div
          className="px-5 py-4 flex items-center gap-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <img
            src="/logomark.png"
            alt="Agent Bazaar"
            style={{
              width: 28,
              height: 28,
              objectFit: "contain",
              flexShrink: 0,
              filter: "drop-shadow(0 0 8px color-mix(in srgb, var(--color-primary) 50%, transparent))",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              fontWeight: 400,
              color: "var(--color-fg)",
              letterSpacing: "-0.01em",
              textTransform: "lowercase",
            }}
          >
            agent bazaar
          </span>
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
                padding: "8px 12px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--color-fg)" : "var(--color-fg-subtle)",
                background: isActive
                  ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                  : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--color-primary)"
                  : "2px solid transparent",
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
                {balance ? formatUsd(balance.balance_usd) : "—"}
              </span>
            </div>
            <Button size="sm" onClick={() => navigate("/app/billing")}>
              Top up
            </Button>
          </div>
        </header>

        <main
          className="flex-1 overflow-y-auto"
          style={{ padding: 24, background: "var(--color-bg)" }}
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
