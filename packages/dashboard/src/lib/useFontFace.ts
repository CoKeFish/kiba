import { useEffect, useState } from "react";

const loaded = new Map<string, Promise<string>>();
let counter = 0;

/**
 * Carga una fuente desde una URL (vista previa de un catálogo, o el archivo comprado) y devuelve el
 * nombre de familia con el que usarla en `fontFamily`, o `null` mientras carga o si falla.
 * Cada URL se carga una sola vez aunque la pidan varias tarjetas.
 */
export function useFontFace(url?: string): string | null {
  const [family, setFamily] = useState<string | null>(null);

  useEffect(() => {
    if (!url || typeof FontFace === "undefined") return;
    let alive = true;
    let promise = loaded.get(url);
    if (!promise) {
      const name = `kiba-font-${++counter}`;
      promise = new FontFace(name, `url("${url}")`).load().then((face) => {
        document.fonts.add(face);
        return name;
      });
      // Si falla, se puede reintentar más tarde (no se queda guardado el error).
      promise.catch(() => loaded.delete(url));
      loaded.set(url, promise);
    }
    promise.then((name) => alive && setFamily(name)).catch(() => alive && setFamily(null));
    return () => {
      alive = false;
    };
  }, [url]);

  return family;
}
