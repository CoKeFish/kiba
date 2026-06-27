import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/auth/AuthShell";

import { TitleSparks } from "@/components/auth/TitleSparks";

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthShell
      headerPrompt="Already have an account?"
      headerLinkLabel="Log in"
      headerLinkTo="/login"
      mascot="triangle"
    >
      <div className="auth-card">
        <div className="auth-title-wrap">
          <h1 className="auth-title">
            <span className="auth-title-create">
              Create
              <svg className="auth-squiggle" viewBox="0 0 72 12" aria-hidden="true">
                <path d="M2 9 C14 2, 28 10, 42 5 S62 7, 70 4" />
              </svg>
            </span>{" "}
            <span className="auth-title-account">
              account
              <TitleSparks />
            </span>
          </h1>
        </div>
        <p className="auth-subtitle">Start calling agents in seconds.</p>

        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">
              Email
            </label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon">
                <Mail size={18} strokeWidth={2} />
              </span>
              <input
                id="email"
                className="auth-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">
              Password
            </label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon">
                <Lock size={18} strokeWidth={2} />
              </span>
              <input
                id="password"
                className="auth-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="8+ characters"
              />
              <button
                type="button"
                className="auth-input-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Creating…" : "Create account →"}
          </button>

          <div className="auth-divider">
            <span className="auth-divider-line" />
            <span className="auth-divider-text">or</span>
            <span className="auth-divider-line" />
          </div>

          <p className="auth-footer-link">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
