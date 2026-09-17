#!/usr/bin/env bash
# scripts/vps/setup_backups.sh
# Backup PostgreSQL quotidien local + copie hors-VPS via rclone (S3-compatible).
# Ne supprime jamais la base source et ne touche pas à Supabase.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root
require_var BACKUP_S3_ENDPOINT
require_var BACKUP_S3_BUCKET
require_var BACKUP_S3_ACCESS_KEY
require_var BACKUP_S3_SECRET_KEY

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_DIR="/var/backups/hermes-pg"

log_step "Installation rclone"
idempotent_apt_install rclone

log_step "Configuration du remote S3"
install -d -m 700 /root/.config/rclone
RCLONE_CONF="/root/.config/rclone/rclone.conf"
cat > "$RCLONE_CONF" << CONF_EOF
[hermes-backup]
type = s3
provider = Other
endpoint = ${BACKUP_S3_ENDPOINT}
access_key_id = ${BACKUP_S3_ACCESS_KEY}
secret_access_key = ${BACKUP_S3_SECRET_KEY}
CONF_EOF
chmod 600 "$RCLONE_CONF"

install -d -m 700 -o postgres -g postgres "$BACKUP_DIR"

log_step "Script de dump quotidien"
cat > /usr/local/bin/hermes-pg-backup.sh << SCRIPT_EOF
#!/usr/bin/env bash
set -euo pipefail
STAMP="\$(date -u +%Y%m%d)"
OUT="${BACKUP_DIR}/hermes_os_\${STAMP}.dump"
if [ -f "\$OUT" ]; then
  echo "backup déjà présent pour aujourd'hui"
  exit 0
fi
sudo -u postgres pg_dump -Fc -d hermes_os -f "\$OUT"
rclone copy "\$OUT" hermes-backup:${BACKUP_S3_BUCKET}/hermes-os/ --checksum
find "${BACKUP_DIR}" -type f -name 'hermes_os_*.dump' -mtime +${RETENTION_DAYS} -delete
echo "backup OK"
SCRIPT_EOF
chmod 750 /usr/local/bin/hermes-pg-backup.sh

cat > /etc/systemd/system/hermes-pg-backup.service << 'UNIT_EOF'
[Unit]
Description=Hermes OS PostgreSQL daily backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hermes-pg-backup.sh
UNIT_EOF

cat > /etc/systemd/system/hermes-pg-backup.timer << 'TIMER_EOF'
[Unit]
Description=Daily Hermes OS PostgreSQL backup
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now hermes-pg-backup.timer
log_step "Backups configurés."
