import type { CallResult } from "@/lib/api";
import { collectUrls } from "./content";
import { resolveView } from "./registry";

/** Muestra el contenido de una llamada con la vista registrada que lo reconozca. */
export function ResultPreview({ call }: { call: CallResult }) {
  const props = { call, data: call.result, urls: collectUrls(call.result) };
  const { Component } = resolveView(props);
  return <Component {...props} />;
}

/**
 * El último estado del pedido: de la llamada abierta y las demás del mismo `taskId`, la más
 * reciente que ya respondió (p.ej. la última consulta de estado de un modelo 3D).
 */
export function latestState(call: CallResult): CallResult {
  const all = [call, ...(call.related ?? [])].filter((r) => r.status === "done");
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? call;
}
