#!/usr/bin/env bash
# scripts/vps/verify_target.sh
# Compare la base Supabase source (lecture seule, AUCUNE écriture) à la base staging
# locale produite par prepare_migration.sh. Ne produit qu'un rapport ; aucune modification
# n'est faite ni côté source Supabase ni côté staging.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_var SUPABASE_DB_URL

STAGING_DB="${1:-${STAGING_DB:-}}"
[ -n "$STAGING_DB" ] || fail "Usage: verify_target.sh <staging_db_name> (ou variable d'environnement STAGING_DB). Voir prepare_migration.sh -> staging_db_name.txt."

log_step "Vérification en lecture seule — source Supabase vs staging '${STAGING_DB}'"

source_tables="$(psql "$SUPABASE_DB_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='hermes_os';")"
staging_tables="$(sudo -u postgres psql -d "$STAGING_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='hermes_os';")"
log_info "Nombre de tables hermes_os — source: ${source_tables} / staging: ${staging_tables}"

MISMATCH=0
[ "$source_tables" = "$staging_tables" ] || { log_warn "Écart du nombre de tables entre source et staging."; MISMATCH=1; }

log_step "Comparaison de la liste des tables"
if diff \
  <(psql "$SUPABASE_DB_URL" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='hermes_os' ORDER BY 1;") \
  <(sudo -u postgres psql -d "$STAGING_DB" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='hermes_os' ORDER BY 1;") \
  >/dev/null; then
  log_info "Liste des tables identique."
else
  log_warn "Liste des tables différente entre source et staging."
  MISMATCH=1
fi

log_step "Comparaison des row counts par table (approximatif via pg_stat, non destructif)"
source_counts="$(mktemp)"
staging_counts="$(mktemp)"
trap 'rm -f "$source_counts" "$staging_counts"' EXIT

psql "$SUPABASE_DB_URL" -Atc "
  SELECT relname || '|' || n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname='hermes_os'
  ORDER BY relname;
" > "$source_counts"

sudo -u postgres psql -d "$STAGING_DB" -Atc "
  SELECT relname || '|' || n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname='hermes_os'
  ORDER BY relname;
" > "$staging_counts"

if diff "$source_counts" "$staging_counts" >/dev/null; then
  log_info "Row counts identiques (approximatif) entre source et staging."
else
  log_warn "Différences de row counts (attendu si la source reçoit des écritures après le dump) :"
  diff "$source_counts" "$staging_counts" || true
  MISMATCH=1
fi

log_step "Comparaison des extensions installées"
if diff \
  <(psql "$SUPABASE_DB_URL" -Atc "SELECT extname FROM pg_extension ORDER BY 1;") \
  <(sudo -u postgres psql -d "$STAGING_DB" -Atc "SELECT extname FROM pg_extension ORDER BY 1;") \
  >/dev/null; then
  log_info "Extensions identiques."
else
  log_warn "Extensions différentes entre source et staging (normal si pg_cron/pg_stat_statements ont été ajoutées côté cible)."
fi

log_step "Vérification terminée — aucune écriture effectuée sur la source Supabase ni sur le staging."
if [ "$MISMATCH" -eq 1 ]; then
  log_warn "Des écarts ont été détectés — voir le détail ci-dessus."
  exit 2
fi
log_info "Aucun écart significatif détecté."
