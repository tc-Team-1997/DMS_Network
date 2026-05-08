#!/usr/bin/env bash
# Live-stack end-to-end smoke test. Exercises every /spa/api/* surface
# against the running Node + Python + SQLite + Ollama stack started by
# ./start.sh. No mocks. Prints a per-module pass/fail table.
#
# Exit code: 0 if every check passes, non-zero otherwise.

set -u

NODE="${NODE_BASE:-http://localhost:3000}"
PY="${PY_BASE:-http://localhost:8001}"
COOKIES="$(mktemp -t nbe-smoke-XXXXXX.cookies)"
trap 'rm -f "$COOKIES"' EXIT

PASS=0
FAIL=0
FAIL_DETAILS=()

# --- helpers --------------------------------------------------------------

row() {                # row <module> <check> <pass|fail> [detail]
  local mod="$1" check="$2" status="$3" detail="${4:-}"
  if [ "$status" = "pass" ]; then
    printf "  [\033[32mPASS\033[0m] %-22s %s\n" "$mod" "$check"
    PASS=$((PASS+1))
  else
    printf "  [\033[31mFAIL\033[0m] %-22s %s  %s\n" "$mod" "$check" "$detail"
    FAIL=$((FAIL+1))
    FAIL_DETAILS+=("$mod — $check — $detail")
  fi
}

# Fetch and check that HTTP status is 2xx.
check_ok() {           # check_ok <module> <check> <url> [extra-curl-args...]
  local mod="$1" check="$2" url="$3"; shift 3
  local code
  code=$(curl -sS -o /tmp/nbe-smoke-body -w "%{http_code}" -b "$COOKIES" "$@" "$url" || echo "000")
  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then row "$mod" "$check" pass
  else row "$mod" "$check" fail "HTTP $code"
  fi
}

