#!/bin/sh
set -eu

APP_NAME="${APP_NAME:-temp}"
ENV="${ENV:-None}"
PORT="${PORT:-8000}"
DATA_DIR="${DATA_DIR:-/data}"
ENABLE_TUNNEL="${ENABLE_TUNNEL:-1}"

mkdir -p "$DATA_DIR"

# ---- apply any staged self-upgrades (set by the Upgrades settings section) ----
STAGED_DIR="$DATA_DIR/upgrades/staged"
APPLIED_DIR="$DATA_DIR/upgrades/applied"
if [ -d "$STAGED_DIR" ] && [ -n "$(ls -A "$STAGED_DIR" 2>/dev/null)" ]; then
  mkdir -p "$APPLIED_DIR"
  for bundle in "$STAGED_DIR"/*; do
    [ -d "$bundle" ] || continue
    echo "[entrypoint] applying staged upgrade: $(basename "$bundle")"
    cp -a "$bundle"/. /app/
    mv "$bundle" "$APPLIED_DIR/$(basename "$bundle")"
  done
  echo "[entrypoint] staged upgrades applied (rollback via Backup & DR restore point if needed)"
fi

# ---- start the API (serves the built PWA) ----
cd /app
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port "$PORT" &
API_PID=$!

# wait for the API to come up
i=0
until python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:$PORT/api/health', timeout=2)" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[entrypoint] API failed to start" >&2
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] API is up on port $PORT"

# ---- localtunnel: <app-name>[-<env>].loca.lt ----
ENV_UPPER=$(printf '%s' "$ENV" | tr '[:lower:]' '[:upper:]')
if [ "$ENV_UPPER" = "PRD" ] || [ "$ENV_UPPER" = "NONE" ] || [ -z "$ENV" ]; then
  SUBDOMAIN=$(printf '%s' "$APP_NAME" | tr '[:upper:]_ ' '[:lower:]--')
else
  SUBDOMAIN=$(printf '%s-%s' "$APP_NAME" "$ENV" | tr '[:upper:]_ ' '[:lower:]--')
fi

if [ "$ENABLE_TUNNEL" = "1" ]; then
  echo "[entrypoint] starting tunnel: https://$SUBDOMAIN.loca.lt"
  (
    while true; do
      lt --port "$PORT" --subdomain "$SUBDOMAIN" || true
      echo "[entrypoint] tunnel exited; retrying in 5s"
      sleep 5
    done
  ) &
  sleep 3
  printf '\n============================================================\n'
  printf '  %s is running\n' "$APP_NAME"
  printf '  Local:  http://localhost:%s\n' "$PORT"
  printf '  Tunnel: https://%s.loca.lt\n' "$SUBDOMAIN"
  printf '============================================================\n\n'
else
  echo "[entrypoint] tunnel disabled (ENABLE_TUNNEL=$ENABLE_TUNNEL)"
fi

wait $API_PID
