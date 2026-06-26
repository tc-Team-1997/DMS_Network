#!/usr/bin/env bash
#
# Start the full ZorDMS dev stack on SQLite (no external Postgres/Oracle needed).
# Frees the ports first, then launches every service + the web app in the
# background, writes logs to .devlogs/, and waits until the gateway + web are up.
#
#   gateway      :4000   login / users / authz            (REQUIRED for login)
#   core         :4001   documents / repository / records / enterprise
#   workflow     :4002   workflows / cases
#   notify       :4003   alerts / realtime
#   search       :4004   enterprise search
#   integration  :4005   connectors / webhooks
#   ai (python)  :8000   OCR / classification (started only if the venv exists)
#   web          :5174   React app  ->  http://localhost:5174   (admin / admin123)
#
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
LOGDIR="$ROOT/.devlogs"
mkdir -p "$LOGDIR"

# Load local secrets (.env is gitignored) and export every key to the child
# services. `set -a` auto-exports anything sourced; the per-service `dev` scripts
# still set DB_CLIENT=sqlite3 inline, which overrides any DB_* from .env, so dev
# stays on SQLite. SMTP_* (Zoho email) and other secrets flow through here.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

# Shared secrets so every service (incl. the Python AI) verifies the gateway JWT.
export JWT_SECRET="${JWT_SECRET:-change-me-in-prod}"
export INTERNAL_SERVICE_TOKEN="${INTERNAL_SERVICE_TOKEN:-change-me-internal}"

# 1) Free the ports (idempotent start / restart).
bash "$ROOT/stop.sh"

# 2) Launch each Node service + the web app (DB_CLIENT=sqlite3 is baked into
#    each service's `dev` script).
echo "Starting ZorDMS dev stack..."
start_node() {  # <label> <pnpm-filter>
  echo "  -> $1"
  pnpm --filter "$2" dev > "$LOGDIR/$1.log" 2>&1 &
}
start_node gateway     @zordms/gateway
start_node core        @zordms/core
start_node workflow    @zordms/workflow
start_node notify      @zordms/notify
start_node search      @zordms/search
start_node integration @zordms/integration
start_node web         @zordms/web

# 3) Optional Python AI service (only if its venv has been set up).
if [ -x "$ROOT/services/ai/.venv/bin/uvicorn" ]; then
  echo "  -> ai (python)"
  ( cd "$ROOT/services/ai" && exec env \
      SEARCH_URL="http://localhost:4004" \
      OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}" \
      OLLAMA_VLM_MODEL="${OLLAMA_VLM_MODEL:-qwen2.5vl:7b}" \
      OLLAMA_TEXT_MODEL="${OLLAMA_TEXT_MODEL:-granite3.3:8b}" \
      AI_BACKEND="${AI_BACKEND:-auto}" \
    .venv/bin/uvicorn zordms_ai.app:create_app --factory --port 8000 ) > "$LOGDIR/ai.log" 2>&1 &
else
  echo "  -> ai (python)  [skipped — run: cd services/ai && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]']"
fi

# 4) Wait for the two things needed to log in.
echo ""
printf "Waiting for gateway + web"
for _ in $(seq 1 40); do
  if curl -fsS localhost:4000/health >/dev/null 2>&1 && curl -fsS localhost:5174 >/dev/null 2>&1; then
    echo ""
    echo "✅ ZorDMS is up:  http://localhost:5174   (sign in: admin / admin123)"
    echo "   Logs:  $LOGDIR/<service>.log"
    echo "   Stop:  ./stop.sh      Restart: ./restart.sh"
    exit 0
  fi
  printf "."
  sleep 1
done

echo ""
echo "⚠️  gateway/web health check timed out. Check the logs:"
echo "    tail -n 40 $LOGDIR/gateway.log"
echo "    tail -n 40 $LOGDIR/web.log"
exit 1
