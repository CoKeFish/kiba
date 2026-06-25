import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import {
  Download,
  PackageCheck,
  MessageSquareText,
  ArrowLeftRight,
  Sparkles,
  Check,
  Lock,
  Bot,
  User,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────
   Kiba — animated walkthrough of one paid agent call.
   Download → Install → Ask → Pay (on-chain 95/5) → Answer.
   Auto-plays when scrolled into view; pauses on hover.
   ────────────────────────────────────────────────────────────── */

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];
const SCENE_MS = 4400;

const STEPS = [
  { label: "Download", Icon: Download },
  { label: "Install", Icon: PackageCheck },
  { label: "Ask", Icon: MessageSquareText },
  { label: "Pay", Icon: ArrowLeftRight },
  { label: "Answer", Icon: Sparkles },
];

const WINDOW_TITLES = [
  "kiba.com  ·  download",
  "Kiba  ·  installer",
  "Claude Desktop",
  "x402 settlement  ·  Stellar testnet",
  "Claude Desktop",
];

const CAPTIONS = [
  "Download the 1.1 MB installer — no terminal, no config files.",
  "It detects Claude Desktop, Cursor & Claude Code and wires up MCP for you.",
  "Ask your assistant anything — it finds the right specialist agent on its own.",
  "Payment clears over x402 and settles on-chain with an atomic 95/5 split.",
  "The agent's answer comes back — with a verifiable on-chain receipt.",
];

const listV = { hidden: {}, show: { transition: { staggerChildren: 0.55, delayChildren: 0.2 } } };
const itemV = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

/* ── shared bits ─────────────────────────────────────────────── */

function Bubble({
  side,
  children,
  delay = 0,
  icon,
}: {
  side: "left" | "right";
  children: React.ReactNode;
  delay?: number;
  icon?: React.ReactNode;
}) {
  const isUser = side === "right";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay }}
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        gap: 10,
        alignItems: "flex-end",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isUser ? "var(--bg-inset)" : "color-mix(in srgb, var(--blue-500) 18%, transparent)",
          color: isUser ? "var(--fg-2)" : "var(--blue-300)",
          border: "1px solid var(--border-default)",
        }}
      >
        {icon}
      </div>
      <div
        style={{
          maxWidth: "76%",
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 13.5,
          lineHeight: 1.5,
          fontFamily: "var(--font-sans)",
          background: isUser ? "color-mix(in srgb, var(--blue-500) 16%, var(--bg-card))" : "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          color: "var(--fg-1)",
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}

function Chip({ children, delay = 0, tone = "accent" }: { children: React.ReactNode; delay?: number; tone?: "accent" | "success" }) {
  const c = tone === "success" ? "var(--success)" : "var(--blue-300)";
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.02em",
        color: c,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
      }}
    >
      {children}
    </motion.span>
  );
}

/* ── scenes ──────────────────────────────────────────────────── */

function SceneDownload() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in srgb, var(--blue-500) 16%, transparent)",
            border: "1px solid color-mix(in srgb, var(--blue-500) 30%, transparent)",
            color: "var(--blue-300)",
          }}
        >
          <Download size={22} strokeWidth={1.6} />
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg-1)" }}>
            kiba-installer.exe
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}>
            1.1 MB · Windows
          </div>
        </div>
      </div>

      <div style={{ height: 8, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.4, ease: "easeInOut" }}
          style={{ height: "100%", background: "var(--accent)", boxShadow: "var(--glow-sm)" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.55, duration: 0.35, ease: EASE }}
        style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--success)", fontSize: 13.5, fontWeight: 600 }}
      >
        <Check size={16} strokeWidth={2.4} /> Downloaded — double-click to run
      </motion.div>
    </div>
  );
}

function SceneInstall() {
  const clients = ["Claude Desktop", "Cursor", "Claude Code"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 4px" }}>
      <div style={{ fontSize: 12.5, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>
        Detecting installed clients…
      </div>
      <motion.div variants={listV} initial="hidden" animate="show" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {clients.map((c) => (
          <motion.div
            key={c}
            variants={itemV}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 14px",
              borderRadius: 10,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "color-mix(in srgb, var(--success) 20%, transparent)",
                color: "var(--success)",
                flexShrink: 0,
              }}
            >
              <Check size={13} strokeWidth={3} />
            </span>
            <span style={{ fontSize: 13.5, color: "var(--fg-1)", flex: 1 }}>{c}</span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blue-300)" }}>MCP linked</span>
          </motion.div>
        ))}
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 + 0.55 * 3, duration: 0.4 }}
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-2)" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 8px var(--success)" }} />
        MCP server registered across 3 clients — ready to use.
      </motion.div>
    </div>
  );
}

function SceneAsk() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 4px" }}>
      <Bubble side="right" delay={0.15} icon={<User size={15} />}>
        What's the best USDC yield on Stellar right now?
      </Bubble>
      <Bubble side="left" delay={1.1} icon={<Bot size={15} />}>
        One sec — let me ask a specialist agent for live numbers.
      </Bubble>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.0, duration: 0.35, ease: EASE }}
        style={{ display: "flex", gap: 8, paddingLeft: 38 }}
      >
        <Chip delay={2.0}>🔌 found · yield-hunter</Chip>
        <Chip delay={2.35}>0.005 XLM / call</Chip>
      </motion.div>
    </div>
  );
}

