#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${HCU_VNC_PASSWORD:-}" ]]; then
  echo "HCU_VNC_PASSWORD is required as a Codespaces secret." >&2
  exit 1
fi

STATE_DIR="${HCU_STATE_DIR:-/workspaces/hermes-dashboard/hermes-computer-use/state}"
mkdir -p "$STATE_DIR/profile" "$STATE_DIR/downloads"

pkill -f "Xvfb :99" 2>/dev/null || true
pkill -f "x11vnc.*5900" 2>/dev/null || true
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "remote-debugging-port=9222" 2>/dev/null || true

Xvfb :99 -screen 0 1440x900x24 >"$STATE_DIR/xvfb.log" 2>&1 &
export DISPLAY=:99
sleep 1
fluxbox >"$STATE_DIR/fluxbox.log" 2>&1 &

VNC_PASS_FILE="$STATE_DIR/.vncpass"
x11vnc -storepasswd "$HCU_VNC_PASSWORD" "$VNC_PASS_FILE" >/dev/null
chmod 600 "$VNC_PASS_FILE"
x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -rfbauth "$VNC_PASS_FILE" >"$STATE_DIR/x11vnc.log" 2>&1 &

CHROMIUM="$(python - <<'PY'
from pathlib import Path
import os
root = Path.home()/'.cache/ms-playwright'
for p in sorted(root.glob('chromium-*/chrome-linux/chrome')) + sorted(root.glob('chromium-*/chrome-linux64/chrome')):
    if p.exists():
        print(p)
        raise SystemExit
raise SystemExit(1)
PY
)"

"$CHROMIUM" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$STATE_DIR/profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --window-size=1400,850 \
  about:blank >"$STATE_DIR/chromium.log" 2>&1 &

NOVNC_WEB="/usr/share/novnc"
websockify --web="$NOVNC_WEB" 127.0.0.1:6080 127.0.0.1:5900 >"$STATE_DIR/novnc.log" 2>&1 &

sleep 2
python - <<'PY'
import urllib.request
for url in ('http://127.0.0.1:9222/json/version','http://127.0.0.1:6080/vnc.html'):
    with urllib.request.urlopen(url, timeout=5) as r:
        assert r.status == 200, (url, r.status)
print('HCU_READY')
PY
