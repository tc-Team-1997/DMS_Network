#!/usr/bin/env bash
#
# Stop the ZorDMS dev stack — frees every service + web + AI port.
#
set -uo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

PORTS=(4000 4001 4002 4003 4004 4005 5174 8000)
echo "Stopping ZorDMS dev stack..."
for p in "${PORTS[@]}"; do
  pids=$(lsof -ti tcp:"$p" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  freeing :$p (pid $pids)"
    kill $pids 2>/dev/null || true
  fi
done

# Reap any lingering watchers belonging to this project.
pkill -f "tsx watch src/server.ts" 2>/dev/null || true
pkill -f "uvicorn app.main:app" 2>/dev/null || true

# Give sockets a moment to release.
sleep 1
echo "ZorDMS dev stack stopped."