function FlowNode({ title, sub, tone = "default", delay = 0 }: { title: string; sub?: string; tone?: "default" | "agent" | "platform"; delay?: number }) {
  const accentMap = { default: "var(--fg-2)", agent: "var(--blue-300)", platform: "var(--fg-3)" } as const;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.35, ease: EASE }}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "10px 8px",
        borderRadius: 10,
        textAlign: "center",
        background: "var(--bg-elevated)",
        border: `1px solid ${tone === "agent" ? "color-mix(in srgb, var(--blue-500) 40%, transparent)" : "var(--border-default)"}`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {sub && <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: accentMap[tone], marginTop: 2 }}>{sub}</div>}
    </motion.div>
  );
}

function ScenePay() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--warning)" }}
        >
          HTTP 402 Payment Required
        </motion.span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.35 }}
          style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}
        >
          →
        </motion.span>
        <Chip delay={0.8}>0.005 XLM · $0.0006</Chip>
      </div>

      {/* escrow → split flow */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <FlowNode title="You" sub="0.005 XLM" delay={1.1} />
        <Arrow delay={1.3} />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.4, duration: 0.35, ease: EASE }}
          style={{
            flex: 1,
            padding: "10px 8px",
            borderRadius: 10,
            textAlign: "center",
            background: "color-mix(in srgb, var(--blue-500) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--blue-500) 36%, transparent)",
          }}
        >
          <Lock size={15} style={{ color: "var(--blue-300)" }} />
          <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 2 }}>escrow</div>
        </motion.div>
        <Arrow delay={1.7} />
        <div style={{ flex: 1.1, display: "flex", flexDirection: "column", gap: 6 }}>
          <FlowNode title="yield-hunter" sub="95%" tone="agent" delay={1.9} />
          <FlowNode title="platform" sub="5%" tone="platform" delay={2.1} />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.5, duration: 0.4 }}
        style={{ fontSize: 11.5, color: "var(--fg-3)" }}
      >
        Split enforced by the on-chain program — not a backend.
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.85, duration: 0.4, ease: EASE }}
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-2)" }}>tx 5Jr8…pYa7</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--success)", fontSize: 12.5, fontWeight: 600 }}>
          <Check size={15} strokeWidth={2.6} /> finalized · 4.0s
        </span>
      </motion.div>
    </div>
  );
}

function Arrow({ delay = 0 }: { delay?: number }) {
  return (
    <div style={{ alignSelf: "center", width: 22, height: 2, position: "relative", flexShrink: 0 }}>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay, duration: 0.3, ease: EASE }}
        style={{ transformOrigin: "left", width: "100%", height: 2, background: "color-mix(in srgb, var(--blue-500) 55%, transparent)" }}
      />
    </div>
  );
}

function SceneAnswer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 4px" }}>
      <Bubble side="left" delay={0.15} icon={<Bot size={15} />}>
        Best USDC yield right now: <strong style={{ color: "var(--blue-300)" }}>8.42% APY on Kamino</strong> (auto-compounding lend). Runner-up: 7.9% on Drift.
      </Bubble>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1, duration: 0.4, ease: EASE }}
        style={{ display: "flex", gap: 8, paddingLeft: 38, flexWrap: "wrap" }}
      >
        <Chip delay={1.1} tone="success">
          <Check size={13} strokeWidth={3} /> $0.75 paid · yield-hunter
        </Chip>
        <Chip delay={1.4} tone="success">
          on-chain receipt ✓
        </Chip>
      </motion.div>
    </div>
  );
}

const SCENES = [SceneDownload, SceneInstall, SceneAsk, ScenePay, SceneAnswer];

/* ── window chrome + stepper ─────────────────────────────────── */

function WindowFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-card)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 16px",
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-surface)",
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FF5F57" }} />
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FEBC2E" }} />
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28C840" }} />
        <span
          style={{
            marginLeft: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg-3)",
            letterSpacing: "0.02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: "22px 22px", minHeight: 244, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function Stepper({ scene, setScene }: { scene: number; setScene: (n: number) => void }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => {
          const active = i === scene;
          const done = i < scene;
          const { Icon } = s;
          return (
            <button
              key={s.label}
              onClick={() => setScene(i)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "var(--font-display)",
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                transition: "all 160ms cubic-bezier(.2,.7,.2,1)",
                color: active ? "var(--fg-1)" : done ? "var(--blue-300)" : "var(--fg-3)",
                background: active ? "color-mix(in srgb, var(--blue-500) 16%, transparent)" : "transparent",
                border: `1px solid ${active ? "color-mix(in srgb, var(--blue-500) 42%, transparent)" : "var(--border-default)"}`,
              }}
            >
              <span style={{ display: "inline-flex" }}>
                {done ? <Check size={14} strokeWidth={3} /> : <Icon size={14} strokeWidth={1.8} />}
              </span>
              {s.label}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 14, height: 2, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
        <motion.div
          animate={{ width: `${((scene + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.5, ease: EASE }}
          style={{ height: "100%", background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}

/* ── root ────────────────────────────────────────────────────── */

export default function Demo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [scene, setScene] = useState(0);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!inView || hover) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % SCENES.length), SCENE_MS);
    return () => clearTimeout(t);
  }, [scene, inView, hover]);

  const Active = SCENES[scene];

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ maxWidth: 760, margin: "0 auto" }}
    >
      <Stepper scene={scene} setScene={setScene} />
      <WindowFrame title={WINDOW_TITLES[scene]}>
        <motion.div key={scene} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Active />
        </motion.div>
      </WindowFrame>
      <div style={{ minHeight: 40, marginTop: 16, textAlign: "center" }}>
        <motion.p
          key={scene}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--fg-2)", maxWidth: 560, margin: "0 auto" }}
        >
          <span style={{ color: "var(--blue-300)", fontFamily: "var(--font-mono)", marginRight: 8 }}>{scene + 1}/5</span>
          {CAPTIONS[scene]}
        </motion.p>
      </div>
    </div>
  );
}
