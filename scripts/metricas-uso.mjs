#!/usr/bin/env node
// Informe de uso a partir de Umami: qué botón se pulsa primero al llegar, qué opciones se usan,
// cuáles no se usan nunca y cuánto se queda la gente en cada página.
//
//   doppler run --project shared --config prd --only-secrets UMAMI_ADMIN_PASSWORD -- \
//     node scripts/metricas-uso.mjs [días]        (por defecto, los últimos 30 días)
//
// El catálogo de opciones sale del propio código: todo literal data-kb-event o kbEvent de la
// landing, la app y la documentación. Umami solo enseña lo que recibió, así que las opciones sin
// uso solo se pueden ver cruzando ese catálogo con los eventos, que es lo que hace este script.
// Solo lee. No imprime secretos.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UMAMI = (process.env.UMAMI_URL || "https://metrics.kiba.tools").replace(/\/$/, "");
const USER = process.env.UMAMI_ADMIN_USER || "admin";
const PASSWORD = process.env.UMAMI_ADMIN_PASSWORD;
const DAYS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 30;

const SITES = [
  { domain: "kiba.tools", sources: ["packages/landing/src"] },
  { domain: "app.kiba.tools", sources: ["packages/dashboard/src"] },
  { domain: "docs.kiba.tools", sources: ["packages/docs/docusaurus.config.ts", "packages/docs/src"] },
];
const MARKS = ["10 s", "30 s", "1 min", "3 min", "10 min"];
const MARK_PREFIX = "permanece ";
const VISIT_GAP_MS = 30 * 60 * 1000; // Umami abre una visita nueva tras 30 minutos sin actividad.
const NAME_RE = /(?:data-kb-event["']?\s*[:=]\s*|kbEvent:\s*)["']([^"']+)["']/g;

function sourceFiles(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const full = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return [".astro", ".tsx", ".ts", ".jsx", ".js", ".mdx"].includes(extname(entry.name)) ? [full] : [];
  });
}

function catalog(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const file of sourceFiles(join(ROOT, source))) {
      for (const match of readFileSync(file, "utf8").matchAll(NAME_RE)) names.add(match[1]);
    }
  }
  return names;
}

