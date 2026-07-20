# Glassmorphic PWA Platform Bootstrap

A fully responsive PWA (Vite + Lit) with a glassmorphic, light-bluish design and
system/light/dark themes, backed by FastAPI and SQLite, packaged in a **single
Dockerfile**. The app name follows the project folder name (`temp` by default)
and drives the database file names and the localtunnel subdomain.

## Features

- **PWA**: manifest, service worker, installable, fully responsive layout.
- **Themes**: system / light / dark with a glassmorphic light-bluish design system.
- **Auth & roles**: JWT login with `user`, `operator`, `sysadmin`, `admin`.
- **Settings**: typeahead search; sections collapse when idle and expand on focus/match.
- **LLM key vault**: Fernet-encrypted keys for OpenAI, NVIDIA, Grok (xAI), OpenRouter,
  vLLM, Ollama and local deployments (e.g. LongCat); any model id accepted.
- **Tokenomics** (sysadmin/admin): module-wise usage, forecasting line graph and
  operational & development cost-saving suggestions.
- **Feedback**: report a bug / request a feature from the profile dropdown; admins
  triage the full list in Settings.
- **Audit + logs**: every API request in `<app>-audit.log` (SQLite), rotating app logs.
- **Backup & DR** (sysadmin): scheduled/full/incremental backups & restore.
- **Upgrades** (sysadmin): signed bundle upload, restore point, self-upgrade, rollback.
- **Version & changelog**: version in the sidebar under logout; click for the changelog.
- **Environment badge**: `ENV` shown in the top bar when not `PRD`/`None`.

## Quick start (Docker — recommended)

```bash
docker build --build-arg APP_NAME=$(basename "$PWD") -t temp-app .
docker run -p 8000:8000 -v temp-data:/data \
  -e ENV=DEV \
  -e SECRET_KEY=$(openssl rand -hex 32) \
  -e UPGRADE_SIGNING_KEY=$(openssl rand -hex 32) \
  temp-app
```

On first run the entrypoint prints the public tunnel:
`https://<app-name>-<env>.loca.lt` (e.g. `https://temp-dev.loca.lt`). When `ENV`
is `PRD`/`None` no suffix is appended, and the tunnel can be disabled entirely
with `ENABLE_TUNNEL=0`. Or use `docker compose up --build`.

Default login (first boot only, change immediately): **admin / admin**
(configurable via `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## Local development

```bash
# backend
pip install -r backend/requirements.txt
DATA_DIR=./data uvicorn backend.app.main:app --reload --port 8000

# frontend (separate shell; proxies /api to :8000)
cd frontend && npm install && npm run dev
```

## Data layout (mounted volume `/data`)

| File | Purpose |
|---|---|
| `<app>.db` | application data (feedback, LLM usage) |
| `<app>-system.db` | users, LLM keys, settings, backups, upgrades |
| `<app>-audit.log` | audit trail (SQLite database) |
| `logs/<app>.log` | rotating application logs |
| `backups/`, `upgrades/` | backup archives and upgrade bundles |

## Signing an upgrade bundle

```bash
export UPGRADE_SIGNING_KEY=...   # must match the server
python scripts/sign_bundle.py --pack backend VERSION CHANGELOG.md -o bundle.tar.gz
# upload bundle.tar.gz + printed signature in Settings → Upgrades
```

Applying an upgrade stages it behind an automatic restore point; the entrypoint
activates staged bundles on the next container restart, and rollback removes the
staged bundle (restore the linked restore point to revert data).

## Environment variables

See [.env.example](.env.example) for the full list.
