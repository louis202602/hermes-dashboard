#!/usr/bin/env bash
# scripts/vps/install_extensions.sh
# Installe et active pg_cron + pg_stat_statements dans hermes_os, en FUSIONNANT
# shared_preload_libraries au lieu de l'écraser : toute bibliothèque déjà présente
# (par ex. ajoutée manuellement ou par un autre script) est conservée telle quelle.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root

PG_VERSION="17"
PG_CONF_DIR="/etc/postgresql/${PG_VERSION}/main"
PG_CONF="${PG_CONF_DIR}/postgresql.conf"
[ -f "$PG_CONF" ] || fail "postgresql.conf introuvable (${PG_CONF}) — installer PostgreSQL ${PG_VERSION} d'abord (install_postgres17.sh)."

log_step "Installation du paquet pg_cron"
idempotent_apt_install "postgresql-${PG_VERSION}-cron"

log_step "Fusion de shared_preload_libraries (aucune bibliothèque existante n'est retirée)"
RELOAD_NEEDED=0
merge_preload_libraries() {
  local required_libs=("pg_stat_statements" "pg_cron")
  local current_line current_value
  current_line="$(grep -E '^[[:space:]]*shared_preload_libraries[[:space:]]*=' "$PG_CONF" || true)"
  if [ -n "$current_line" ]; then
    current_value="$(printf '%s' "$current_line" | sed -E "s/^[[:space:]]*shared_preload_libraries[[:space:]]*=[[:space:]]*'([^']*)'.*/\1/")"
  else
    current_value=""
  fi

  declare -A seen=()
  local merged=()
  local lib existing
  IFS=',' read -ra existing <<< "$current_value"
  for lib in "${existing[@]:-}"; do
    lib="$(printf '%s' "$lib" | xargs 2>/dev/null || true)"
    [ -n "$lib" ] || continue
    if [ -z "${seen[$lib]:-}" ]; then
      merged+=("$lib")
      seen[$lib]=1
    fi
  done
  for lib in "${required_libs[@]}"; do
    if [ -z "${seen[$lib]:-}" ]; then
      merged+=("$lib")
      seen[$lib]=1
    fi
  done

  local new_value
  new_value="$(IFS=,; echo "${merged[*]}")"

  if [ "$new_value" = "$current_value" ]; then
    log_info "shared_preload_libraries déjà correct: '${current_value}' — aucune modification."
    return 1
  fi

  if [ -n "$current_line" ]; then
    sed -i -E "s/^[[:space:]]*shared_preload_libraries[[:space:]]*=.*/shared_preload_libraries = '${new_value}'/" "$PG_CONF"
  else
    echo "shared_preload_libraries = '${new_value}'" >> "$PG_CONF"
  fi
  log_info "shared_preload_libraries mis à jour: '${current_value}' -> '${new_value}' (fusion, rien retiré)."
  return 0
}
if merge_preload_libraries; then
  RELOAD_NEEDED=1
fi

log_step "Configuration de la base cible pour pg_cron (cron.database_name)"
if ! grep -Eq "^[[:space:]]*cron\.database_name[[:space:]]*=[[:space:]]*'hermes_os'" "$PG_CONF"; then
  if grep -Eq '^[[:space:]]*cron\.database_name' "$PG_CONF"; then
    sed -i -E "s/^[[:space:]]*cron\.database_name[[:space:]]*=.*/cron.database_name = 'hermes_os'/" "$PG_CONF"
  else
    echo "cron.database_name = 'hermes_os'" >> "$PG_CONF"
  fi
  RELOAD_NEEDED=1
fi

if [ "$RELOAD_NEEDED" -eq 1 ]; then
  log_step "Redémarrage de PostgreSQL pour charger shared_preload_libraries (requis par pg_cron/pg_stat_statements)"
  systemctl restart postgresql
else
  log_info "Aucun redémarrage nécessaire (configuration déjà à jour)."
fi

log_step "Activation des extensions dans hermes_os"
sudo -u postgres psql -d hermes_os -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
sudo -u postgres psql -d hermes_os -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"

log_step "Vérification: pg_cron et pg_stat_statements coexistent dans shared_preload_libraries"
grep -E '^shared_preload_libraries' "$PG_CONF"
log_step "Extensions installées: pg_cron + pg_stat_statements actives sur hermes_os."
