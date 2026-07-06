import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Login from "@/routes/Login";
import Signup from "@/routes/Signup";
import Overview from "@/routes/Overview";
import Connect from "@/routes/Connect";
import Transactions from "@/routes/Transactions";
import Credentials from "@/routes/Credentials";
import Agents from "@/routes/Agents";
import Playground from "@/routes/Playground";
import Usage from "@/routes/Usage";
import Billing from "@/routes/Billing";
import Settings from "@/routes/Settings";
import PublisherOverview from "@/routes/publisher/Overview";
import PublisherAgents from "@/routes/publisher/Agents";
import PublisherAnalytics from "@/routes/publisher/Analytics";
import PublisherPayouts from "@/routes/publisher/Payouts";
import PublisherPricing from "@/routes/publisher/Pricing";
import PublisherPublish from "@/routes/publisher/Publish";
import { PublisherGate } from "@/components/PublisherGate";
import { useAuth } from "@/lib/auth";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-sm text-[var(--color-fg-muted)]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Rutas públicas de auth: si el usuario ya tiene sesión válida (cookie), no le mostramos
// el formulario otra vez — lo mandamos al app. Sin esto, entrar al dashboard desde el
// landing (cuyos CTAs apuntan a /login y /signup) parecía "perder la sesión".
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-sm text-[var(--color-fg-muted)]">Loading…</div>;
  if (user) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
      <Route
        path="/app"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<Overview />} />
        <Route path="connect" element={<Connect />} />
        <Route path="usage" element={<Usage />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="agents" element={<Agents />} />
        <Route path="playground" element={<Playground />} />
        <Route path="credentials" element={<Credentials />} />
        <Route path="billing" element={<Billing />} />
        {/* /app/platform (Platform Revenue) retirada del dashboard de usuario final:
            mostraba la tesorería/comisión de Kiba — info interna, no una herramienta
            del usuario. Platform.tsx queda sin cablear por si vuelve como vista admin. */}
        <Route path="settings" element={<Settings />} />

        {/* Publisher area — same account, gated by "Become a publisher" onboarding */}
        <Route path="publisher" element={<PublisherGate><PublisherOverview /></PublisherGate>} />
        <Route path="publisher/agents" element={<PublisherGate><PublisherAgents /></PublisherGate>} />
        <Route path="publisher/analytics" element={<PublisherGate><PublisherAnalytics /></PublisherGate>} />
        <Route path="publisher/payouts" element={<PublisherGate><PublisherPayouts /></PublisherGate>} />
        <Route path="publisher/pricing" element={<PublisherGate><PublisherPricing /></PublisherGate>} />
        <Route path="publisher/publish" element={<PublisherGate><PublisherPublish /></PublisherGate>} />
      </Route>
      {/* Enlaces externos legacy (p.ej. el "View all agents" del landing apunta a
          /agents): normalizamos el path plano a su equivalente bajo /app. */}
      <Route path="/agents" element={<Navigate to="/app/agents" replace />} />
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
