import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  Receipt,
  Bot,
  Play,
  Key,
  CreditCard,
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
    <div className="flex h-screen">
      <aside className="w-60 border-r border-[var(--color-border)] bg-[var(--color-bg-soft)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-border)] flex items-center gap-2 font-semibold">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-success))",
            }}
          />
          Agent Bazaar
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-[var(--color-accent)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-accent)]/50 hover:text-[var(--color-fg)]",
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[var(--color-border)]">
          <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start">
            <LogOut className="w-4 h-4" /> Log out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-[var(--color-border)] flex items-center justify-between px-6">
          <div className="text-sm text-[var(--color-fg-muted)]">{user?.email}</div>
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <span className="text-[var(--color-fg-muted)]">Balance:</span>{" "}
              <span className="font-mono font-medium">
                {balance ? formatUsd(lamportsToUsd(balance.balance_lamports)) : "—"}
              </span>
            </div>
            <Button size="sm" onClick={() => navigate("/app/billing")}>
              Top up
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
