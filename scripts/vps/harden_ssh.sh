#!/usr/bin/env bash
# scripts/vps/harden_ssh.sh
# Durcit sshd (désactive le login root par mot de passe + l'auth par mot de passe) mais
# UNIQUEMENT si CONFIRM=HARDEN_SSH est fourni explicitement ET qu'un accès par clé existe
# déjà pour au moins un utilisateur sudo (ou root), afin de ne jamais provoquer de verrouillage.
# Applique la configuration via un drop-in dédié, valide avec "sshd -t" avant tout reload,
# et restaure/abandonne automatiquement si la validation échoue.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root
confirm_or_fail "${CONFIRM:-}" "HARDEN_SSH" "Ce script modifie l'authentification SSH et exige une confirmation explicite."

log_step "Vérification qu'un accès par clé existe avant de désactiver l'auth par mot de passe"
KEYED_USER_FOUND=0
for user in $(getent group sudo | cut -d: -f4 | tr ',' ' '); do
  [ -n "$user" ] || continue
  home_dir="$(getent passwd "$user" | cut -d: -f6 || true)"
  auth_keys="${home_dir}/.ssh/authorized_keys"
  if [ -n "$home_dir" ] && [ -s "$auth_keys" ]; then
    KEYED_USER_FOUND=1
    log_info "Clé publique trouvée pour l'utilisateur sudo '${user}'."
    break
  fi
done
if [ -s /root/.ssh/authorized_keys ]; then
  KEYED_USER_FOUND=1
  log_info "Clé publique trouvée pour root (/root/.ssh/authorized_keys)."
fi
[ "$KEYED_USER_FOUND" -eq 1 ] || fail "Garde-fou: aucun utilisateur sudo (ni root) n'a de clé SSH autorisée — désactivation de l'auth par mot de passe refusée pour éviter un verrouillage."

log_step "Sauvegarde de la configuration sshd actuelle"
BACKUP_DIR="/opt/hermes-infra/ssh-backups"
install -d -m 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -a /etc/ssh/sshd_config "${BACKUP_DIR}/sshd_config.${STAMP}.bak"

log_step "Application du hardening via drop-in dédié (ne touche pas au fichier principal)"
install -d -m 755 /etc/ssh/sshd_config.d
DROPIN="/etc/ssh/sshd_config.d/99-hermes-hardening.conf"
cat > "$DROPIN" << 'EOF'
# Généré par scripts/vps/harden_ssh.sh — ne pas éditer à la main.
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 4
EOF

log_step "Validation de la configuration avant tout rechargement"
if ! sshd -t; then
  log_error "Configuration sshd invalide détectée — retrait du drop-in, aucun rechargement effectué."
  rm -f "$DROPIN"
  fail "Hardening SSH annulé: sshd -t a échoué. Accès SSH existant non modifié."
fi

log_step "Rechargement de sshd (reload, pas restart — ne coupe pas les sessions déjà ouvertes)"
systemctl reload sshd 2>/dev/null || systemctl reload ssh

log_step "Hardening SSH appliqué. Sauvegarde: ${BACKUP_DIR}/sshd_config.${STAMP}.bak"
