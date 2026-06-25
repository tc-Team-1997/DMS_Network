#!/usr/bin/env bash
#
# Boot the full ZorDMS stack for local development.
# Every Node service runs on SQLite (DB_CLIENT=sqlite3 is baked into each
# service's `dev` script), so NO external Postgres/Oracle is required.
#
#   gateway      :4000   (login / users / authz)   <-- required for login
#   core         :4001   (documents / repository / records / enterprise)
#   workflow     :4002   (workflows / cases)
#   notify       :4003   (alerts / realtime)
#   search       :4004   (enterprise search)
#   integration  :4005   (connectors / webhooks)
#   web          :5174   (React app)  -> http://localhost:5174  (admin / admin123)
#
# The Python AI service (:8000) is a separate toolchain — start it with:
#   cd services/ai && .venv/bin/uvicorn app.main:app --port 8000
#
# Ctrl-C stops everything.

set -euo pipefail
cd "$(dirname "$0")/.."

pids=()
cleanup() {
  echo ""
  echo "Stopping ZorDMS dev stack..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  pkill -f "tsx watch src/server.ts" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "Starting ZorDMS dev stack (SQLite, no external DB needed)..."
for svc in gateway core workflow notify search integration; do
  echo "  -> @zordms/$svc"
  pnpm --filter "@zordms/$svc" dev &
  pids+=($!)
done

echo "  -> @zordms/web (http://localhost:5174)"
pnpm --filter @zordms/web dev &
pids+=($!)

echo ""
echo "All services starting. Open http://localhost:5174 and sign in with admin / admin123."
echo "(Press Ctrl-C to stop everything.)"
wait
