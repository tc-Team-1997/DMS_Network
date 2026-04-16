#!/usr/bin/env bash
# Stop the NBE DMS stack. Uses PID files written by start.sh; falls back to
# pattern match if PID files are missing.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"

stop_pid() {
  local name="$1" pidfile="$2"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.3
      done
      kill -9 "$pid" 2>/dev/null || true
    else
      echo "$name not running (stale pid $pid)."
    fi
    rm -f "$pidfile"
  else
    echo "$name: no pid file — trying pattern match."
  fi
}

stop_pid "Node"   "$RUN_DIR/node.pid"
stop_pid "Python" "$RUN_DIR/python.pid"

# Fallback sweep for any leftover processes from prior runs.
pkill -f "node $ROOT/server.js" 2>/dev/null || true
pkill -f "node server.js"       2>/dev/null || true
pkill -f "uvicorn app.main:app" 2>/dev/null || true

echo "Stopped."
