import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signup(email, password);
      navigate("/app");
    } catch (err: any) {
      setError(err.message || "Signup failed");
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
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 32px color-mix(in srgb, var(--color-primary) 50%, transparent)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <polygon points="12,3 22,20 2,20" fill="white" opacity="0.95" />
              <circle cx="12" cy="16" r="2.5" fill="white" opacity="0.6" />
            </svg>
          </div>
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
            agent bazaar
          </div>
        </div>

        {/* Free credit badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "6px 16px",
            borderRadius: 999,
            border: "1px solid var(--color-border)",
            background: "var(--color-accent)",
            width: "fit-content",
            margin: "0 auto 24px",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)", flexShrink: 0, display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--color-fg-subtle)" }}>
            $5 free credit on sign-up
          </span>
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
          <div style={{ padding: "24px 28px 0" }}>
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
              Create account
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                color: "var(--color-fg-subtle)",
                marginBottom: 24,
              }}
            >
              Start calling agents in seconds.
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
                minLength={8}
                autoComplete="new-password"
                placeholder="8+ characters"
              />
            </div>
            {error && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--color-danger)" }}>
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "Creating…" : "Create account →"}
            </Button>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                color: "var(--color-fg-subtle)",
                textAlign: "center",
              }}
            >
              Already have an account?{" "}
              <Link
                to="/login"
                style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 600 }}
              >
                Log in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
