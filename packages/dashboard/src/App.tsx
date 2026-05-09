import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Login from "@/routes/Login";
import Signup from "@/routes/Signup";
import Overview from "@/routes/Overview";
import Transactions from "@/routes/Transactions";
import Credentials from "@/routes/Credentials";
import { Usage, Agents, Billing, Settings } from "@/routes/Stubs";
import { useAuth } from "@/lib/auth";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-sm text-[var(--color-fg-muted)]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/app"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<Overview />} />
        <Route path="usage" element={<Usage />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="agents" element={<Agents />} />
        <Route path="credentials" element={<Credentials />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
