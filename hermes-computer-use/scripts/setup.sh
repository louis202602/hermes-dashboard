#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox dbus-x11
python -m pip install --upgrade pip
python -m pip install -r hermes-computer-use/requirements.txt
python -m playwright install --with-deps chromium
mkdir -p hermes-computer-use/state/profile hermes-computer-use/state/downloads
chmod +x hermes-computer-use/hcu.py hermes-computer-use/scripts/start.sh
