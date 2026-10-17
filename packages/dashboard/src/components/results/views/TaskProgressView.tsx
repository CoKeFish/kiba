import { useTranslation } from "react-i18next";
import { field } from "../content";
import type { ResultView, ResultViewProps } from "../types";

/**
 * Servicios de varios pasos (crear → consultar con `taskId`, p.ej. Meshy) responden primero con
 * el estado de la tarea, sin archivos. Esta vista muestra ese estado mientras no hay contenido.
 */
function TaskProgress({ data, urls }: ResultViewProps) {
  const { t } = useTranslation();
  const status = String(field(data, "status") ?? "");
  const progress = Number(field(data, "progress") ?? 0);
  const error = field<string>(data, "error");
  const done = field<boolean>(data, "done") === true;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span>{done ? t("results.task.ended", { status }) : t("results.task.running")}</span>
        {!done && <span className="font-mono">{progress}%</span>}
      </div>
      {!done && (
        <div className="h-2 rounded-full bg-[var(--color-accent)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] transition-[width] duration-500"
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </div>
      )}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {!done && urls.length === 0 && (
        <p className="text-xs text-[var(--color-fg-muted)]">{t("results.task.hint")}</p>
      )}
    </div>
  );
}

export const taskProgressView: ResultView = {
  id: "task-progress",
  // Tarea con taskId que aún no entregó archivos (en curso, o terminó sin contenido).
  match: ({ data, urls }) => typeof field(data, "taskId") === "string" && urls.length === 0,
  Component: TaskProgress,
};
