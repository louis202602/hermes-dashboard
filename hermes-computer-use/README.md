# Hermes Computer Use

Remote browser fallback for Hermes Business when no API/MCP exists.

## Architecture

GitHub Codespaces → Xvfb → Chromium headful → CDP localhost:9222 → Playwright / `hcu.py`.
Tablet viewing uses x11vnc on localhost:5900 exposed through noVNC/websockify on Codespaces private forwarded port 6080.

## Required secret

Create the Codespaces secret `HCU_VNC_PASSWORD` before starting the Codespace. Never commit it.

## Startup

The devcontainer runs automatically:

- `scripts/setup.sh` on first creation
- `scripts/start.sh` on each start

The start script refuses to expose VNC if `HCU_VNC_PASSWORD` is missing.

## Tablet view

In the Codespace Ports panel, keep port **6080** private. Open its forwarded URL and use `/vnc.html`. Enter `HCU_VNC_PASSWORD` when prompted by the VNC client.

## CLI examples

```bash
python hermes-computer-use/hcu.py open https://example.com
python hermes-computer-use/hcu.py fill 'input[name=q]' 'test'
python hermes-computer-use/hcu.py click 'button[type=submit]'
python hermes-computer-use/hcu.py screenshot hermes-computer-use/state/example.png
python hermes-computer-use/hcu.py pages
python hermes-computer-use/hcu.py handoff 'FranceConnect authentication required'
```

## Human handoff

When authentication, MFA, CAPTCHA, banking confirmation or a personal signature is required:

1. Hermes positions Chromium on the exact page.
2. `hcu.py handoff "reason"` records the state.
3. Louis opens the private Codespaces port 6080 from the tablet and performs only the required personal action.
4. After confirmation (`VALIDÉ`), automation resumes through the same persistent Chromium profile.

## Security

- CDP is bound to localhost only.
- VNC is bound to localhost only.
- Codespaces port 6080 must remain private.
- VNC requires a secret password.
- Browser profile, downloads and action logs are ignored by Git.
- Do not save FranceConnect, MFA or banking secrets in repository files or logs.
- Prefer an official API/MCP whenever available; browser control is the fallback.

## INPI test sequence

Do not submit anything until the prepared Hermes Business activity declaration has been reviewed. First verify navigation to `https://formalites.entreprises.gouv.fr/`, then hand off for FranceConnect authentication. Automation may resume after authentication and stop again for any legally personal signature/attestation.
