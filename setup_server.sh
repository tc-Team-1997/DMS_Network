#!/usr/bin/env bash
#
# ZorDMS — one-shot SERVER bootstrap (container-based).
#
# Brings a fresh Linux server (or any host with Docker) from "git clone" to a
# running ZorDMS stack composed entirely of containers:
#
#     postgres  redis  gateway  core  workflow  notify  search  integration  ai  web
#
# What it does:
#   1. Verifies/installs Docker Engine + Compose plugin (Debian/Ubuntu only;
#      on other distros it prints install instructions and exits).
#   2. Creates `deploy/server/.env` from `.env.server.example` on first run.
#   3. Builds all container images (Node monorepo image, Python AI image,
#      web/nginx image).
#   4. Runs the one-shot DB migration container.
#   5. Brings the stack up in detached mode and waits for `gateway` to report
#      healthy.
#
# Idempotent — safe to re-run; --rebuild forces image rebuilds.
#
# Usage:
#   sudo ./setup_server.sh                # bootstrap + start
#   ./setup_server.sh --skip-docker       # assume Docker already installed
#   ./setup_server.sh --rebuild           # force `compose build --no-cache`
#   ./setup_server.sh --down              # stop + remove everything (keeps volumes)
#   ./setup_server.sh --reset             # --down + drop the pgdata volume
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$ROOT/deploy/server"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"
ENV_TEMPLATE="$COMPOSE_DIR/.env.server.example"

SKIP_DOCKER=false
REBUILD=false
DOWN=false
RESET=false
for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=true ;;
    --rebuild)     REBUILD=true ;;
    --down)        DOWN=true ;;
    --reset)       DOWN=true; RESET=true ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0 ;;
    *)
      echo "Unknown flag: $arg (use --help)"; exit 1 ;;
  esac
done

log() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
warn(){ printf "\033[1;33m! %s\033[0m\n" "$*"; }
die() { printf "\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }

# Compose wrapper that picks `docker compose` (v2 plugin) or `docker-compose` (v1).
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    die "No docker compose found. Re-run without --skip-docker so Docker can be installed, or install Docker Compose manually."
  fi
}

# ─── handle --down / --reset early ─────────────────────────────────────────
if [ "$DOWN" = "true" ]; then
  log "Stopping stack"
  if [ -f "$ENV_FILE" ]; then
    if [ "$RESET" = "true" ]; then
      compose down -v
      ok "Stack down + volumes removed"
    else
      compose down
      ok "Stack down (volumes preserved)"
    fi
  else
    warn "$ENV_FILE not found — nothing to stop"
  fi
  exit 0
fi

# ─── 1) Docker present? install on Debian/Ubuntu if not ────────────────────
log "Checking Docker"
if [ "$SKIP_DOCKER" = "false" ] && ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" != "Linux" ]; then
    die "Docker not found and auto-install is Linux-only. Install Docker Desktop manually and re-run with --skip-docker."
  fi
  if [ ! -f /etc/os-release ]; then
    die "Cannot detect distro (no /etc/os-release). Install Docker manually then re-run with --skip-docker."
  fi
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      log "Installing Docker Engine + Compose plugin (Ubuntu/Debian)"
      [ "$(id -u)" -eq 0 ] || die "Docker install needs root — re-run with: sudo $0"
      apt-get update
      apt-get install -y ca-certificates curl gnupg
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      systemctl enable --now docker
      ok "Docker installed"
      ;;
    *)
      die "Auto-install supports Ubuntu/Debian only. Install Docker on this distro (${PRETTY_NAME:-$ID}) following https://docs.docker.com/engine/install/ then re-run with --skip-docker."
      ;;
  esac
fi
docker --version || die "Docker still not available"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# ─── 2) Sanity-check compose file exists ──────────────────────────────────
[ -f "$COMPOSE_FILE" ]  || die "Missing $COMPOSE_FILE — did you pull the latest repo?"
[ -f "$ENV_TEMPLATE" ]  || die "Missing $ENV_TEMPLATE — did you pull the latest repo?"

# ─── 3) Create .env from template on first run ────────────────────────────
log "Preparing $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  ok "Created $ENV_FILE from template"
  warn "Open it and replace the JWT_SECRET / INTERNAL_SERVICE_TOKEN / DB_PASSWORD before production use."
else
  ok "$ENV_FILE already present (left untouched)"
fi

# ─── 4) Build images ──────────────────────────────────────────────────────
log "Building images"
if [ "$REBUILD" = "true" ]; then
  compose build --no-cache
else
  compose build
fi
ok "Images built"

# ─── 5) Run the one-shot migration ────────────────────────────────────────
log "Running database migration"
compose up -d postgres
compose run --rm migrate
ok "Database migrated"

# ─── 6) Bring the rest of the stack up ────────────────────────────────────
log "Starting the stack"
compose up -d
ok "Stack started"

# ─── 7) Wait for the gateway to become healthy ────────────────────────────
log "Waiting for gateway to report healthy (up to 2 min)"
DEADLINE=$(( $(date +%s) + 120 ))
while : ; do
  status="$(docker inspect --format '{{.State.Health.Status}}' zordms-gateway-1 2>/dev/null \
            || docker inspect --format '{{.State.Health.Status}}' zordms_gateway_1 2>/dev/null \
            || echo unknown)"
  if [ "$status" = "healthy" ]; then
    ok "gateway is healthy"
    break
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    warn "gateway didn't go healthy within 2 min — recent logs:"
    compose logs --tail=80 gateway || true
    break
  fi
  printf "."
  sleep 3
done

WEB_PORT="$(grep -E '^WEB_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
WEB_PORT="${WEB_PORT:-80}"

cat <<EOF

\033[1;32m✔ ZorDMS server stack is up.\033[0m

  Web UI :  http://<this-host>:${WEB_PORT}   (sign in: admin / admin123)
  Gateway:  http://<this-host>:4000          (also reachable via the web /svc/* proxy)

Useful commands (from repo root):
  ./setup_server.sh --rebuild           # rebuild all images
  ./setup_server.sh --down              # stop (keeps DB volume)
  ./setup_server.sh --reset             # stop + drop DB volume

Compose passthrough (same env+compose file as setup_server.sh):
  cd deploy/server && docker compose ps
  cd deploy/server && docker compose logs -f gateway
  cd deploy/server && docker compose exec postgres psql -U zordms zordms
EOF
