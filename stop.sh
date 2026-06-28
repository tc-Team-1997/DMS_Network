#!/usr/bin/env bash
#
# Stop the ZorDMS dev stack — reaps the `tsx watch` / `pnpm --filter` / uvicorn
# processes behind the stack, then frees every service + web + AI port.
#
set -uo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

# Pick up GATEWAY_PORT from .env so we free the gateway's actual port (it may be
# moved off the default :4000 when another local project occupies that port).
# We deliberately do NOT touch :4000 unless that's where the gateway runs.
if [ -f ".env" ]; then
  # shellcheck disable=SC1091
  . ".env"
fi
GATEWAY_PORT="${GATEWAY_PORT:-4000}"

# Long-lived processes behind the stack. Each node service is three processes:
#   pnpm --filter @zordms/<svc> dev  ->  tsx .../cli.mjs watch src/server.ts  ->  node ...loader.mjs src/server.ts
# Only the innermost binds a port, and the `tsx watch` parent respawns it — so
# freeing ports alone leaves watchers that resurrect a server (and, once
# reparented to init, become stale instances that grab the port on next start).
# Reap the watchers/parents FIRST so nothing respawns. Patterns are scoped to
# DMS_Network / @zordms / zordms_ai so other projects on this machine are safe.
PATTERNS=(
  "DMS_Network/services/.*watch src/server.ts"   # node-service tsx watchers (incl. orphans reparented to init)
  "pnpm --filter @zordms"                         # per-service `pnpm dev` parents
  "uvicorn zordms_ai"                             # python AI service
)
PORTS=("$GATEWAY_PORT" 4001 4002 4003 4004 4005 5174 8000)

echo "Stopping ZorDMS dev stack..."

# 1) Stop watchers/parents first (SIGTERM) so they can't respawn a server.
for pat in "${PATTERNS[@]}"; do
  pkill -f "$pat" 2>/dev/null || true
done

# 2) Free any port still held (server children, vite).
for p in "${PORTS[@]}"; do
  pids=$(lsof -ti tcp:"$p" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  freeing :$p (pid $pids)"
    kill $pids 2>/dev/null || true
  fi
done

# 3) Escalate to SIGKILL for anything that ignored SIGTERM.
sleep 1
for pat in "${PATTERNS[@]}"; do
  pkill -9 -f "$pat" 2>/dev/null || true
done
for p in "${PORTS[@]}"; do
  pids=$(lsof -ti tcp:"$p" 2>/dev/null || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done

# Give sockets a moment to release.
sleep 1
echo "ZorDMS dev stack stopped."
