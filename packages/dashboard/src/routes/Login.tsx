import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { TitleSparks } from "@/components/auth/TitleSparks";

export default function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
      setError(err.message || t("auth.login.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headerPrompt={t("auth.login.header_prompt")}
      headerLinkLabel={t("auth.login.header_link")}
      headerLinkTo="/signup"
      headerLinkAccent
      mascot="heart"
    >
      <div className="auth-card">
        <div className="auth-title-wrap">
          <h1 className="auth-title">
            <span className="auth-title-create">
              {t("auth.login.title_1")}
              <svg className="auth-squiggle auth-squiggle--short" viewBox="0 0 52 12" aria-hidden="true">
                <path d="M2 9 C12 2, 22 10, 32 5 S44 7, 50 4" />
              </svg>
            </span>{" "}
            <span className="auth-title-account">
              {t("auth.login.title_2")}
              <TitleSparks />
            </span>
          </h1>
        </div>
        <p className="auth-subtitle">{t("auth.login.subtitle")}</p>

        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">
              {t("auth.email")}
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
                placeholder={t("auth.email_placeholder")}
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">
              {t("auth.password")}
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
                placeholder={t("auth.password_placeholder_login")}
              />
              <button
                type="button"
                className="auth-input-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <p className="auth-forgot-wrap">
            <a href="#" className="auth-forgot">
              {t("auth.forgot")}
            </a>
          </p>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t("auth.login.submitting") : t("auth.login.submit")}
          </button>

          <div className="auth-divider">
            <span className="auth-divider-line" />
            <span className="auth-divider-text">{t("auth.or")}</span>
            <span className="auth-divider-line" />
          </div>

          <p className="auth-footer-link">
            {t("auth.login.footer_prompt")}{" "}
            <Link to="/signup">{t("auth.login.footer_link")}</Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
