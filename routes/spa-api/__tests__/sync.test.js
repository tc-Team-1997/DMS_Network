/**
 * routes/spa-api/__tests__/sync.test.js
 *
 * Smoke tests for the offline-sync-queue backend (BHU-57).
 *
 * There is no Jest / Mocha dependency in the Node app — this file uses a
 * tiny inline harness and can be run directly:
 *
 *   node routes/spa-api/__tests__/sync.test.js
 *
 * Requires the server to be running (start.sh / npm start) for the curl
 * integration checks embedded at the bottom as comments.
 *
 * Run the syntax check gate first:
 *   node -c routes/spa-api/sync.js
 *   node -c services/idempotency.js
 */
'use strict';

// ---------------------------------------------------------------------------
// Inline micro-harness (no external deps).
// ---------------------------------------------------------------------------
let _pass = 0;
let _fail = 0;

function assert(desc, condition) {
  if (condition) {
    console.log(`  PASS  ${desc}`);
    _pass += 1;
  } else {
    console.error(`  FAIL  ${desc}`);
    _fail += 1;
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

function summary() {
  console.log(`\n${_pass} passed, ${_fail} failed`);
  if (_fail > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Unit tests for services/idempotency.js
// ---------------------------------------------------------------------------
describe('services/idempotency — sha256', () => {
  const { sha256 } = require('../../../services/idempotency');

  assert('same input → same hash', sha256({ a: 1 }) === sha256({ a: 1 }));
  assert('different input → different hash', sha256({ a: 1 }) !== sha256({ a: 2 }));
  assert('string input works', typeof sha256('hello') === 'string' && sha256('hello').length === 64);
  assert('null input does not throw', (() => { try { sha256(null); return true; } catch { return false; } })());
});

describe('services/idempotency — pruneExpired (no-op on empty test DB)', () => {
  // We cannot import idempotency.js cleanly in a test without the DB existing,
  // so we just verify the export shape via require.
  const idem = require('../../../services/idempotency');
  assert('exports getIdempotency',   typeof idem.getIdempotency   === 'function');
  assert('exports storeIdempotency', typeof idem.storeIdempotency === 'function');
  assert('exports pruneExpired',     typeof idem.pruneExpired     === 'function');
  assert('exports sha256',           typeof idem.sha256           === 'function');
});

describe('routes/spa-api/sync — syntax + exports', () => {
  const syncRouter = require('../sync');
  assert('exports an Express Router', typeof syncRouter === 'function' && syncRouter.name === 'router');
});

// ---------------------------------------------------------------------------
// Manual curl smoke-test scripts (kept as reference, not executed here).
// ---------------------------------------------------------------------------
/*
  Prerequisites:
    1.  npm start   (or ./start.sh)
    2.  Log in and get the session cookie:

      SESSION=$(curl -s -c /tmp/dms-cookie.txt -d "username=sara&password=sara123" \
        http://localhost:3000/login -L -o /dev/null -w "%{url_effective}") && echo $SESSION

  ── Test A: replay with a fresh idempotency key (should return accepted) ──

    KEY=$(node -e "console.log(require('crypto').randomUUID())")

    curl -s -b /tmp/dms-cookie.txt \
      -X POST http://localhost:3000/spa/api/sync/replay \
      -H "Content-Type: application/json" \
      -d "{
        \"outbox_entries\": [{
          \"idempotency_key\": \"$KEY\",
          \"payload\": {
            \"original_name\": \"offline-test.pdf\",
            \"doc_type\": \"Other\",
            \"notes\": \"offline smoke test\"
          }
        }]
      }" | python3 -m json.tool

    # Expected: { "accepted": [{"idempotency_key": "$KEY", "document_id": N}], "deduped": [], "failed": [] }

  ── Test B: replay the same key again (should return deduped) ──

    curl -s -b /tmp/dms-cookie.txt \
      -X POST http://localhost:3000/spa/api/sync/replay \
      -H "Content-Type: application/json" \
      -d "{
        \"outbox_entries\": [{
          \"idempotency_key\": \"$KEY\",
          \"payload\": {
            \"original_name\": \"offline-test.pdf\",
            \"doc_type\": \"Other\",
            \"notes\": \"offline smoke test\"
          }
        }]
      }" | python3 -m json.tool

    # Expected: { "accepted": [], "deduped": [{"idempotency_key": "$KEY", ...}], "failed": [] }

  ── Test C: GET /spa/api/sync/status ──

    curl -s -b /tmp/dms-cookie.txt \
      http://localhost:3000/spa/api/sync/status | python3 -m json.tool

    # Expected: { "replayed": N, "deduped": M, "failed_count": 0, "last_sync_at": "..." }

  ── Test D: 409 conflict — same key, different payload ──

    curl -s -b /tmp/dms-cookie.txt \
      -X POST http://localhost:3000/spa/api/sync/replay \
      -H "Content-Type: application/json" \
      -d "{
        \"outbox_entries\": [{
          \"idempotency_key\": \"$KEY\",
          \"payload\": {
            \"original_name\": \"DIFFERENT-NAME.pdf\",
            \"doc_type\": \"Other\",
            \"notes\": \"this is a DIFFERENT payload\"
          }
        }]
      }" | python3 -m json.tool

    # Expected: { "accepted": [], "deduped": [], "failed": [{"error": "idempotency_conflict", ...}] }

  ── Test E: Idempotency-Key header on POST /spa/api/documents (requires file) ──

    KEY2=$(node -e "console.log(require('crypto').randomUUID())")

    curl -s -b /tmp/dms-cookie.txt \
      -X POST http://localhost:3000/spa/api/documents \
      -H "Idempotency-Key: $KEY2" \
      -F "file=@/tmp/test.pdf;type=application/pdf" \
      -F "doc_type=Other" \
      -F "notes=idempotency header test" | python3 -m json.tool

    # Expected: { "ok": true, "id": N, ... }
    # Repeat same curl → same response (from cache), no duplicate row inserted.
*/

summary();
