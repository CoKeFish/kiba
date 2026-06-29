const MASCOTS: Record<string, string> = {
  "translator-pro": "/agents/corazon.png",
  "price-oracle": "/agents/triangulo.png",
  "yield-hunter": "/agents/circulo.png",
  "risk-auditor": "/agents/morado.png",
  "code-reviewer": "/agents/estrella.png",
  firecrawl: "/agents/cuadrado.png",
};

const MASCOT_POOL = [
  "/agents/corazon.png",
  "/agents/triangulo.png",
  "/agents/circulo.png",
  "/agents/morado.png",
  "/agents/estrella.png",
  "/agents/cuadrado.png",
];

export function mascotFor(service: string): string {
  if (MASCOTS[service]) return MASCOTS[service];
  let h = 0;
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) >>> 0;
  return MASCOT_POOL[h % MASCOT_POOL.length];
}