# Fetch then assert a required JSON key/path exists. Path syntax:
#   empty     → any valid JSON (200 with parseable body)
#   a.b       → {a:{b:...}}
#   a.0.b     → a[0].b
check_has_key() {      # check_has_key <module> <check> <url> <path>
  local mod="$1" check="$2" url="$3" path="$4"
  local body http detail
  body=$(curl -sS -b "$COOKIES" -w '\n__HTTP__%{http_code}' "$url" 2>/dev/null)
  http="${body##*__HTTP__}"
  body="${body%__HTTP__*}"
  if [[ ! "$http" =~ ^2[0-9][0-9]$ ]]; then
    row "$mod" "$check" fail "HTTP $http"
    return
  fi
  detail=$(BODY="$body" PATHSPEC="$path" python3 -c '
import json, os, sys
body = os.environ.get("BODY", "")
path = os.environ.get("PATHSPEC", "")
try:
    data = json.loads(body) if body else None
except Exception as e:
    print(f"not-json: {e}"); sys.exit(2)
if not path:
    sys.exit(0)
cur = data
for key in path.split("."):
    if isinstance(cur, list) and key.isdigit():
        idx = int(key)
        if idx >= len(cur):
            print(f"index {idx} out of range"); sys.exit(3)
        cur = cur[idx]
    elif isinstance(cur, dict):
        if key not in cur:
            print(f"key {key!r} missing"); sys.exit(3)
        cur = cur[key]
    else:
        print(f"cannot descend into {type(cur).__name__} at {key}"); sys.exit(4)
sys.exit(0)
' 2>&1)
  if [ $? -eq 0 ]; then row "$mod" "$check" pass
  else row "$mod" "$check" fail "${detail:-missing $path}"
  fi
}

section() { printf "\n\033[1m── %s ──\033[0m\n" "$1"; }

# --- 0. reachability ------------------------------------------------------

section "Reachability"
check_ok gateway "node /login reachable"    "$NODE/login"
check_ok gateway "python /health reachable" "$PY/health"

# --- 1. auth --------------------------------------------------------------

section "auth"
LOGIN_CODE=$(curl -sS -o /tmp/nbe-smoke-login -w "%{http_code}" \
  -c "$COOKIES" -X POST "$NODE/spa/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}')
if [ "$LOGIN_CODE" = "200" ]; then row auth "admin login"  pass
else                                row auth "admin login"  fail "HTTP $LOGIN_CODE"
fi
check_has_key auth "me returns user" "$NODE/spa/api/me" "user.username"

# --- 2. stats -------------------------------------------------------------

section "stats"
check_has_key stats "totals"       "$NODE/spa/api/stats"            "total"
check_has_key stats "expiry buckets" "$NODE/spa/api/stats/expiry"   "labels"
check_has_key stats "doc-types"    "$NODE/spa/api/stats/doc-types"  "0.doc_type"

# --- 3. folders -----------------------------------------------------------

section "folders"
check_has_key folders "list" "$NODE/spa/api/folders" "0.name"

# --- 4. documents ---------------------------------------------------------

section "documents"
check_has_key documents "list returns array" "$NODE/spa/api/documents?limit=1" "0.id"
DOC_ID=$(curl -sS -b "$COOKIES" "$NODE/spa/api/documents?limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")
if [ -n "$DOC_ID" ]; then
  check_has_key documents "get by id" "$NODE/spa/api/documents/$DOC_ID" "filename"
fi

# --- 5. search ------------------------------------------------------------

section "search"
check_ok search "empty returns 200" "$NODE/spa/api/search?q="
check_has_key search "query returns array" "$NODE/spa/api/search?q=passport" "0.id"

# --- 6. workflows ---------------------------------------------------------

section "workflows"
check_has_key workflows "list" "$NODE/spa/api/workflows?limit=1" "0.id"

# --- 6b. document-types ----------------------------------------------------

section "document-types"
check_has_key doctypes "list"   "$NODE/spa/api/document-types" "0.name"
check_has_key doctypes "fields" "$NODE/spa/api/document-types" "0.fields.0.key"

# CRUD round-trip
DT_NEW=$(curl -sS -b "$COOKIES" -X POST "$NODE/spa/api/document-types" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Type","description":"auto-smoke","fields":[{"key":"x","label":"X","type":"text","required":false}]}')
DT_ID=$(echo "$DT_NEW" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$DT_ID" ]; then row doctypes "create" pass; else row doctypes "create" fail "$DT_NEW"; fi
if [ -n "$DT_ID" ]; then
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIES" \
    -X PATCH "$NODE/spa/api/document-types/$DT_ID" \
    -H 'Content-Type: application/json' -d '{"description":"updated"}')
  if [ "$CODE" = "200" ]; then row doctypes "patch" pass; else row doctypes "patch" fail "HTTP $CODE"; fi
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIES" \
    -X DELETE "$NODE/spa/api/document-types/$DT_ID")
  if [ "$CODE" = "200" ]; then row doctypes "delete" pass; else row doctypes "delete" fail "HTTP $CODE"; fi
fi

# --- 7. workflow-templates ------------------------------------------------

section "workflow-templates"
check_has_key templates "list"   "$NODE/spa/api/workflow-templates"   "0.name"
TPL_ID=$(curl -sS -b "$COOKIES" "$NODE/spa/api/workflow-templates" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")
if [ -n "$TPL_ID" ]; then
  check_has_key templates "get by id" "$NODE/spa/api/workflow-templates/$TPL_ID" "steps"
fi

# --- 8. alerts ------------------------------------------------------------

section "alerts"
check_has_key alerts "list" "$NODE/spa/api/alerts?limit=1" "0.id"

# --- 9. indexing ----------------------------------------------------------

section "indexing"
# Queue may legitimately be empty when every doc is fully indexed —
# 200 + JSON array is enough; stats endpoint covers the shape.
check_ok      indexing "queue"  "$NODE/spa/api/indexing?limit=1"
check_has_key indexing "stats"  "$NODE/spa/api/indexing/stats"   "low_confidence"

# --- 10. reports ----------------------------------------------------------

section "reports"
check_has_key reports "summary"         "$NODE/spa/api/reports/summary" "totals.all"
check_has_key reports "summary expiry"  "$NODE/spa/api/reports/summary" "expiry.d30"
check_has_key reports "summary workflows" "$NODE/spa/api/reports/summary" "workflows.pending"
CSV=$(curl -sS -b "$COOKIES" -o /tmp/nbe-smoke-csv -w "%{http_code},%{content_type}" \
  "$NODE/spa/api/reports/export.csv")
if [[ "$CSV" == 200* ]] && [[ "$CSV" == *text/csv* ]]; then
  row reports "CSV export" pass
else
  row reports "CSV export" fail "$CSV"
fi

# --- 11. compliance -------------------------------------------------------

section "compliance"
check_has_key compliance "summary expiry"      "$NODE/spa/api/compliance/summary" "expiry.overdue"
check_has_key compliance "summary retention"   "$NODE/spa/api/compliance/summary" "retention"
check_has_key compliance "summary workflow_sla" "$NODE/spa/api/compliance/summary" "workflow_sla"

# --- 12. integrations -----------------------------------------------------

section "integrations"
check_has_key integrations "list"     "$NODE/spa/api/integrations" "adapters.0.id"
check_has_key integrations "temenos"  "$NODE/spa/api/integrations" "adapters.0.name"

# --- 13. security ---------------------------------------------------------

section "security"
check_has_key security "rbac matrix"   "$NODE/spa/api/security/rbac" "matrix.0.role"
check_has_key security "permissions"   "$NODE/spa/api/security/rbac" "permissions"
check_ok      security "sessions list" "$NODE/spa/api/security/sessions"

# --- 14. users ------------------------------------------------------------

section "users"
check_has_key users "list" "$NODE/spa/api/users" "0.username"

# --- 15. admin ------------------------------------------------------------

section "admin"
check_has_key admin "health node"     "$NODE/spa/api/admin/health" "node.ok"
check_has_key admin "health python"   "$NODE/spa/api/admin/health" "python.ok"
check_has_key admin "health counts"   "$NODE/spa/api/admin/health" "counts.users"
check_ok      admin "audit log"       "$NODE/spa/api/admin/audit-log?limit=5"
# POST retention trigger (writes an audit row — idempotent)
CODE=$(curl -sS -o /dev/null -w "%{http_code}" -b "$COOKIES" \
  -X POST "$NODE/spa/api/admin/retention/trigger" -H 'Content-Type: application/json' -d '{}')
if [ "$CODE" = "200" ]; then row admin "retention trigger" pass
else                         row admin "retention trigger" fail "HTTP $CODE"
fi
# Bulk re-index. Allow enough time for OCR on a small corpus.
CODE=$(curl -sS -o /tmp/nbe-smoke-reindex -w '%{http_code}' -b "$COOKIES" --max-time 300 \
  -X POST "$NODE/spa/api/admin/docbrain/reindex-all" -H 'Content-Type: application/json' -d '{}')
if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then row admin "reindex all" pass
else                                    row admin "reindex all" fail "HTTP $CODE"
fi
rm -f /tmp/nbe-smoke-reindex

# --- 16. docbrain ---------------------------------------------------------

section "docbrain"
check_has_key docbrain "health" "$NODE/spa/api/docbrain/health" "status"

# Preview endpoint — send a 1-pixel PNG so OCR has *something* to chew.
# Ollama may hallucinate at this size; we only need the pipeline to return
# a valid shape, not a useful classification.
PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
TINY_PNG=$(mktemp -t nbe-smoke-tiny-XXXXXX.png)
printf '%s' "$PNG_BASE64" | base64 -d > "$TINY_PNG" 2>/dev/null
PREVIEW=$(curl -sS -b "$COOKIES" -o /tmp/nbe-smoke-preview -w '%{http_code}' \
  -F "file=@$TINY_PNG;type=image/png" \
  "$NODE/spa/api/docbrain/preview" --max-time 120 || echo "000")
if [[ "$PREVIEW" =~ ^2[0-9][0-9]$ ]]; then
  row docbrain "preview endpoint" pass
else
  row docbrain "preview endpoint" fail "HTTP $PREVIEW"
fi
rm -f "$TINY_PNG" /tmp/nbe-smoke-preview

# --- 17. ai (chat + persistence) ------------------------------------------

section "ai"
check_has_key ai "conversations list" "$NODE/spa/api/ai/conversations" ""

CONVO=$(curl -sS -b "$COOKIES" -X POST "$NODE/spa/api/ai/conversations" \
  -H 'Content-Type: application/json' -d '{"title":"smoke","scope_type":"all"}')
CONVO_ID=$(echo "$CONVO" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$CONVO_ID" ]; then row ai "create conversation" pass
else                        row ai "create conversation" fail "$CONVO"
fi

if [ -n "$CONVO_ID" ]; then
  check_has_key ai "get conversation" "$NODE/spa/api/ai/conversations/$CONVO_ID" "conversation.title"

  # Smoke the streaming endpoint — we just need the SSE body to start flowing
  # and contain at least one `data:` frame. Kill after ~8s so the test stays fast.
  SSE=$(curl -sS --max-time 15 -b "$COOKIES" -N -X POST "$NODE/spa/api/ai/chat/stream" \
    -H 'Content-Type: application/json' \
    -d "{\"conversation_id\": $CONVO_ID, \"question\": \"Hello, any passport records?\"}" \
    | head -c 2000 || true)
  if echo "$SSE" | grep -q '^data:'; then row ai "chat stream emits frames" pass
  else                                    row ai "chat stream emits frames" fail "no data: frame"
  fi

  # Agent endpoint — emits at least one data: frame (done / tool_call / error).
  AGENT_SSE=$(curl -sS --max-time 60 -b "$COOKIES" -N -X POST "$NODE/spa/api/ai/agent/stream" \
    -H 'Content-Type: application/json' \
    -d "{\"conversation_id\": $CONVO_ID, \"question\": \"How many valid documents?\"}" \
    | head -c 4000 || true)
  if echo "$AGENT_SSE" | grep -q '^data:'; then row ai "agent stream emits frames" pass
  else                                         row ai "agent stream emits frames" fail "no data: frame"
  fi

  # Clean up.
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" -b "$COOKIES" \
    -X DELETE "$NODE/spa/api/ai/conversations/$CONVO_ID")
  if [ "$CODE" = "200" ]; then row ai "delete conversation" pass
  else                         row ai "delete conversation" fail "HTTP $CODE"
  fi
fi

# --- 18. logout -----------------------------------------------------------

section "auth (teardown)"
CODE=$(curl -sS -o /dev/null -w "%{http_code}" -b "$COOKIES" \
  -X POST "$NODE/spa/api/logout" -H 'Content-Type: application/json' -d '{}')
if [ "$CODE" = "200" ]; then row auth "logout" pass
else                         row auth "logout" fail "HTTP $CODE"
fi

# --- summary --------------------------------------------------------------

TOTAL=$((PASS+FAIL))
echo
printf "Result: \033[1m%d passed, %d failed, %d total\033[0m\n" "$PASS" "$FAIL" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:"
  for d in "${FAIL_DETAILS[@]}"; do echo "  - $d"; done
  exit 1
fi
exit 0
