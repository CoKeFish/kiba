import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  Receipt,
  Inbox,
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
  Plug,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMode, type DashboardMode } from "@/lib/mode";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { formatBalance } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { DemoFab } from "@/components/DemoFab";
import "./app-layout.css";

// `label` es una clave i18n; se resuelve con t() en el render.
const consumerNav = [
  { to: "/app", label: "nav.overview", icon: LayoutDashboard, end: true },
  { to: "/app/connect", label: "nav.get_started", icon: Plug },
  { to: "/app/agents", label: "nav.agents", icon: Bot },
  { to: "/app/playground", label: "nav.playground", icon: Play },
  { to: "/app/usage", label: "nav.usage", icon: BarChart3 },
  { to: "/app/transactions", label: "nav.transactions", icon: Receipt },
  { to: "/app/results", label: "nav.results", icon: Inbox },
  { to: "/app/credentials", label: "nav.credentials", icon: Key },
  { to: "/app/billing", label: "nav.billing", icon: CreditCard },
  { to: "/app/settings", label: "nav.settings", icon: SettingsIcon },
];

const publisherNav = [
  { to: "/app/publisher", label: "nav.revenue", icon: Coins, end: true },
  { to: "/app/publisher/agents", label: "nav.my_agents", icon: Bot },
  { to: "/app/publisher/analytics", label: "nav.analytics", icon: BarChart3 },
  { to: "/app/publisher/payouts", label: "nav.payouts", icon: Wallet },
  { to: "/app/publisher/pricing", label: "nav.pricing", icon: Tag },
  { to: "/app/publisher/publish", label: "nav.publish", icon: Rocket },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useMode();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Cajón lateral (solo tiene efecto en pantallas estrechas; en escritorio la barra es fija).
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = mode === "publisher" ? publisherNav : consumerNav;

  // Al cambiar de página se cierra el cajón.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Con el cajón abierto: Escape lo cierra y la página de detrás no hace scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

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
    <div className="app-shell">
      <div
        className={`app-backdrop${menuOpen ? " is-open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={`app-sidebar${menuOpen ? " is-open" : ""}`}
        aria-label={t("nav.menu")}
      >
        {/* Brand — misma altura que la barra superior para que los dos bordes queden en línea */}
        <div className="app-sidebar__brand">
          <Link to="/app" className="kiba-brand-link" aria-label="Kiba home">
            <img src="/logo.png" alt="Kiba" className="kiba-logo kiba-logo--sidebar" />
          </Link>
          <button
            type="button"
            className="app-icon-btn app-sidebar__close"
            onClick={() => setMenuOpen(false)}
            aria-label={t("nav.close_menu")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode switch — Consumer ⇄ Publisher (same account) */}
        <div className="app-sidebar__mode">
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
              { m: "consumer" as DashboardMode, label: t("nav.consumer"), icon: ShoppingBag },
              { m: "publisher" as DashboardMode, label: t("nav.publisher"), icon: Store },
            ]).map(({ m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
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
        <nav className="app-sidebar__nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }: { isActive: boolean }) =>
                `app-nav-item${isActive ? " is-active" : ""}`
              }
            >
              <item.icon size={15} />
              {t(item.label)}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: language + user + logout */}
        <div className="app-sidebar__foot">
          <LanguageSwitcher variant="sidebar" />
          {user?.email && <div className="app-sidebar__email">{user.email}</div>}
          <button type="button" onClick={handleLogout} className="app-logout">
            <LogOut size={15} />
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="app-main">
        {/* Top bar */}
        <header className="app-topbar">
          <div className="app-topbar__left">
            <button
              type="button"
              className="app-icon-btn app-menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label={t("nav.menu")}
              aria-controls="app-sidebar"
              aria-expanded={menuOpen}
            >
              <Menu size={20} />
            </button>
            <Link to="/app" className="kiba-brand-link app-topbar__brand" aria-label="Kiba home">
              <img src="/logo.png" alt="Kiba" className="kiba-logo" />
            </Link>
            <div className="app-topbar__email">{user?.email}</div>
          </div>
          <div className="app-topbar__right">
            <div className="app-topbar__balance">
              <span className="app-topbar__balance-label">{t("topbar.balance")} </span>
              {/* Un solo saldo: lo regalado + la wallet de pagos, ya descontado lo usado. */}
              <strong>{balance ? formatBalance(balance.total_usd) : "—"}</strong>
            </div>
            <Button size="md" className="whitespace-nowrap" onClick={() => navigate("/app/billing")}>
              {t("topbar.top_up")}
            </Button>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      <DemoFab />
    </div>
  );
}
