import type { FoundUrl } from "./types";

/** Todas las URLs http(s) dentro de la respuesta, con la clave donde aparecieron. */
export function collectUrls(value: unknown, key = "", out: FoundUrl[] = []): FoundUrl[] {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) out.push({ key, url: value });
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectUrls(v, key, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectUrls(v, k, out);
  }
  return out;
}

/** Acceso tolerante a campos de una respuesta de forma desconocida. */
export function field<T = unknown>(data: unknown, key: string): T | undefined {
  return data && typeof data === "object" ? ((data as Record<string, unknown>)[key] as T) : undefined;
}
