#!/usr/bin/env bash
# scripts/vps/healthcheck.sh
# Lecture seule. Aucune modification du serveur. Peut être relancé à volonté.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

log_step "Healthcheck VPS $(hostname) — $(TS)"

log_step "Identité / OS"
whoami
cat /etc/os-release | grep -E '^(NAME|VERSION)='
uptime -p

log_step "Ressources"
nproc
free -h
df -h /

log_step "Réseau / SSH"
ss -tlnp 2>/dev/null | grep ':22 ' || log_warn "Aucun listener détecté sur le port 22 (vérifier ss -tlnp en tant que root)."
who -a || true

log_step "Utilisateurs sudo existants"
getent group sudo || true

log_step "UFW"
command -v ufw >/dev/null 2>&1 && ufw status verbose || log_warn "UFW non installé."

log_step "fail2ban"
command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status || log_warn "fail2ban non installé."

log_step "PostgreSQL"
if command -v psql >/dev/null 2>&1; then
  psql --version
  systemctl is-active postgresql 2>/dev/null || log_warn "Service postgresql non actif ou nom de service différent."
else
  log_warn "PostgreSQL non installé."
fi

log_step "PostgREST"
command -v postgrest >/dev/null 2>&1 && postgrest --help >/dev/null && echo "postgrest présent" || log_warn "PostgREST non installé."

log_step "NTP"
timedatectl show -p NTPSynchronized -p NTP 2>/dev/null || log_warn "timedatectl indisponible."

log_step "Healthcheck terminé — aucune modification effectuée."
