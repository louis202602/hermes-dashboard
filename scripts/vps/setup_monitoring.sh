#!/usr/bin/env bash
# scripts/vps/setup_monitoring.sh
# Monitoring local léger : statistiques PostgreSQL et snapshots système.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root

log_step "pg_stat_statements pour les slow queries"
PG_CONF="/etc/postgresql/17/main/postgresql.conf"
if ! grep -q "shared_preload_libraries.*pg_stat_statements" "$PG_CONF" 2>/dev/null; then
  if grep -q "^shared_preload_libraries" "$PG_CONF"; then
    sed -i "s/^shared_preload_libraries = '\(.*\)'/shared_preload_libraries = '\1,pg_stat_statements'/" "$PG_CONF"
  else
    echo "shared_preload_libraries = 'pg_stat_statements'" >> "$PG_CONF"
  fi
  systemctl restart postgresql
fi
sudo -u postgres psql -d hermes_os -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

install -d -m 755 /var/log/hermes-monitoring
cat > /usr/local/bin/hermes-monitor.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
set -euo pipefail
OUT="/var/log/hermes-monitoring/status.log"
{
  echo "=== $(date -u --iso-8601=seconds) ==="
  uptime
  free -m
  df -h /
  sudo -u postgres psql -d hermes_os -tAc "SELECT count(*) FROM pg_stat_activity;"
  sudo -u postgres psql -d hermes_os -tAc "SELECT round(total_exec_time::numeric,1), calls, left(query,80) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5;" 2>/dev/null || true
} >> "$OUT"
SCRIPT_EOF
chmod 750 /usr/local/bin/hermes-monitor.sh

cat > /etc/systemd/system/hermes-monitor.service << 'UNIT_EOF'
[Unit]
Description=Hermes OS monitoring snapshot
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hermes-monitor.sh
UNIT_EOF

cat > /etc/systemd/system/hermes-monitor.timer << 'TIMER_EOF'
[Unit]
Description=Hermes OS monitoring every 5 minutes
[Timer]
OnCalendar=*:0/5
Persistent=true
[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now hermes-monitor.timer
log_step "Monitoring local activé."
