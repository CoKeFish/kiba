import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import "./auth.css";

const MASCOTS = {
  triangle: { src: "/agents/triangle.png", className: "auth-mascot auth-mascot--triangle" },
  heart: { src: "/agents/heart-peek.png", className: "auth-mascot auth-mascot--heart" },
} as const;

type MascotKind = keyof typeof MASCOTS;

type AuthShellProps = {
  headerPrompt: string;
  headerLinkLabel: string;
  headerLinkTo: string;
  headerLinkAccent?: boolean;
  mascot?: MascotKind | false;
  children: ReactNode;
};

export function AuthShell({
  headerPrompt,
  headerLinkLabel,
  headerLinkTo,
  headerLinkAccent = false,
  mascot = "triangle",
  children,
}: AuthShellProps) {
  const mascotConfig = mascot ? MASCOTS[mascot] : null;

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob--purple" aria-hidden="true" />
      <div className="auth-dots" aria-hidden="true" />

      <header className="auth-header">
        <Link to="/" className="auth-brand" aria-label="Kiba home">
          <span className="auth-brand-text">Kiba</span>
          <span className="auth-brand-dot" aria-hidden="true" />
        </Link>
        <div className="auth-header-cta">
          <span className="auth-header-prompt">{headerPrompt}</span>
          <Link
            to={headerLinkTo}
            className={`auth-header-btn${headerLinkAccent ? " auth-header-btn--accent" : ""}`}
          >
            {headerLinkLabel}
          </Link>
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-scene">
          <div className="auth-card-wrap">
            {mascotConfig && (
              <img
                src={mascotConfig.src}
                alt=""
                className={mascotConfig.className}
                width={165}
                height={165}
                aria-hidden="true"
              />
            )}
            {children}
          </div>
        </div>
      </main>

      <footer className="auth-footer">
        <span>© 2024 Kiba Technologies, Inc.</span>
        <span className="auth-footer-sep" aria-hidden="true">
          •
        </span>
        <a href="#">Privacy</a>
        <span className="auth-footer-sep" aria-hidden="true">
          •
        </span>
        <a href="#">Terms</a>
      </footer>
    </div>
  );
}
