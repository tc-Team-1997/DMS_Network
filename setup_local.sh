#!/usr/bin/env bash
#
# ZorDMS — one-shot LOCAL DEV bootstrap for macOS.
#
# Brings a fresh Mac from "git clone" to a running stack with:
#   • Homebrew (if missing)
#   • Node 20 + pnpm  + Python 3.11 + poppler + tesseract + ollama
#   • All workspace deps (`pnpm install`)
#   • Python venv for services/ai with editable install
#   • Ollama brew service + (optional) model pulls
#   • .env created from .env.example
#   • Full dev stack started via ./start.sh
#
# Idempotent — safe to re-run; skips anything already installed/configured.
#
# Usage:
#   ./setup_local.sh                # full bootstrap, prompts before pulling models
#   ./setup_local.sh --skip-models  # skip the (large) Ollama model downloads
#   ./setup_local.sh --skip-start   # set up but don't start the stack
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SKIP_MODELS=false
SKIP_START=false
for arg in "$@"; do
  case "$arg" in
    --skip-models) SKIP_MODELS=true ;;
    --skip-start)  SKIP_START=true ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (use --help)"; exit 1 ;;
  esac
done

# ─── helpers ────────────────────────────────────────────────────────────────
log() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
warn(){ printf "\033[1;33m! %s\033[0m\n" "$*"; }
die() { printf "\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }

# ─── 0) Sanity: we're on macOS ──────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
  die "setup_local.sh targets macOS. For Linux servers, use ./setup_server.sh"
fi

# ─── 1) Homebrew ────────────────────────────────────────────────────────────
log "Checking Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found — installing (you may be prompted for your password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || die "Homebrew install failed"
  # Add brew to PATH for the rest of this script (Apple Silicon vs Intel)
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
ok "brew $(brew --version | head -n 1)"

# ─── 2) System tools via brew ───────────────────────────────────────────────
log "Installing system packages (idempotent)"
PKGS=(node@20 pnpm python@3.11 poppler tesseract ollama)
for pkg in "${PKGS[@]}"; do
  if brew list --formula "${pkg%@*}" >/dev/null 2>&1 || brew list --formula "$pkg" >/dev/null 2>&1; then
    ok "$pkg already installed"
  else
    echo "  installing $pkg…"
    brew install "$pkg" || warn "brew install $pkg failed (continuing)"
  fi
done

# node@20 is keg-only; ensure it's first on PATH for this shell
if brew list --formula node@20 >/dev/null 2>&1; then
  NODE_PREFIX="$(brew --prefix node@20)"
  export PATH="$NODE_PREFIX/bin:$PATH"
fi
NODE_VERSION="$(node -v 2>/dev/null || echo missing)"
PNPM_VERSION="$(pnpm -v 2>/dev/null || echo missing)"
PY_VERSION="$(python3.11 --version 2>/dev/null || python3 --version 2>/dev/null || echo missing)"
ok "node=$NODE_VERSION pnpm=$PNPM_VERSION python=$PY_VERSION"

# ─── 3) Workspace deps ──────────────────────────────────────────────────────
log "Installing JS workspace deps (pnpm install)"
pnpm install || die "pnpm install failed"
ok "pnpm install done"

# ─── 4) Python venv for AI service ──────────────────────────────────────────
log "Setting up Python venv for services/ai"
AI_DIR="$ROOT/services/ai"
if [ ! -d "$AI_DIR" ]; then
  warn "services/ai not found — skipping Python setup"
else
  if [ ! -x "$AI_DIR/.venv/bin/python" ]; then
    PY_BIN="$(command -v python3.11 || command -v python3)"
    "$PY_BIN" -m venv "$AI_DIR/.venv" || die "python venv create failed"
  fi
  # editable install with dev+ocr extras (ocr brings pytesseract for the fallback path)
  "$AI_DIR/.venv/bin/pip" install --upgrade pip >/dev/null
  "$AI_DIR/.venv/bin/pip" install -e "$AI_DIR[dev,ocr]" \
    || die "AI service pip install failed"
  ok "Python venv ready at services/ai/.venv"
fi

# ─── 5) Ollama service + models ─────────────────────────────────────────────
log "Starting Ollama brew service"
if ! brew services list | grep -q 'ollama .* started'; then
  brew services start ollama >/dev/null 2>&1 || warn "could not start ollama (will run in mock mode)"
fi

if [ "$SKIP_MODELS" = "true" ]; then
  warn "Skipping model pulls (--skip-models). AI service will use ocr-fallback / mock until you pull the models."
else
  log "Pulling Ollama models (large download — ~10 GB total)"
  echo "  Models: qwen2.5vl:7b (vision), granite3.3:8b (text/copilot)"
  read -r -p "  Pull now? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES)
      ollama pull qwen2.5vl:7b || warn "qwen2.5vl pull failed"
      ollama pull granite3.3:8b || warn "granite3.3 pull failed"
      ok "Models pulled"
      ;;
    *)
      warn "Skipped. Pull later with: ollama pull qwen2.5vl:7b && ollama pull granite3.3:8b"
      ;;
  esac
fi

# ─── 6) .env from template ──────────────────────────────────────────────────
log "Creating .env (if missing) from .env.example"
if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/.env.example" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  ok ".env created — review and edit as needed"
else
  ok ".env already present (left untouched)"
fi

# ─── 7) Build all packages (helps tests / IDE) ──────────────────────────────
log "Building all workspace packages (pnpm -r build)"
pnpm -r build || warn "build had errors — dev stack may still run on tsx watch"

# ─── 8) Start the stack ─────────────────────────────────────────────────────
if [ "$SKIP_START" = "true" ]; then
  cat <<EOF

\033[1;32m✔ Local setup complete.\033[0m

Start the stack with:
  ./start.sh        # then open http://localhost:5174  (admin / admin123)

Stop / restart:
  ./stop.sh
  ./restart.sh
EOF
  exit 0
fi

log "Starting the dev stack (./start.sh)"
exec "$ROOT/start.sh"
