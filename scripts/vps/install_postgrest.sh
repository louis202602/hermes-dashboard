#!/usr/bin/env bash
# scripts/vps/install_postgrest.sh
# Installe PostgREST et le configure pour écouter EXCLUSIVEMENT sur 127.0.0.1.
# N'expose jamais l'API sur une interface publique ; le script vérifie le binding
# après démarrage et arrête le service si une exposition publique est détectée.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root
require_var PGRST_AUTHENTICATOR_PASSWORD

POSTGREST_VERSION="${POSTGREST_VERSION:-v12.2.3}"
POSTGREST_BIND_HOST="127.0.0.1"
POSTGREST_PORT="${POSTGREST_PORT:-3001}"
INSTALL_DIR="/usr/local/bin"
CONF_DIR="/etc/postgrest"
CONF_FILE="${CONF_DIR}/hermes.conf"

log_step "Rôles PostgreSQL pour PostgREST (authenticator + rôle anonyme dédié)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hermes_web_anon'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE hermes_web_anon NOLOGIN;"
else
  log_info "Rôle hermes_web_anon déjà présent."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='authenticator'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PGRST_AUTHENTICATOR_PASSWORD}" <<'SQL'
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'pw';
SQL
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PGRST_AUTHENTICATOR_PASSWORD}" <<'SQL'
ALTER ROLE authenticator WITH PASSWORD :'pw';
SQL
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT hermes_web_anon TO authenticator;"

log_step "Installation du binaire PostgREST ${POSTGREST_VERSION} (idempotent)"
if command -v postgrest >/dev/null 2>&1 && postgrest --help >/dev/null 2>&1; then
  log_info "PostgREST déjà installé: $(command -v postgrest)"
else
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  ARCHIVE="postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz"
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/${ARCHIVE}" -o "${TMP_DIR}/${ARCHIVE}"
  tar -xJf "${TMP_DIR}/${ARCHIVE}" -C "$TMP_DIR"
  install -m 755 "${TMP_DIR}/postgrest" "${INSTALL_DIR}/postgrest"
fi

log_step "Fichier de configuration PostgREST — écoute forcée sur 127.0.0.1 uniquement"
install -d -m 750 "$CONF_DIR"
cat > "$CONF_FILE" << EOF
db-uri = "postgres://authenticator:${PGRST_AUTHENTICATOR_PASSWORD}@127.0.0.1:5432/hermes_os"
db-schemas = "hermes_os"
db-anon-role = "hermes_web_anon"
server-host = "${POSTGREST_BIND_HOST}"
server-port = ${POSTGREST_PORT}
EOF
chmod 600 "$CONF_FILE"

log_step "Service systemd"
cat > /etc/systemd/system/hermes-postgrest.service << UNIT_EOF
[Unit]
Description=Hermes OS PostgREST API (loopback only)
After=postgresql.service
Requires=postgresql.service

[Service]
ExecStart=${INSTALL_DIR}/postgrest ${CONF_FILE}
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable --now hermes-postgrest.service
systemctl restart hermes-postgrest.service

log_step "Vérification: PostgREST ne doit écouter QUE sur 127.0.0.1"
sleep 1
if ss -tlnp 2>/dev/null | grep ":${POSTGREST_PORT} " | grep -qv '127.0.0.1'; then
  systemctl stop hermes-postgrest.service
  fail "Garde-fou: PostgREST semble exposé au-delà de 127.0.0.1 — service arrêté immédiatement."
fi
ss -tlnp 2>/dev/null | grep ":${POSTGREST_PORT} " | grep -q '127.0.0.1' || log_warn "Impossible de confirmer le binding via ss — vérifier manuellement avant de considérer l'installation terminée."

log_step "PostgREST installé et actif sur 127.0.0.1:${POSTGREST_PORT} (non exposé publiquement)."
