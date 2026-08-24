#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${HOME}/.local/share/hermes/ovhcloud-mcp"
for name in OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: missing ${name}" >&2
    exit 2
  fi
done
exec node "$INSTALL_DIR/dist/index.js"
