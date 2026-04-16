#!/usr/bin/env bash
# Start the NBE DMS stack locally: Node UI on :3000, Python service on :8001.
# Node's /py proxy is pointed at the Python port via PYTHON_SERVICE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NODE_PORT="${NODE_PORT:-3000}"
PY_PORT="${PY_PORT:-8001}"
PY_API_KEY="${PY_API_KEY:-dev-key-change-me}"

RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR" uploads python-service/storage/documents

is_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

if is_alive "$RUN_DIR/node.pid"; then
  echo "Node already running (pid $(cat "$RUN_DIR/node.pid")). Use ./stop.sh first."
  exit 1
fi
if is_alive "$RUN_DIR/python.pid"; then
  echo "Python already running (pid $(cat "$RUN_DIR/python.pid")). Use ./stop.sh first."
  exit 1
fi

# Ensure Node DB is seeded (first run only).
if [ ! -f "$ROOT/db/nbe-dms.db" ]; then
  echo "Seeding Node SQLite database..."
  node db/seed.js
fi

# Ensure Python venv exists.
if [ ! -x "$ROOT/python-service/.venv/bin/uvicorn" ]; then
  echo "Python venv not found. Run:  cd python-service && python3 -m venv .venv && .venv/bin/pip install -r requirements-local.txt"
  exit 1
fi

echo "Starting Python service on :$PY_PORT ..."
(
  cd "$ROOT/python-service"
  nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PY_PORT" \
    > "$RUN_DIR/python.log" 2>&1 &
  echo $! > "$RUN_DIR/python.pid"
)

echo "Starting Node UI on :$NODE_PORT ..."
PORT="$NODE_PORT" \
PYTHON_SERVICE_URL="http://127.0.0.1:$PY_PORT" \
PYTHON_SERVICE_KEY="$PY_API_KEY" \
  nohup node server.js > "$RUN_DIR/node.log" 2>&1 &
echo $! > "$RUN_DIR/node.pid"

# Wait for Python /health (it imports ~60 routers and takes a few seconds).
echo -n "Waiting for Python /health"
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PY_PORT/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

# Wait for Node login page.
echo -n "Waiting for Node /login"
for _ in $(seq 1 15); do
  if curl -sf -o /dev/null "http://127.0.0.1:$NODE_PORT/login"; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

echo
echo "Node UI:       http://localhost:$NODE_PORT   (admin/admin123, sara/sara123, mohamed/mohamed123)"
echo "Python API:    http://localhost:$PY_PORT     (X-API-Key: $PY_API_KEY)"
echo "Python docs:   http://localhost:$PY_PORT/docs"
echo "Logs:          $RUN_DIR/node.log, $RUN_DIR/python.log"
