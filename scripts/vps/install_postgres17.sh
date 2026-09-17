#!/usr/bin/env bash
# scripts/vps/install_postgres17.sh
# Installe PostgreSQL 17 via PGDG et prépare la base Hermès.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root
require_var PG_SUPERUSER_PASSWORD
require_var PG_HERMES_APP_PASSWORD

log_step "Dépôt officiel PostgreSQL (PGDG)"
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update -y

log_step "Installation PostgreSQL 17"
idempotent_apt_install postgresql-17 postgresql-client-17 postgresql-contrib-17
systemctl enable --now postgresql

log_step "Rôles PostgreSQL Hermès"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hermes_admin_pg'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PG_SUPERUSER_PASSWORD}" <<'SQL'
CREATE ROLE hermes_admin_pg LOGIN SUPERUSER PASSWORD :'pw';
SQL
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PG_SUPERUSER_PASSWORD}" <<'SQL'
ALTER ROLE hermes_admin_pg WITH PASSWORD :'pw';
SQL
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hermes_app'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PG_HERMES_APP_PASSWORD}" <<'SQL'
CREATE ROLE hermes_app LOGIN PASSWORD :'pw';
SQL
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v "pw=${PG_HERMES_APP_PASSWORD}" <<'SQL'
ALTER ROLE hermes_app WITH PASSWORD :'pw';
SQL
fi

log_step "Base hermes_os"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hermes_os'" | grep -q 1 || sudo -u postgres createdb -O hermes_admin_pg hermes_os

PG_CONF_DIR="/etc/postgresql/17/main"
if [ -f "${PG_CONF_DIR}/postgresql.conf" ] && ! grep -q "^listen_addresses" "${PG_CONF_DIR}/postgresql.conf"; then
  echo "listen_addresses = 'localhost'" >> "${PG_CONF_DIR}/postgresql.conf"
fi
systemctl restart postgresql
log_step "PostgreSQL 17 prêt en écoute locale."
