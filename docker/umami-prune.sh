#!/bin/sh
# Tope de espacio de las grabaciones de sesión de Umami (metrics.kiba.tools).
#
# Umami auto-hospedado no borra grabaciones por su cuenta ni trae un tope de espacio.
# Este bucle mide cuánto ocupan (bytes ya comprimidos de session_replay.events) y, si
# pasan de UMAMI_REPLAY_MAX_MB, borra visitas enteras empezando por las más antiguas
# hasta volver a caber. Las grabaciones guardadas a mano en Umami (session_replay_saved)
# no se borran nunca, pero sí cuentan para el tope.
#
# Conexión por las variables estándar de psql (PGHOST, PGUSER, PGDATABASE, PGPASSWORD).
# Con --once hace una sola revisión y sale (pruebas o ejecución a mano).
set -eu

MAX_MB="${UMAMI_REPLAY_MAX_MB:-5120}"
EVERY="${UMAMI_PRUNE_EVERY_SECONDS:-3600}"
MAX_BYTES=$((MAX_MB * 1024 * 1024))
OK_FILE="${UMAMI_PRUNE_OK_FILE:-/tmp/umami-prune.ok}"

prune() {
  psql -X -q -At -v ON_ERROR_STOP=1 -v max_bytes="$MAX_BYTES" <<'SQL'
with kept_saved as (
  select coalesce(sum(octet_length(r.events)), 0) as bytes
  from session_replay r
  where exists (select 1 from session_replay_saved s
                where s.website_id = r.website_id and s.visit_id = r.visit_id)
),
per_visit as (
  select r.website_id, r.visit_id,
         max(r.created_at) as last_at,
         sum(octet_length(r.events)) as bytes
  from session_replay r
  where not exists (select 1 from session_replay_saved s
                    where s.website_id = r.website_id and s.visit_id = r.visit_id)
  group by r.website_id, r.visit_id
),
ranked as (
  -- Acumulado de la visita más reciente a la más antigua: se conserva lo que cabe.
  select website_id, visit_id, bytes,
         sum(bytes) over (order by last_at desc nulls last, visit_id desc) as running
  from per_visit
),
doomed as (
  select d.website_id, d.visit_id, d.bytes
  from ranked d, kept_saved k
  where d.running > cast(:max_bytes as bigint) - k.bytes
),
gone as (
  delete from session_replay r using doomed d
  where r.website_id = d.website_id and r.visit_id = d.visit_id
  returning 1
)
select
  format('[umami-prune] grabaciones: %s en total (%s de guardadas a mano), %s visitas sin guardar; borradas %s visitas, %s fragmentos, %s; tope %s',
         pg_size_pretty((select coalesce(sum(bytes), 0) from per_visit) + (select bytes from kept_saved)),
         pg_size_pretty((select bytes from kept_saved)),
         (select count(*) from per_visit),
         (select count(*) from doomed),
         (select count(*) from gone),
         pg_size_pretty((select coalesce(sum(bytes), 0) from doomed)),
         pg_size_pretty(cast(:max_bytes as bigint))) as msg,
  (select count(*) from doomed) > 0 as did_delete
\gset
\echo :msg
\if :did_delete
-- Deja reutilizable el espacio de lo borrado: el archivo de la tabla deja de crecer.
vacuum session_replay;
\endif
SQL
}

run() {
  if prune; then
    : > "$OK_FILE"
  else
    rm -f "$OK_FILE"
    echo "[umami-prune] la revisión falló; se reintenta en el siguiente ciclo"
    return 1
  fi
}

if [ "${1:-}" = "--once" ]; then
  run
  exit $?
fi

echo "[umami-prune] tope ${MAX_MB} MB; revisión cada ${EVERY} s"
while :; do
  run || true
  sleep "$EVERY"
done
