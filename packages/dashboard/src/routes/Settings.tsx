import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { chain } from "@/lib/chain";
import { RechargeWalletKit } from "@/components/RechargeWalletKit";
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  Shield,
  User,
  UserPlus,
} from "lucide-react";
import "./settings.css";

const MASCOTS = {
  corazon: "/agents/corazon.png",
  circulo: "/agents/circulo.png",
  morado: "/agents/morado.png",
} as const;

function explorerWallet(addr: string): string {
  return chain.explorerAddr(addr);
}

function SettingsSparks() {
  return (
    <svg className="settings-sparks" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M11 10V3" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 10L17 6" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 10L15 16" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="settings-action"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy"
    >
      {copied ? <Check size={14} style={{ color: "var(--color-success)" }} /> : <Copy size={14} />}
    </button>
  );
}

function FieldRow({
  label,
  value,
  hint,
  copyable,
  link,
  success,
}: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
  link?: string;
  success?: boolean;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field__main">
        <p className="settings-field__label">{label}</p>
        <p className={`settings-field__value${success ? " settings-field__value--ok" : ""}`}>
          {value}
        </p>
        {hint && <p className="settings-field__hint">{hint}</p>}
      </div>
      <div className="settings-field__actions">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="settings-action"
            aria-label="Open in explorer"
          >
            <ExternalLink size={14} />
          </a>
        )}
        {copyable && <CopyButton value={value} />}
      </div>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const {
    data: wallet,
    isFetching,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ["wallet"],
    queryFn: api.wallet,
    refetchInterval: 30_000,
  });

  return (
    <div className="settings-page">
      <header className="settings-head">
        <div className="settings-title-wrap">
          <SettingsSparks />
          <h1 className="settings-title">Settings</h1>
        </div>
        <p className="settings-subtitle">Account, wallet and identity.</p>
      </header>

      <section className="settings-card">
        <img
          src={MASCOTS.corazon}
          alt=""
          aria-hidden
          className="settings-card__mascot settings-card__mascot--heart"
        />
        <div className="settings-card__head">
          <div>
            <div className="settings-card__title-row">
              <div className="settings-card__icon">
                <User size={18} strokeWidth={2} />
              </div>
              <h2 className="settings-card__title">Profile</h2>
            </div>
            <p className="settings-card__desc">Your personal account information on Kiba.</p>
          </div>
        </div>
        <div className="settings-card__body">
          {me ? (
            <>
              <FieldRow label="Email" value={me.email} copyable />
              <FieldRow label="User ID" value={String(me.id)} copyable />
              <FieldRow
                label="Account created"
                value={format(new Date(me.created_at * 1000), "PPpp")}
                copyable
              />
            </>
          ) : (
            <p className="settings-loading">Loading profile…</p>
          )}
        </div>
      </section>

      <section className="settings-card">
        <img
          src={MASCOTS.circulo}
          alt=""
          aria-hidden
          className="settings-card__mascot settings-card__mascot--circle"
        />
        <div className="settings-card__head">
          <div>
            <div className="settings-card__title-row">
              <div className="settings-card__icon">
                <Shield size={18} strokeWidth={2} />
              </div>
              <h2 className="settings-card__title">Custodial wallet</h2>
            </div>
            <p className="settings-card__desc">
              Your Stellar keypair. Lives in the gateway. Signs every{" "}
              <code>open_escrow</code> and <code>claim_payment</code> on your behalf.
            </p>
          </div>
          <button
            type="button"
            className="settings-card__refresh"
            onClick={() => refetchWallet()}
            disabled={isFetching}
            aria-label="Refresh wallet"
          >
            <RefreshCw size={15} className={isFetching ? "is-spinning" : ""} />
          </button>
        </div>
        <div className="settings-card__body">
          {wallet ? (
            <>
              <FieldRow
                label={`Public key (${chain.networkLabel})`}
                value={wallet.pubkey}
                copyable
                link={explorerWallet(wallet.pubkey)}
              />
              <FieldRow
                label="On-chain balance"
                value={`${wallet.asset_amount.toFixed(6)} ${wallet.asset}`}
                hint={`${wallet.base_units.toLocaleString()} ${wallet.base_unit_name} — refilled on-demand from the gateway treasury when you make a call`}
              />
              <FieldRow label="Wallet status" value="Active" success />
              <FieldRow
                label="Network"
                value={chain.networkLabel}
                link="https://stellar.expert/explorer/testnet"
              />
              <FieldRow
                label="Treasury wallet (refill source)"
                value={wallet.master_wallet}
                hint={`When your custodial runs low, the gateway transfers ${wallet.asset} from this master wallet to yours.`}
                copyable
                link={explorerWallet(wallet.master_wallet)}
              />
              <RechargeWalletKit
                walletAddress={wallet.pubkey}
                onFunded={() => {
                  refetchWallet();
                  qc.invalidateQueries({ queryKey: ["balance"] });
                }}
              />
            </>
          ) : (
            <p className="settings-loading">Loading wallet…</p>
          )}
        </div>
      </section>

      <section className="settings-card">
        <img
          src={MASCOTS.morado}
          alt=""
          aria-hidden
          className="settings-card__mascot settings-card__mascot--purple"
        />
        <div className="settings-card__head">
          <div>
            <div className="settings-card__title-row">
              <div className="settings-card__icon">
                <Shield size={18} strokeWidth={2} />
              </div>
              <h2 className="settings-card__title">Security &amp; preferences</h2>
            </div>
            <p className="settings-card__desc">
              Manage how your account stays secure and how you receive updates.
            </p>
          </div>
        </div>
        <div className="settings-card__body">
          <div className="settings-prefs">
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <Bell size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">Notifications</p>
                <p className="settings-pref__sub">Email updates</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <Lock size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">Session security</p>
                <p className="settings-pref__sub">1 active session</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <UserPlus size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">Connected identity</p>
                <p className="settings-pref__sub">{me?.email ?? "Email"}</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
