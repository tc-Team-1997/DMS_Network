#!/usr/bin/env bash
# Restart the NBE DMS stack: stop, then start. Forwards env vars to start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$ROOT/stop.sh"
sleep 1
exec "$ROOT/start.sh"
