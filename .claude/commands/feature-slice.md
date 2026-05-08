---
name: feature-slice
description: Spawn a 5-teammate agent team to ship one feature end-to-end — contract-first, module-per-folder, no OPA / security gate. Argument is the feature name (e.g. `/feature-slice customer-notes`).
argument-hint: <feature-name>
---

Feature to ship: `$ARGUMENTS`

You are the **team lead** for this slice. Execute in two phases.

## Phase 1 — Contract first (serial, ~5 min)

Spawn **one** teammate only:

- `python-engineer` — task:
  > Create `docs/contracts/$ARGUMENTS.md` from `docs/contracts/_template.md`. Fill in the Python route shapes (list / get / create / update), the DB shape (columns, indices, whether it needs FTS5), the SPA zod schemas (copy-pasteable TS), and the test checklist. Do **not** write router code yet — publish the contract first so the rest of the team can work in parallel. Mark status = `in-progress` and commit the file.

Wait for that commit to land. Read the contract file yourself before starting Phase 2 — if anything looks wrong (unbounded lists, missing auth, missing branch scope), fix it in the contract before spawning the rest of the team.

## Phase 2 — Parallel build (4 teammates)

Spawn these four in parallel, each pointing at the published contract:

- `db-migrator` — task:
  > Per `docs/contracts/$ARGUMENTS.md` §4 (DB shape), add the table to `db/schema.sql` (Node), generate an Alembic revision for the Python model, extend `db/seed.js` with ≥1 realistic row. If the contract flags any searchable columns, add them to `documents_fts` and update the `AFTER INSERT/UPDATE/DELETE` triggers in the same migration. Verify with a seed + FTS5 `MATCH` query.

- `python-engineer` — task:
  > Implement `python-service/app/routers/$ARGUMENTS.py` + `python-service/app/services/$ARGUMENTS.py` to match `docs/contracts/$ARGUMENTS.md` §1. Wire the router into `app/main.py` (imports block + `include_router`). Add `python-service/tests/test_$ARGUMENTS.py` covering list + create + one error path. Keep `pytest -q` green.

- `node-engineer` — task:
  > Implement `routes/spa-api/$ARGUMENTS.js` to match `docs/contracts/$ARGUMENTS.md` §2. Mount it from `server.js`. Session-authenticate every route. Inject `X-API-Key` server-side when proxying to Python. `node -c routes/spa-api/$ARGUMENTS.js` must parse cleanly.

- `spa-engineer` — task:
  > Build `apps/web/src/modules/$ARGUMENTS/{Page.tsx, api.ts, schemas.ts}` against `docs/contracts/$ARGUMENTS.md` §3. Every fetch goes through `src/lib/http.ts` + a zod schema. Register the route in the SPA router. Keep `npm run typecheck` green. Do not commit any `as any` / `@ts-ignore`.

When all four report done, spawn the fifth:

- `qa-engineer` — task:
  > Ship `apps/web/e2e/$ARGUMENTS.spec.ts` (happy path against real stack — do not mock) + `apps/web/e2e/$ARGUMENTS.errors.spec.ts` (mocked error states). Run the full Playwright suite (`npx playwright test --reporter=line`) to confirm no regressions.

## Gate before marking shipped

All three green:

```bash
cd python-service && pytest -q
cd apps/web && npm run typecheck
cd apps/web && npx playwright test e2e/$ARGUMENTS.spec.ts --reporter=line
```

Then:

- Ask `docs-architect` to flip the contract status to `shipped` and add the changelog line in `docs/README.md`.
- Clean up the team.

## House rules for this slice

- **No OPA edits.** MVP speed — OPA is deferred. Role checks in `services/auth.py` are sufficient.
- **No security-reviewer spawn.** Re-enable pre-prod.
- **No two teammates edit the same file.** If two need it, sequence them via task dependencies.
- **If the contract is wrong, fix the contract — don't paper over it in code.** Everyone re-reads after an edit.
- **Module-per-feature is non-negotiable.** No dumping into `routes/spa-api.js` or `app/routers/shared.py`.
