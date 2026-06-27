import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { TitleSparks } from "@/components/auth/TitleSparks";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthShell
      headerPrompt="New to Kiba?"
      headerLinkLabel="Sign up free"
      headerLinkTo="/signup"
      headerLinkAccent
      mascot="heart"
    >
      <div className="auth-card">
        <div className="auth-title-wrap">
          <h1 className="auth-title">
            <span className="auth-title-create">
              Wel
              <svg className="auth-squiggle auth-squiggle--short" viewBox="0 0 52 12" aria-hidden="true">
                <path d="M2 9 C12 2, 22 10, 32 5 S44 7, 50 4" />
              </svg>
            </span>
            come{" "}
            <span className="auth-title-account">
              bac
              <span className="auth-title-k">
                k
                <TitleSparks />
              </span>
            </span>
          </h1>
        </div>
        <p className="auth-subtitle">Log in to your Kiba account.</p>

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
                autoComplete="current-password"
                placeholder="Enter your password"
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

          <p className="auth-forgot-wrap">
            <a href="#" className="auth-forgot">
              Forgot password?
            </a>
          </p>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in →"}
          </button>

          <div className="auth-divider">
            <span className="auth-divider-line" />
            <span className="auth-divider-text">or</span>
            <span className="auth-divider-line" />
          </div>

          <p className="auth-footer-link">
            No account? <Link to="/signup">Sign up free</Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
