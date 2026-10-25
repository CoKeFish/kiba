import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Check, ExternalLink, ShieldCheck, ShieldOff, X } from "lucide-react";
import { api } from "@/lib/api";
import { LicenseCard } from "@/components/results/LicenseCard";

/**
 * Verificación PÚBLICA de una licencia (sin cuenta): /verify/:id. Es la URL que va en el
 * certificado y en el QR. Pide al gateway que compruebe la firma, el emisor y el estado, y
 * muestra el resultado con enlaces a la credencial, al certificado y a la transacción.
 */
export default function Verify() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify-license", id],
    queryFn: () => api.verifyLicense(id),
    retry: false,
  });

  const checks: [string, boolean | undefined][] = data
    ? [
        [t("verify.checks.signature"), data.checks.signature],
        [t("verify.checks.issuer"), data.checks.issuerIsKiba],
        [t("verify.checks.not_revoked"), data.checks.notRevoked],
        [t("verify.checks.payment"), data.checks.paymentAnchored],
      ]
    : [];

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <header className="flex items-center justify-between">
          <a href="https://kiba.tools" className="font-semibold text-lg">
            Kiba
          </a>
          <span className="text-xs text-[var(--color-fg-muted)]">{t("verify.powered")}</span>
        </header>

        <h1 className="text-2xl font-semibold">{t("verify.title")}</h1>

        {isLoading ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t("verify.loading")}</p>
        ) : error || !data ? (
          <p className="text-sm text-[var(--color-danger)]">{t("verify.not_found")}</p>
        ) : (
          <>
            <div
              className={`rounded-lg border p-4 flex items-center gap-3 ${
                data.verified ? "border-[var(--color-success)]" : "border-[var(--color-danger)]"
              }`}
            >
              {data.verified ? (
                <ShieldCheck className="w-6 h-6 text-[var(--color-success)]" />
              ) : (
                <ShieldOff className="w-6 h-6 text-[var(--color-danger)]" />
              )}
              <div>
                <p className="font-medium">{data.verified ? t("verify.ok") : t("verify.bad")}</p>
                {data.error && <p className="text-xs text-[var(--color-fg-muted)]">{data.error}</p>}
              </div>
            </div>

            <ul className="space-y-1 text-sm">
              {checks.map(([label, ok]) => (
                <li key={label} className="flex items-center gap-2">
                  {ok ? (
                    <Check className="w-4 h-4 text-[var(--color-success)]" />
                  ) : (
                    <X className="w-4 h-4 text-[var(--color-fg-muted)]" />
                  )}
                  <span>{label}</span>
                </li>
              ))}
            </ul>

            <LicenseCard license={data.summary} compact />

            <p className="text-xs text-[var(--color-fg-muted)]">
              {t("verify.how")}{" "}
              <a
                href={data.summary.credentialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
              >
                {t("verify.credential")} <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
