#!/usr/bin/env bash
# DocManager — start the full local stack.
#
# Services started (ports configurable via env):
#   MinIO      :9100 (API)  :9101 (console)   — S3-compatible blob store
#   Ollama     :11434                         — local LLM runtime
#   Python API :8001                          — FastAPI (includes DocBrain)
#   Node       :3000                          — Express gateway + EJS legacy
#   Vite SPA   :5174                          — DocManager web (React)
#
# Postgres + Redis are expected to already be running via `brew services`
# (they're started on boot once you've run `brew services start postgresql@16 redis`).
# DocManager uses SQLite in the pilot; Postgres migration is Q2 2026 work.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------- ports + settings ----------
NODE_PORT="${NODE_PORT:-3000}"
PY_PORT="${PY_PORT:-8001}"
WEB_PORT="${WEB_PORT:-5174}"
MINIO_PORT="${MINIO_PORT:-9100}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9101}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"

PY_API_KEY="${PY_API_KEY:-dev-key-change-me}"
MINIO_USER="${MINIO_ROOT_USER:-docmanager}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-docmanager-local-dev-secret}"
MINIO_BUCKET="${S3_BUCKET:-docmanager}"

# Flags to skip pieces (WEB=0 for headless smoke tests, AI=0 for slow networks).
WEB="${WEB:-1}"
AI="${AI:-1}"

RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR" uploads python-service/storage/documents "$RUN_DIR/minio-data"

is_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
# Vite binds IPv6-only by default on macOS; probe via localhost (resolves to
# whichever family is up) with a short timeout so a broken service can't stall.
port_up()  { curl -sf --max-time 2 -o /dev/null "$1"; }

# ---------- pre-flight ----------
if is_alive "$RUN_DIR/node.pid"; then
  echo "Node already running (pid $(cat "$RUN_DIR/node.pid")). Use ./stop.sh first."
  exit 1
fi
if is_alive "$RUN_DIR/python.pid"; then
  echo "Python already running (pid $(cat "$RUN_DIR/python.pid")). Use ./stop.sh first."
  exit 1
fi
if [ "$WEB" = "1" ] && is_alive "$RUN_DIR/web.pid"; then
  echo "Web dev server already running (pid $(cat "$RUN_DIR/web.pid")). Use ./stop.sh first."
  exit 1
fi

# ---------- seed DB (first run) ----------
if [ ! -f "$ROOT/db/nbe-dms.db" ]; then
  echo "Seeding Node SQLite database..."
  node db/seed.js
fi

# ---------- Python venv check ----------
if [ ! -x "$ROOT/python-service/.venv/bin/uvicorn" ]; then
  echo "Python venv not found. Run:"
  echo "  cd python-service && python3 -m venv .venv && .venv/bin/pip install -r requirements-local.txt"
  exit 1
fi

# ---------- MinIO ----------
if ! port_up "http://127.0.0.1:$MINIO_PORT/minio/health/live"; then
  if command -v minio >/dev/null 2>&1; then
    echo "Starting MinIO on :$MINIO_PORT (console :$MINIO_CONSOLE_PORT) ..."
    MINIO_ROOT_USER="$MINIO_USER" MINIO_ROOT_PASSWORD="$MINIO_PASS" \
      nohup minio server "$RUN_DIR/minio-data" \
        --address ":$MINIO_PORT" --console-address ":$MINIO_CONSOLE_PORT" \
        > "$RUN_DIR/minio.log" 2>&1 &
    echo $! > "$RUN_DIR/minio.pid"
  else
    echo "minio not found (brew install minio/stable/minio); DocBrain will fall back to filesystem storage."
  fi
fi

# ---------- Ollama ----------
if [ "$AI" = "1" ]; then
  if ! port_up "http://127.0.0.1:$OLLAMA_PORT/api/version"; then
    if command -v ollama >/dev/null 2>&1; then
      echo "Starting Ollama on :$OLLAMA_PORT ..."
      nohup ollama serve > "$RUN_DIR/ollama.log" 2>&1 &
      echo $! > "$RUN_DIR/ollama.pid"
      # Give the daemon a moment to bind.
      for _ in $(seq 1 10); do
        port_up "http://127.0.0.1:$OLLAMA_PORT/api/version" && break || sleep 1
      done
    else
      echo "ollama not found (brew install --cask ollama); AI surfaces will show errors."
    fi
  fi
fi

