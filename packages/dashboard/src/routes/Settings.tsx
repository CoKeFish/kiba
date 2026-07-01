import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { chain } from "@/lib/chain";
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
  const { t } = useTranslation();
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
      aria-label={t("settings.copy_aria")}
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
  const { t } = useTranslation();
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
            aria-label={t("settings.open_explorer_aria")}
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
  const { t } = useTranslation();
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
          <h1 className="settings-title">{t("settings.title")}</h1>
        </div>
        <p className="settings-subtitle">{t("settings.subtitle")}</p>
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
              <h2 className="settings-card__title">{t("settings.profile_title")}</h2>
            </div>
            <p className="settings-card__desc">{t("settings.profile_desc")}</p>
          </div>
        </div>
        <div className="settings-card__body">
          {me ? (
            <>
              <FieldRow label={t("settings.email_label")} value={me.email} copyable />
              <FieldRow label={t("settings.user_id_label")} value={String(me.id)} copyable />
              <FieldRow
                label={t("settings.account_created_label")}
                value={format(new Date(me.created_at * 1000), "PPpp")}
                copyable
              />
            </>
          ) : (
            <p className="settings-loading">{t("settings.loading_profile")}</p>
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
              <h2 className="settings-card__title">{t("settings.custodial_wallet_title")}</h2>
            </div>
            <p className="settings-card__desc">
              {t("settings.custodial_wallet_desc_before")}{" "}
              <code>open_escrow</code> {t("settings.custodial_wallet_desc_between")}{" "}
              <code>claim_payment</code> {t("settings.custodial_wallet_desc_after")}
            </p>
          </div>
          <button
            type="button"
            className="settings-card__refresh"
            onClick={() => refetchWallet()}
            disabled={isFetching}
            aria-label={t("settings.refresh_wallet_aria")}
          >
            <RefreshCw size={15} className={isFetching ? "is-spinning" : ""} />
          </button>
        </div>
        <div className="settings-card__body">
          {wallet ? (
            <>
              <FieldRow
                label={t("settings.public_key_label", { network: chain.networkLabel })}
                value={wallet.pubkey}
                copyable
                link={explorerWallet(wallet.pubkey)}
              />
              <FieldRow
                label={t("settings.onchain_balance_label")}
                value={`${wallet.asset_amount.toFixed(6)} ${wallet.asset}`}
                hint={t("settings.balance_hint", {
                  units: wallet.base_units.toLocaleString(),
                  unit_name: wallet.base_unit_name,
                })}
              />
              <FieldRow
                label={t("settings.wallet_status_label")}
                value={t("settings.wallet_status_active")}
                success
              />
              <FieldRow
                label={t("settings.network_label")}
                value={chain.networkLabel}
                link="https://stellar.expert/explorer/testnet"
              />
              <FieldRow
                label={t("settings.treasury_wallet_label")}
                value={wallet.master_wallet}
                hint={t("settings.treasury_hint", { asset: wallet.asset })}
                copyable
                link={explorerWallet(wallet.master_wallet)}
              />
            </>
          ) : (
            <p className="settings-loading">{t("settings.loading_wallet")}</p>
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
              <h2 className="settings-card__title">{t("settings.security_title")}</h2>
            </div>
            <p className="settings-card__desc">{t("settings.security_desc")}</p>
          </div>
        </div>
        <div className="settings-card__body">
          <div className="settings-prefs">
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <Bell size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">{t("settings.notifications_title")}</p>
                <p className="settings-pref__sub">{t("settings.notifications_sub")}</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <Lock size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">{t("settings.session_security_title")}</p>
                <p className="settings-pref__sub">{t("settings.session_security_sub")}</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
            <button type="button" className="settings-pref">
              <div className="settings-pref__icon">
                <UserPlus size={17} strokeWidth={2} />
              </div>
              <div className="settings-pref__text">
                <p className="settings-pref__title">{t("settings.connected_identity_title")}</p>
                <p className="settings-pref__sub">{me?.email ?? t("settings.connected_identity_fallback")}</p>
              </div>
              <ChevronRight size={16} className="settings-pref__chev" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
