#!/usr/bin/env bash
# Helpers partagés : logging structuré, garde-fous anti-destructif, checks idempotence.
# A sourcer en tête de chaque script vps/*.sh, APRES "set -euo pipefail".

TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log_info()  { printf '[%s] [INFO ] %s\n'  "$(TS)" "$*"; }
log_warn()  { printf '[%s] [WARN ] %s\n'  "$(TS)" "$*" >&2; }
log_error() { printf '[%s] [ERROR] %s\n'  "$(TS)" "$*" >&2; }
log_step()  { printf '\n[%s] === %s ===\n' "$(TS)" "$*"; }

fail() {
  log_error "$*"
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Ce script doit être exécuté en root (via sudo)."
}

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "Variable d'environnement requise absente: ${name} (vérifier les GitHub Secrets/Variables)."
  fi
}

forbid_destructive_patterns() {
  local file="$1"
  if grep -Eq '(rm[[:space:]]+-rf[[:space:]]+/($|[^a-zA-Z])|DROP[[:space:]]+DATABASE|DROP[[:space:]]+SCHEMA|TRUNCATE[[:space:]]|mkfs\.|dd[[:space:]]+if=)' "$file"; then
    fail "Pattern potentiellement destructif détecté dans ${file} — exécution bloquée par garde-fou."
  fi
}

idempotent_apt_install() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    log_info "Paquets déjà présents: $*"
    return 0
  fi
  log_info "Installation des paquets manquants: ${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
}

confirm_or_fail() {
  local given="$1" expected="$2" msg="$3"
  [ "$given" = "$expected" ] || fail "$msg (confirmation attendue: '${expected}', reçue: '${given:-<vide>}')."
}
