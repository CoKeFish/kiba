import type { ComponentType } from "react";
import type { CallResult } from "@/lib/api";

/** Una URL encontrada en la respuesta del servicio, con la clave donde apareció. */
export type FoundUrl = { key: string; url: string };

/** Lo que recibe cada vista: el contenido ya preparado del último estado del pedido. */
export interface ResultViewProps {
  /** La llamada cuyo contenido se muestra (el último estado del pedido). */
  call: CallResult;
  /** La respuesta del servicio (`call.result`). */
  data: unknown;
  /** Todas las URLs http(s) de la respuesta. */
  urls: FoundUrl[];
}

/**
 * Una vista de resultados. Cada tipo de contenido (modelo 3D, música, imágenes…) es una
 * implementación de este contrato, registrada en `registry.ts`. Las vistas reconocen el
 * contenido por su FORMA (p.ej. "trae un .glb"), no por el nombre del servicio: cualquier
 * servicio que devuelva un modelo 3D se verá con el visor 3D.
 */
export interface ResultView {
  id: string;
  /** ¿Esta vista sabe mostrar este contenido? */
  match: (props: ResultViewProps) => boolean;
  Component: ComponentType<ResultViewProps>;
}
