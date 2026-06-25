#!/usr/bin/env bash
#
# Restart the ZorDMS dev stack: free all ports, then start everything fresh.
#
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/start.sh"   # start.sh already frees the ports first
