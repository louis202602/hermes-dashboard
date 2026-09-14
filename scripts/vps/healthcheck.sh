#!/usr/bin/env bash
set -Eeuo pipefail
printf '[%s] host=%s\n' "$(date -Is)" "$(hostname -f 2>/dev/null || hostname)"
uname -srmo
if [ -r /etc/os-release ]; then . /etc/os-release; printf 'os=%s\n' "$PRETTY_NAME"; fi
printf 'cpu=%s\n' "$(nproc)"
free -h || true
df -hT / || true
if command -v psql >/dev/null 2>&1; then psql --version; fi
