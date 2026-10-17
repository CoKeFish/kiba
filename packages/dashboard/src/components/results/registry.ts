import type { ResultView, ResultViewProps } from "./types";
import { taskProgressView } from "./views/TaskProgressView";
import { genericView } from "./views/GenericView";

/**
 * Vistas registradas, en orden de prioridad: gana la PRIMERA cuyo `match` acepte el contenido.
 *
 * Para añadir un tipo (p.ej. el visor de modelos 3D o el reproductor de música): crear
 * `views/<Tipo>View.tsx` que exporte un `ResultView` y ponerlo aquí ANTES de las genéricas.
 * Las vistas pesadas (visor 3D) deben cargar su librería con `import()` dentro del componente,
 * para no engordar el bundle del resto del dashboard.
 */
const VIEWS: ResultView[] = [
  taskProgressView,
  // `genericView` acepta todo: siempre al final.
  genericView,
];

export function resolveView(props: ResultViewProps): ResultView {
  return VIEWS.find((v) => v.match(props)) ?? genericView;
}
