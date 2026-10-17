import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { ResultView, ResultViewProps } from "../types";

/** Vista de respaldo: texto plano y enlaces a los archivos de la respuesta. */
function Generic({ data, urls }: ResultViewProps) {
  const { t } = useTranslation();
  if (typeof data === "string") {
    return <p className="text-sm whitespace-pre-wrap">{data}</p>;
  }
  if (urls.length === 0) {
    return <p className="text-sm text-[var(--color-fg-muted)]">{t("results.no_preview")}</p>;
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {urls.map((u) => (
          <li key={u.url}>
            <a
              href={u.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 break-all"
            >
              <ExternalLink className="w-3 h-3 shrink-0" /> {u.key || u.url}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--color-fg-muted)]">{t("results.links_expire")}</p>
    </div>
  );
}

export const genericView: ResultView = {
  id: "generic",
  match: () => true,
  Component: Generic,
};