# ---------- Python service ----------
echo "Starting Python service on :$PY_PORT ..."
(
  cd "$ROOT/python-service"
  # Wire DocBrain + storage env
  S3_ENDPOINT="http://127.0.0.1:$MINIO_PORT" \
  S3_BUCKET="$MINIO_BUCKET" \
  S3_ACCESS_KEY="$MINIO_USER" \
  S3_SECRET_KEY="$MINIO_PASS" \
  OLLAMA_HOST="http://127.0.0.1:$OLLAMA_PORT" \
  DOCBRAIN_DB="$ROOT/storage/docbrain.sqlite" \
  nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PY_PORT" \
    > "$RUN_DIR/python.log" 2>&1 &
  echo $! > "$RUN_DIR/python.pid"
)

# ---------- Node ----------
echo "Starting Node gateway on :$NODE_PORT ..."
PORT="$NODE_PORT" \
PYTHON_SERVICE_URL="http://127.0.0.1:$PY_PORT" \
PYTHON_SERVICE_KEY="$PY_API_KEY" \
  nohup node server.js > "$RUN_DIR/node.log" 2>&1 &
echo $! > "$RUN_DIR/node.pid"

# ---------- Vite ----------
if [ "$WEB" = "1" ]; then
  if [ ! -d "$ROOT/apps/web/node_modules" ]; then
    echo "Installing apps/web dependencies (first run)..."
    (cd "$ROOT/apps/web" && npm install --silent)
  fi
  echo "Starting Vite dev server on :$WEB_PORT ..."
  (
    cd "$ROOT/apps/web"
    VITE_NODE_BACKEND="http://127.0.0.1:$NODE_PORT" \
      nohup npm run dev -- --port "$WEB_PORT" > "$RUN_DIR/web.log" 2>&1 &
    echo $! > "$RUN_DIR/web.pid"
  )
fi

# ---------- wait for readiness ----------
wait_for() {
  local name="$1" url="$2" timeout="$3"
  echo -n "Waiting for $name"
  for _ in $(seq 1 "$timeout"); do
    if port_up "$url"; then echo " ok"; return 0; fi
    echo -n "."; sleep 1
  done
  echo " TIMEOUT"
  return 1
}

wait_for "MinIO"         "http://127.0.0.1:$MINIO_PORT/minio/health/live"         15  || true
wait_for "Ollama"        "http://127.0.0.1:$OLLAMA_PORT/api/version"              10  || true
wait_for "Python /health" "http://127.0.0.1:$PY_PORT/health"                       30  || true
wait_for "Node /login"   "http://127.0.0.1:$NODE_PORT/login"                       15  || true
[ "$WEB" = "1" ] && wait_for "Vite /" "http://localhost:$WEB_PORT/" 30 || true

# ---------- one-time MinIO bucket + Ollama models ----------
if command -v mc >/dev/null 2>&1 && port_up "http://127.0.0.1:$MINIO_PORT/minio/health/live"; then
  mc alias set local "http://127.0.0.1:$MINIO_PORT" "$MINIO_USER" "$MINIO_PASS" >/dev/null 2>&1 || true
  mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null 2>&1 || true
fi

if [ "$AI" = "1" ] && command -v ollama >/dev/null 2>&1 && port_up "http://127.0.0.1:$OLLAMA_PORT/api/version"; then
  have_model() { ollama list 2>/dev/null | awk '{print $1}' | grep -q "^$1"; }
  for m in llama3.2:3b nomic-embed-text; do
    if ! have_model "$m"; then
      echo "Pulling Ollama model $m (first run only, may take a while)..."
      ollama pull "$m" > "$RUN_DIR/ollama-pull-$m.log" 2>&1 || echo "  (pull failed; check $RUN_DIR/ollama-pull-$m.log)"
    fi
  done
fi

echo
echo "  DocManager SPA:   http://localhost:$WEB_PORT     (admin/admin123, sara/sara123, mohamed/mohamed123)"
echo "  Node (legacy EJS): http://localhost:$NODE_PORT"
echo "  Python API:       http://localhost:$PY_PORT     (X-API-Key: $PY_API_KEY)"
echo "  Python docs:      http://localhost:$PY_PORT/docs"
echo "  MinIO console:    http://localhost:$MINIO_CONSOLE_PORT     ($MINIO_USER / $MINIO_PASS)"
echo "  Ollama:           http://localhost:$OLLAMA_PORT"
echo "  Logs:             $RUN_DIR/{node,python,web,minio,ollama}.log"
