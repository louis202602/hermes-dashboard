#!/usr/bin/env bash
set -euo pipefail

echo "== Hermes Codespace bootstrap =="
git pull --ff-only origin main

bash scripts/setup-ovh-mcp.sh

if [[ -x hermes-computer-use/scripts/start.sh ]]; then
  bash hermes-computer-use/scripts/start.sh || true
fi

if curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "HCU_CDP=PASS"
else
  echo "HCU_CDP=WAITING"
fi

if ss -ltn 2>/dev/null | grep -q ':6080 '; then
  echo "HCU_NOVNC=PASS"
else
  echo "HCU_NOVNC=WAITING"
fi

echo "MCP_CONFIG=.mcp.json"
echo "BOOTSTRAP=PASS"
echo "Restart/reload Claude Code in this Codespace so it discovers the ovhcloud MCP server."
