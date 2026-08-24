#!/usr/bin/env bash
set -euo pipefail

PINNED_COMMIT="ccadc85bd4aab35434a24732bc77ef2b6f100b4c"
INSTALL_DIR="${HOME}/.local/share/hermes/ovhcloud-mcp"
REPO_URL="https://github.com/hlebtkachenko/ovhcloud-mcp.git"

for name in OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: missing Codespaces secret: ${name}" >&2
    exit 2
  fi
done

mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

git -C "$INSTALL_DIR" fetch --depth=1 origin "$PINNED_COMMIT"
git -C "$INSTALL_DIR" checkout --detach "$PINNED_COMMIT"

cd "$INSTALL_DIR"
npm ci
npm run build
npm test

echo "OVH_MCP_INSTALL=PASS"
echo "OVH_MCP_COMMIT=$PINNED_COMMIT"
