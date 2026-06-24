import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/app");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background:
          "radial-gradient(ellipse at 30% 40%, color-mix(in srgb, var(--color-primary) 12%, transparent), transparent 55%), var(--color-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Brand mark */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 40,
            gap: 12,
          }}
        >
          <img
            src="/logomark.png"
            alt="Kiba"
            style={{
              width: 72,
              height: 72,
              objectFit: "contain",
              filter: "drop-shadow(0 0 24px color-mix(in srgb, var(--color-primary) 55%, transparent))",
            }}
          />
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              fontWeight: 400,
              color: "var(--color-fg)",
              letterSpacing: "-0.01em",
              textTransform: "lowercase",
            }}
          >
            kiba
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "24px 28px 0",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 600,
                color: "var(--color-fg)",
                marginBottom: 4,
                letterSpacing: "-0.01em",
              }}
            >
              Welcome back
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                color: "var(--color-fg-subtle)",
                marginBottom: 24,
              }}
            >
              Log in to your Kiba account.
            </p>
          </div>

          <form onSubmit={onSubmit} style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="email" style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--color-fg-subtle)" }}>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="password" style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--color-fg-subtle)" }}>
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--color-danger)" }}>
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                color: "var(--color-fg-subtle)",
                textAlign: "center",
              }}
            >
              No account?{" "}
              <Link
                to="/signup"
                style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 600 }}
              >
                Sign up free
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
