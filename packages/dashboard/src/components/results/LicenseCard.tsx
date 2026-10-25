import { useTranslation } from "react-i18next";
import { ExternalLink, FileBadge, ShieldCheck, ShieldOff } from "lucide-react";
import { format } from "date-fns";
import type { LicenseSummary } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Tarjeta de la licencia de un resultado: el documento del archivo comprado (términos, hash,
 * precio) y el pago en Stellar que lo prueba. Enlaces al documento, a la verificación pública
 * y a la transacción.
 */
export function LicenseCard({ license, compact = false }: { license: LicenseSummary; compact?: boolean }) {
  const { t } = useTranslation();
  const terms = license.terms ?? {};
  const valid = license.status === "valid";
  const yesNo = (v: boolean | undefined) => (v ? t("results.license.yes") : t("results.license.no"));
  const rows: [string, string][] = [
    [t("results.license.template"), String(terms.name ?? "commercial")],
    [t("results.license.allowed_users"), (terms.user ?? []).join(", ")],
    [t("results.license.usage"), (terms.usage ?? []).join(", ")],
    [
      t("results.license.territory"),
      (terms.geo ?? ["*"]).map((g) => (g === "*" ? t("results.license.worldwide") : g)).join(", "),
    ],
    [
      t("results.license.duration"),
      terms.duration === "perpetual" || !terms.duration ? t("results.license.perpetual") : String(terms.duration),
    ],
    [t("results.license.attribution"), yesNo(terms.attribution)],
    [t("results.license.exclusive"), yesNo(terms.exclusive)],
    [t("results.license.transferable"), yesNo(terms.transferable)],
  ];
  const link = (href: string, label: string) => (
    <a
      key={href}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
    >
      <ExternalLink className="w-3 h-3" /> {label}
    </a>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileBadge className="w-4 h-4" /> {t("results.license.title")}
          <Badge tone={valid ? "success" : "danger"}>
            {valid ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> {t("results.license.status.valid")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <ShieldOff className="w-3 h-3" /> {t("results.license.status.revoked")}
              </span>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {!compact && <p className="text-sm text-[var(--color-fg-muted)]">{t("results.license.explainer")}</p>}

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {(license.title || license.assetId) && (
            <div>
              <dt className="text-[var(--color-fg-muted)]">{t("results.license.asset")}</dt>
              <dd className="break-words">{license.title ?? license.assetId}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-[var(--color-fg-muted)]">{t("results.license.hash")}</dt>
            <dd className="font-mono text-xs break-all">{license.assetSha256}</dd>
          </div>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[var(--color-fg-muted)]">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          {terms.notes && (
            <div className="sm:col-span-2">
              <dt className="text-[var(--color-fg-muted)]">{t("results.license.notes")}</dt>
              <dd>{terms.notes}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--color-fg-muted)]">{t("results.license.issued")}</dt>
            <dd>{format(new Date(license.issuedAt * 1000), "MMM d yyyy, HH:mm:ss")}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-fg-muted)]">{t("results.license.payment")}</dt>
            <dd>
              {license.explorerUrl
                ? link(license.explorerUrl, t("results.onchain"))
                : t("results.license.payment_pending")}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--color-fg-muted)]">{t("results.license.fingerprint")}</dt>
            <dd className="font-mono text-xs break-all">{license.documentSha256}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-4">
          {link(license.documentUrl, t("results.license.document"))}
          {link(license.dashboardUrl, t("results.license.verify"))}
        </div>
        <p className="text-xs text-[var(--color-fg-muted)] font-mono break-all">{license.id}</p>
      </CardBody>
    </Card>
  );
}
