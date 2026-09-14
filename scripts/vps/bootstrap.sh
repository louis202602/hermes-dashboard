#!/usr/bin/env bash
# scripts/vps/bootstrap.sh
# Prépare un VPS neuf : paquets de base, pare-feu, fail2ban, mises à jour auto.
# Ne modifie JAMAIS l'authentification SSH existante et ne doit jamais couper l'accès en cours.
# Idempotent : peut être relancé sans effet de bord.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_root

log_step "Mise à jour de la liste des paquets"
apt-get update -y

log_step "Paquets de base"
idempotent_apt_install curl ca-certificates gnupg lsb-release ufw fail2ban unattended-upgrades apt-transport-https

log_step "Fuseau horaire UTC"
timedatectl set-timezone UTC || log_warn "Impossible de fixer le fuseau horaire (non bloquant)."

log_step "Pare-feu UFW — l'accès SSH est TOUJOURS autorisé avant toute activation"
# Règle non négociable : on autorise systématiquement SSH en premier, quel que soit
# l'état courant de UFW, pour ne jamais risquer de couper la session en cours.
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 22/tcp >/dev/null
if ufw status | grep -q "Status: active"; then
  log_info "UFW déjà actif — règle SSH reconfirmée, aucune autre action."
else
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
  log_info "UFW activé avec le port 22 explicitement autorisé."
fi
ufw status verbose | grep -E '22' >/dev/null || fail "Garde-fou: le port SSH n'apparaît pas comme autorisé après configuration UFW — abandon."

log_step "fail2ban — protection brute-force SSH sans bannir agressivement la session locale"
install -d -m 755 /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/hermes-sshd.conf << 'EOF'
[sshd]
enabled = true
maxretry = 6
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log_step "Mises à jour de sécurité automatiques"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log_step "Arborescence applicative Hermès"
install -d -m 750 /opt/hermes-infra
install -d -m 750 /opt/hermes-infra/scripts
install -d -m 700 /opt/hermes-infra/migration

log_step "Bootstrap terminé — accès SSH existant non modifié, port 22 toujours autorisé."
