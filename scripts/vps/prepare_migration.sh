#!/usr/bin/env bash
# scripts/vps/prepare_migration.sh
# Inventaire + dump du schéma hermes_os depuis Supabase, puis restauration dans une
# base staging unique. Aucune écriture sur la source et aucune modification de hermes_os.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root
require_var SUPABASE_DB_URL

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="/opt/hermes-infra/migration/${STAMP}"
STAGING_DB="hermes_os_staging_${STAMP//[^0-9]/}"
install -d -m 700 "$WORKDIR"

log_step "Inventaire Supabase source (lecture seule)"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -o "${WORKDIR}/inventaire.txt" <<'SQL'
\echo '--- Schémas ---'
SELECT schema_name FROM information_schema.schemata ORDER BY 1;
\echo '--- Tables hermes_os ---'
SELECT table_name FROM information_schema.tables WHERE table_schema='hermes_os' ORDER BY 1;
\echo '--- Fonctions hermes_os ---'
SELECT routine_name FROM information_schema.routines WHERE routine_schema='hermes_os' ORDER BY 1;
\echo '--- Vues hermes_os ---'
SELECT table_name FROM information_schema.views WHERE table_schema='hermes_os' ORDER BY 1;
\echo '--- Triggers hermes_os ---'
SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE trigger_schema='hermes_os' ORDER BY 1;
\echo '--- Séquences hermes_os ---'
SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='hermes_os' ORDER BY 1;
\echo '--- Extensions ---'
SELECT extname, extversion FROM pg_extension ORDER BY 1;
\echo '--- Row counts approximatifs ---'
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='hermes_os' ORDER BY n_live_tup DESC;
SQL

log_step "Dump du schéma hermes_os"
pg_dump "$SUPABASE_DB_URL" --schema=hermes_os --format=custom --no-owner --no-privileges --file="${WORKDIR}/hermes_os.dump"
sha256sum "${WORKDIR}/hermes_os.dump" > "${WORKDIR}/hermes_os.dump.sha256"

log_step "Création base staging dédiée: ${STAGING_DB}"
sudo -u postgres createdb "$STAGING_DB"
sudo -u postgres pg_restore --dbname="$STAGING_DB" --no-owner --no-privileges --exit-on-error "${WORKDIR}/hermes_os.dump"

printf '%s\n' "$STAGING_DB" > "${WORKDIR}/staging_db_name.txt"
sudo -u postgres psql -d "$STAGING_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='hermes_os';" > "${WORKDIR}/staging_table_count.txt"

log_step "Migration de test terminée"
log_info "Source Supabase inchangée. Base hermes_os inchangée. Cible de test: ${STAGING_DB}."
