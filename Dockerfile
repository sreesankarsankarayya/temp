# ============================================================
# Single Dockerfile: builds the Vite+Lit PWA, then packages it
# with the FastAPI backend and a localtunnel client.
#
# Build (pass the folder name so the tunnel matches it):
#   docker build --build-arg APP_NAME=$(basename "$PWD") -t myapp .
# Run (SQLite lives on the mounted volume):
#   docker run -p 8000:8000 -v myapp-data:/data -e ENV=DEV myapp
# ============================================================

# ---------- Stage 1: frontend build (also provides node + localtunnel) ----------
FROM node:22-slim AS frontend
RUN npm install -g localtunnel --no-audit --no-fund
WORKDIR /build/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: runtime (no apt needed) ----------
FROM python:3.11-slim

# APP_NAME defaults to the project folder name; override at build or run time.
ARG APP_NAME=temp
ENV APP_NAME=${APP_NAME} \
    ENV=DEV \
    DATA_DIR=/data \
    PORT=8000 \
    ENABLE_TUNNEL=1 \
    PYTHONUNBUFFERED=1

# node runtime + localtunnel client, lifted from the build stage (both images
# share the same Debian base, so the binary and its libs are compatible)
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/
COPY --from=frontend /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 /usr/lib/x86_64-linux-gnu/
COPY --from=frontend /usr/local/lib/node_modules/localtunnel /usr/local/lib/node_modules/localtunnel
RUN printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/localtunnel/bin/lt.js "$@"\n' > /usr/local/bin/lt \
    && chmod +x /usr/local/bin/lt

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY VERSION CHANGELOG.md ./
COPY scripts/entrypoint.sh /app/entrypoint.sh
COPY --from=frontend /build/frontend/dist frontend/dist
RUN chmod +x /app/entrypoint.sh

VOLUME /data
EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