async function api(path, token, init = {}) {
  const res = await fetch(UMAMI + path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]} respondió ${res.status}`);
  return res.json();
}

async function allEvents(token, websiteId, startAt, endAt) {
  const pageSize = 500;
  const events = [];
  for (let page = 1; ; page += 1) {
    const res = await api(
      `/api/websites/${websiteId}/events?startAt=${startAt}&endAt=${endAt}&page=${page}&pageSize=${pageSize}`,
      token,
    );
    events.push(...res.data);
    if (res.data.length < pageSize || events.length >= res.count) return events;
  }
}

// Agrupa los eventos en visitas: mismo visitante y menos de 30 minutos entre un evento y el siguiente.
function visits(events) {
  const bySession = new Map();
  for (const e of events) {
    const item = { at: Date.parse(e.createdAt), path: e.urlPath, name: e.eventType === 2 ? e.eventName : null };
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId).push(item);
  }
  const out = [];
  for (const list of bySession.values()) {
    list.sort((a, b) => a.at - b.at);
    let current = null;
    for (const item of list) {
      if (!current || item.at - current.at(-1).at > VISIT_GAP_MS) out.push((current = []));
      current.push(item);
    }
  }
  return out;
}

const pad = (value, width) => String(value).padStart(width);
const table = (rows, widths) =>
  rows.map((row) => "  " + row.map((cell, i) => (i === 0 ? String(cell).padEnd(widths[0]) : pad(cell, widths[i]))).join(" ")).join("\n");

function report(site, events) {
  const known = catalog(site.sources);
  const custom = events.filter((e) => e.eventType === 2);
  console.log(`\n================ ${site.domain}`);
  if (custom.length === 0) {
    console.log(`Todavía no llegó ningún clic ni marca de tiempo. Opciones en el código: ${known.size}.`);
    return;
  }
  // Solo cuentan las visitas que siguen activas tras el primer evento de uso: antes no se medía.
  const since = Math.min(...custom.map((e) => Date.parse(e.createdAt)));
  const measured = visits(events).filter((visit) => visit.at(-1).at >= since);
  console.log(`Medido desde ${new Date(since).toLocaleString("es-CO")}: ${measured.length} visitas.`);

  const clicks = new Map(); // nombre -> { total, visitas, primero }
  const pages = new Map(); // ruta -> { vistas, alcanzan: [n por marca] }
  let withoutClick = 0;
  for (const visit of measured) {
    const seen = new Set();
    let first = null;
    let view = null;
    for (const item of visit) {
      if (item.name === null) {
        if (!pages.has(item.path)) pages.set(item.path, { views: 0, reach: MARKS.map(() => 0) });
        view = pages.get(item.path);
        view.views += 1;
      } else if (item.name.startsWith(MARK_PREFIX)) {
        const index = MARKS.indexOf(item.name.slice(MARK_PREFIX.length));
        if (index >= 0 && view) view.reach[index] += 1;
      } else {
        if (!clicks.has(item.name)) clicks.set(item.name, { total: 0, visits: 0, first: 0 });
        const entry = clicks.get(item.name);
        entry.total += 1;
        if (!seen.has(item.name)) entry.visits += 1;
        seen.add(item.name);
        first ??= item.name;
      }
    }
    if (first) clicks.get(first).first += 1;
    else withoutClick += 1;
  }

  console.log(`\nPermanencia por página: vistas que llegan a cada marca de tiempo`);
  const topPages = [...pages.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 10);
  const pageWidth = Math.max(8, ...topPages.map(([path]) => path.length));
  console.log(
    table(
      [["página", "vistas", ...MARKS], ...topPages.map(([path, p]) => [path, p.views, ...p.reach])],
      [pageWidth, 7, ...MARKS.map(() => 7)],
    ),
  );

  const used = [...clicks.entries()].sort((a, b) => b[1].total - a[1].total);
  const nameWidth = Math.max(8, ...used.map(([name]) => name.length));
  console.log(`\nOpciones usadas: ${used.length} de ${known.size}. Visitas sin ningún clic en una opción: ${withoutClick}.`);
  if (used.length) {
    console.log(
      table(
        [["opción", "clics", "visitas", "primer clic"], ...used.map(([name, c]) => [name, c.total, c.visits, c.first])],
        [nameWidth, 7, 8, 12],
      ),
    );
  }

  const unused = [...known].filter((name) => !clicks.has(name)).sort((a, b) => a.localeCompare(b, "es"));
  console.log(`\nOpciones sin uso: ${unused.length}`);
  for (const name of unused) console.log(`  ${name}`);

  const gone = used.map(([name]) => name).filter((name) => !known.has(name));
  if (gone.length) {
    console.log(`\nNombres recibidos que ya no están en el código: ${gone.length}`);
    for (const name of gone) console.log(`  ${name}`);
  }
}

async function main() {
  if (!PASSWORD) {
    console.error(
      "Falta UMAMI_ADMIN_PASSWORD. Ejecuta:\n" +
        "  doppler run --project shared --config prd --only-secrets UMAMI_ADMIN_PASSWORD -- node scripts/metricas-uso.mjs",
    );
    process.exit(1);
  }
  const { token } = await api("/api/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  const listed = await api("/api/websites?pageSize=100", token);
  const websites = Array.isArray(listed) ? listed : listed.data;
  const endAt = Date.now();
  const startAt = endAt - DAYS * 24 * 60 * 60 * 1000;
  console.log(`Uso de Kiba, últimos ${DAYS} días. Fuente: ${UMAMI}`);
  for (const site of SITES) {
    const website = websites.find((w) => w.domain === site.domain);
    if (!website) {
      console.log(`\n================ ${site.domain}\nNo existe ese sitio en Umami.`);
      continue;
    }
    report(site, await allEvents(token, website.id, startAt, endAt));
  }
}

main().catch((error) => {
  console.error(`No se pudo generar el informe: ${error.message}`);
  process.exit(1);
});
