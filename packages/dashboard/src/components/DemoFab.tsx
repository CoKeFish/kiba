import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

// ─── Config de la demo (editar aquí) ─────────────────────────────────────────
// Solo el publisher dueño de DEMO_SERVICE ve el FAB. Los links del panel son
// defaults provisionales: añadir/quitar líneas según lo que pida la demo.
const DEMO_SERVICE = "web-scraper";
const DEMO_LINKS = [
  { to: "/app/publisher", labelKey: "demo_fab.links.overview" },
  { to: "/app/publisher/payouts", labelKey: "demo_fab.links.payouts" },
  { to: "/app/publisher/analytics", labelKey: "demo_fab.links.analytics" },
  { to: "/app/transactions", labelKey: "demo_fab.links.transactions" },
];

const FAB_SIZE = 52;
const MARGIN = 8;
const POS_KEY = "kiba:demo-fab-pos";
/** Menos de esto (px acumulados) en un pointer down→up se trata como click, no drag. */
const CLICK_SLOP = 4;

function clampPos(x: number, y: number) {
  return {
    x: Math.min(Math.max(MARGIN, x), window.innerWidth - FAB_SIZE - MARGIN),
    y: Math.min(Math.max(MARGIN, y), window.innerHeight - FAB_SIZE - MARGIN),
  };
}

function initialPos() {
  try {
    const saved = localStorage.getItem(POS_KEY);
    if (saved) {
      const p = JSON.parse(saved) as { x?: unknown; y?: unknown };
      if (typeof p.x === "number" && typeof p.y === "number") return clampPos(p.x, p.y);
    }
  } catch {
    // localStorage corrupto/inaccesible → default
  }
  return clampPos(window.innerWidth - FAB_SIZE - 24, window.innerHeight - FAB_SIZE - 24);
}

/**
 * Herramienta para demos en vivo: FAB draggable visible SOLO para el publisher dueño de
 * DEMO_SERVICE. Despliega un panel con accesos directos y el fondeo de 1 USDC al escrow
 * (requiere DEMO_TOOLS=1 en el gateway; sin flag el endpoint devuelve 404).
 */
export function DemoFab() {
  const { user } = useAuth();
  const { data: myAgents } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
    enabled: !!user?.is_publisher,
    staleTime: 5 * 60_000,
  });
  // En dev (vite local) se muestra siempre para poder probarlo; en prod (build) solo
  // lo ve el publisher dueño de DEMO_SERVICE.
  if (!import.meta.env.DEV && !myAgents?.some((a) => a.service === DEMO_SERVICE)) return null;
  return <DemoFabInner />;
}

function DemoFabInner() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pos, setPos] = useState(initialPos);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ pointerId: number; dx: number; dy: number; startX: number; startY: number; moved: number } | null>(null);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fund = useMutation({
    mutationFn: () => api.demoFund(DEMO_SERVICE),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    },
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture best-effort: sin ella el drag sigue mientras el puntero quede sobre el botón
    }
    drag.current = {
      pointerId: e.pointerId,
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: 0,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.startX, e.clientY - d.startY));
    if (d.moved >= CLICK_SLOP) setOpen(false);
    setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved < CLICK_SLOP) {
      setOpen((o) => !o);
    } else {
      setPos((p) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          // sin persistencia no pasa nada; la posición vive en el estado
        }
        return p;
      });
    }
  };

  // El panel abre hacia el cuadrante con espacio (FAB pegado a un borde no lo saca de pantalla).
  const rightHalf = pos.x + FAB_SIZE / 2 > window.innerWidth / 2;
  const bottomHalf = pos.y + FAB_SIZE / 2 > window.innerHeight / 2;
  const panelStyle: CSSProperties = {
    position: "fixed",
    zIndex: 9998,
    width: 280,
    background: "#fff",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "0 12px 40px color-mix(in srgb, var(--color-fg) 16%, transparent)",
    padding: 14,
    ...(rightHalf
      ? { right: Math.max(MARGIN, window.innerWidth - pos.x - FAB_SIZE) }
      : { left: pos.x }),
    ...(bottomHalf
      ? { bottom: Math.min(window.innerHeight - MARGIN, window.innerHeight - pos.y + MARGIN) }
      : { top: pos.y + FAB_SIZE + MARGIN }),
  };

  return (
    <>
      {open && (
        <div style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--color-fg)" }}>
              {t("demo_fab.title")}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--c-purple)",
                background: "color-mix(in srgb, var(--c-purple) 10%, transparent)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {DEMO_SERVICE}
            </span>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
            {DEMO_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 13,
                  color: "var(--color-fg)",
                  textDecoration: "none",
                }}
                className="demo-fab-link"
              >
                {t(l.labelKey)}
              </Link>
            ))}
          </nav>

          <button
            onClick={() => fund.mutate()}
            disabled={fund.isPending}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 999,
              border: "none",
              cursor: fund.isPending ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 13,
              color: "#fff",
              background: fund.isPending
                ? "var(--color-fg-subtle)"
                : "linear-gradient(90deg, var(--color-primary), var(--c-purple))",
            }}
          >
            {fund.isPending ? t("demo_fab.funding") : t("demo_fab.fund_button")}
          </button>

          {fund.isSuccess && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-fg-muted)" }}>
              {fund.data.funded ? t("demo_fab.funded") : t("demo_fab.funded_offchain")}
              {fund.data.explorer_url && (
                <a
                  href={fund.data.explorer_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginLeft: 6,
                    color: "var(--color-primary)",
                    fontWeight: 600,
                  }}
                >
                  {t("demo_fab.view_tx")} <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          {fund.isError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#c0392b" }}>
              {t("demo_fab.error")}: {(fund.error as Error).message}
            </div>
          )}
        </div>
      )}

      <button
        aria-label={t("demo_fab.title")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          zIndex: 9999,
          width: FAB_SIZE,
          height: FAB_SIZE,
          borderRadius: "50%",
          border: "none",
          cursor: "grab",
          touchAction: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          background: "linear-gradient(135deg, var(--color-primary), var(--c-purple))",
          boxShadow: "0 6px 20px color-mix(in srgb, var(--c-purple) 40%, transparent)",
        }}
      >
        <Zap size={22} />
      </button>

      <style>{`
        .demo-fab-link:hover {
          background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        }
      `}</style>
    </>
  );
}
