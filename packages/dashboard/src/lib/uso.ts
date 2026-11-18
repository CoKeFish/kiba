// Qué opciones se usan y cuánto se queda la gente en cada pantalla (métricas internas, Umami).
//
// Clics: cada control lleva el atributo data-kb-event con un nombre del tipo «zona: acción» (un
// literal fijo, en español, de 50 caracteres como máximo) y aquí se envía ese nombre al hacer clic. Los data-kb-<clave> del mismo
// elemento viajan como detalle; nunca deben llevar nada escrito por el usuario. No se usa el
// data-umami-event del tracker porque en un enlace cancela la navegación y recarga la página.
//
// Permanencia: "permanece 10 s", "30 s", "1 min", "3 min" y "10 min" según los segundos que la
// pantalla lleva visible y con actividad en el último minuto. La cuenta vuelve a cero al cambiar
// de ruta.
//
// Mismo código que el script en línea de packages/landing/src/layouts/Base.astro y el de
// packages/docs/docusaurus.config.ts. El informe sale con scripts/metricas-uso.mjs.

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, string>) => void };
  }
}

const MARCAS: [segundos: number, nombre: string][] = [
  [10, "10 s"],
  [30, "30 s"],
  [60, "1 min"],
  [180, "3 min"],
  [600, "10 min"],
];

function enviar(nombre: string, datos?: Record<string, string>): boolean {
  window.umami?.track(nombre, datos);
  return Boolean(window.umami);
}

export function medirUso(): void {
  // Solo los clics de una persona (isTrusted), con el nombre del control más cercano.
  document.addEventListener(
    "click",
    (e) => {
      const el = e.isTrusted && e.target instanceof Element ? e.target.closest("[data-kb-event]") : null;
      if (!el) return;
      let datos: Record<string, string> | undefined;
      for (const a of Array.from(el.attributes)) {
        if (a.name.startsWith("data-kb-") && a.name !== "data-kb-event") {
          datos = { ...datos, [a.name.slice("data-kb-".length)]: a.value };
        }
      }
      enviar(el.getAttribute("data-kb-event") ?? "", datos);
    },
    true,
  );

  let ruta = window.location.pathname;
  let segundos = 0;
  let siguiente = 0;
  let ultimaActividad = Date.now();
  for (const tipo of ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"]) {
    window.addEventListener(tipo, () => (ultimaActividad = Date.now()), { capture: true, passive: true });
  }
  window.setInterval(() => {
    if (window.location.pathname !== ruta) {
      ruta = window.location.pathname;
      segundos = 0;
      siguiente = 0;
      ultimaActividad = Date.now();
    }
    if (document.visibilityState !== "visible" || Date.now() - ultimaActividad > 60_000) return;
    segundos += 1;
    const marca = MARCAS[siguiente];
    if (marca && segundos >= marca[0] && enviar(`permanece ${marca[1]}`)) siguiente += 1;
  }, 1000);
}
