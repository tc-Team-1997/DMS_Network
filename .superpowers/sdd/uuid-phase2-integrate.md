# UUID Phase 2 Integration Report
**Branch:** amit_local  
**Date:** 2026-06-25  
**Scope:** All packages + services EXCEPT `@zordms/web` (frontend — Phase 3)

---

## Build Results (`pnpm -r --filter='!@zordms/web' build`)

| Package | Status | Notes |
|---|---|---|
| `@zordms/config` | PASS | tsc clean |
| `@zordms/types` | PASS | tsc clean |
| `@zordms/db` | PASS | tsc clean; `newId` (uuidv7) exported |
| `@zordms/auth` | PASS | tsc clean |
| `@zordms/gateway` | PASS | tsc clean |
| `@zordms/core` | PASS | tsc clean |
| `@zordms/integration` | PASS | tsc clean |
| `@zordms/notify` | PASS | tsc clean |
| `@zordms/search` | PASS | tsc clean |
| `@zordms/workflow` | PASS | tsc clean |

**All 10 packages built successfully.**

---

## Test Results (`pnpm -r --filter='!@zordms/web' test`)

| Package | Test Files | Tests | Status |
|---|---|---|---|
| `@zordms/config` | 1 | 3 | PASS |
| `@zordms/types` | 1 | 2 | PASS |
| `@zordms/db` | 3 | 9 | PASS |
| `@zordms/auth` | 5 | 24 | PASS |
| `@zordms/gateway` | 5 | 20 | PASS |
| `@zordms/core` | 25 | 126 | PASS |
| `@zordms/integration` | 15 | 49 | PASS |
| `@zordms/notify` | 17 | 47 | PASS |
| `@zordms/search` | 11 | 54 | PASS |
| `@zordms/workflow` | 11 | 51 | PASS |

**Total: 94 test files, 385 tests — all PASS.**

---

## Trivial Fixes Applied

None required — the UUID migration was already coherent across all services. All primary keys use `string(36)` (UUIDv7 format), all foreign key references use `string(36)`, and `newId()` from `@zordms/db` is imported correctly in every service that generates IDs.

---

## Observed Warnings (non-fatal, tests still pass)

- **`@zordms/notify` / `consumer.test.ts`** — stderr line: `deps.knex is not a function` in the "I2: consumer swallows a DB error" test case. The test itself **passes** (the consumer correctly swallows the error and does not propagate the rejection). This is a test-fixture intentional error used to verify error-swallowing behavior — not a UUID issue.

- **`@zordms/integration` / `defects.test.ts`** — stderr line: `[test] crash handler: Error: simulated_db_crash`. This is an intentional error injected by the defects test suite to verify the global 500-error handler. All 16 defect tests pass.

---

## Services Still Failing

**None.** All services build and test cleanly after the UUID migration.

---

## Commit & Push

```
feat(db): migrate all service databases to UUIDv7 string primary keys (phase 2/3)
```

- Staged: `services/` and `packages/` (all modified files)
- Committed to branch: `amit_local`
- Pushed to: `origin/amit_local`

---

## Phase 3 Remaining Work (Frontend)

`apps/web` (`@zordms/web`) was intentionally excluded from this phase. The frontend still uses numeric IDs in its API calls and state. Phase 3 should:

1. Update all `fetch`/`axios` calls that pass or receive `id` as `number` to accept `string`
2. Update TypeScript types in the web app (any `id: number` → `id: string`)
3. Remove any `parseInt` / `Number(id)` coercions on IDs received from the API
4. Verify UI components that display or route on document/folder/user IDs
