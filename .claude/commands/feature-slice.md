---
name: feature-slice
description: Spawn a 6-teammate agent team to ship one feature end-to-end at Fortune-500 quality — contract-first, module-per-folder, security gate, observability gate, accessibility gate. Argument is the feature name (e.g. `/feature-slice customer-notes`).
argument-hint: <feature-name>
---

Feature to ship: `$ARGUMENTS`

You are the **team lead**. Quality bar: Fortune-500 / Silicon Valley. Execute in three phases. Do not skip a phase to save time — phase ordering protects parallelism, not just rigour.

## Phase 0 — Architect (serial, ~10 min)

Before any code, before any contract, spawn the architect:

- `feature-architect` — task:
  > Read `docs/contracts/$ARGUMENTS.md` if it exists. If not, draft sections 1–3 (problem & user story, acceptance criteria, end-to-end workflow) by reading the codebase and the linked spec source. Output the draft to `docs/contracts/$ARGUMENTS.md` with `status = draft`. Flag risk class (`low / medium / high`). If `high`, also draft an ADR in `docs/adr/`.

Read the architect's output yourself before continuing. If acceptance criteria are vague or the workflow has gaps, fix them in the contract before Phase 1.

## Phase 1 — Contract first (serial, ~5 min)

Spawn **one** teammate:

- `python-engineer` — task:
  > Fill in `docs/contracts/$ARGUMENTS.md` sections 4 (Python routes), 5 (Node SPA mirror), 6 (SPA schemas), 7 (DB shape) and 8 (security & compliance). Match the wire shape exactly to the architect's workflow in §3. Do **not** write router code yet — publish the contract first so the rest of the team can work in parallel. Mark status = `in-progress` and commit the file.

Wait for the commit. Read the contract file end-to-end yourself. If anything is unbounded (missing pagination, missing auth, missing tenant scope), fix it in the contract before spawning Phase 2. **Section 8 (security) and Section 9 (perf budget) must be non-empty** — that's the Fortune-500 gate.

## Phase 2 — Parallel build (5 teammates)

Spawn these in parallel, each pointing at the published contract:

- `db-migrator` — task:
  > Per `docs/contracts/$ARGUMENTS.md` §7 (Data model), add the table to `db/schema.sql` (Node) using `addColumnIfMissing` for additive changes, generate an Alembic revision for the Python model, extend `db/seed.js` with ≥1 realistic row. If the contract flags any searchable columns, add them to `documents_fts` and update the `AFTER INSERT/UPDATE/DELETE` triggers in the same migration. Verify with a seed + FTS5 `MATCH` query. **Every table must have `tenant_id`** and a `(tenant_id, branch)` index.

- `python-engineer` — task:
  > Implement `python-service/app/routers/$ARGUMENTS.py` + `python-service/app/services/$ARGUMENTS.py` to match `docs/contracts/$ARGUMENTS.md` §4. Wire the router into `app/main.py` (imports block + `include_router`). Add `python-service/tests/test_$ARGUMENTS.py` covering list + create + every error branch in §11. Ship the observability contract from §9.2: trace span, two metrics (counter + histogram), structured log line. Keep `pytest -q` green.

- `node-engineer` — task:
  > Implement `routes/spa-api/$ARGUMENTS.js` to match `docs/contracts/$ARGUMENTS.md` §5. Mount it from `server.js`. Session-authenticate every route. Inject `X-API-Key` server-side when proxying to Python — never expose it to the browser. Enforce RBAC per the §8 matrix. Write to `audit_log` for every mutation. `node -c routes/spa-api/$ARGUMENTS.js` must parse cleanly.

- `spa-engineer` — task:
  > Build `apps/web/src/modules/$ARGUMENTS/{Page.tsx, api.ts, schemas.ts, components/}` against `docs/contracts/$ARGUMENTS.md` §6. Every fetch goes through `src/lib/http.ts` + a zod schema. Register the route in the SPA router. Wire the feature flag from §12. Implement every error state from §11. All strings via `t()`. Respect `prefers-reduced-motion`. Keep `npm run typecheck` green. Do not commit `as any` / `@ts-ignore`.

- `qa-engineer` — task:
  > Ship `apps/web/e2e/$ARGUMENTS.spec.ts` (one Playwright test per acceptance criterion in §2, with `test.describe` titles referencing AC IDs) + `apps/web/e2e/$ARGUMENTS.errors.spec.ts` (one test per row in §11) + extend `apps/web/e2e/a11y.spec.ts` with axe-core scan of the new page. Run the full Playwright suite (`npx playwright test --reporter=line`) to confirm no regressions. Add a smoke entry to `loadtest/k6.js` if the feature has a hot path.

## Phase 3 — Security & docs gate (serial)

When all five Phase 2 teammates report done, spawn two more in parallel:

- `security-reviewer` — task:
  > Read the diff against `main` and `docs/contracts/$ARGUMENTS.md` §8. Run the OWASP + banking threat model checklist. **Mandatory** for `risk = high`. Block merge on any high-severity finding; propose mitigations. Post findings to the shared task list.

- `docs-architect` — task:
  > Flip the contract status to `shipped`, add the changelog line in `docs/README.md`, and fold the new capability into `docs/ARCHITECTURE.md` (today) and remove it from `docs/ROADMAP.md`. If the contract changed any wire shape, sweep `docs/contracts/` for cross-references.

## Gate before marking shipped

All of these must be green:

```bash
cd python-service && pytest -q
cd apps/web && npm run typecheck
cd apps/web && npx playwright test e2e/$ARGUMENTS.spec.ts --reporter=line
cd apps/web && npx playwright test e2e/$ARGUMENTS.errors.spec.ts --reporter=line
cd apps/web && npx playwright test e2e/a11y.spec.ts --reporter=line
```

Plus the contract's §15 Definition of Done — every checkbox.

## House rules for this slice

- **Contract is the truth.** If reality drifts, fix the contract first, then everyone re-reads.
- **Module-per-feature is non-negotiable.** No dumping into shared route/router files.
- **Tenant boundary on every query.** Commandment #1.
- **Audit log on every mutation.** No exceptions. The auditor must be able to reconstruct any state change.
- **No two teammates edit the same file concurrently.** Sequence via task dependencies if needed.
- **No `as any`, no `@ts-ignore`, no `# type: ignore`.** Fix the type, don't escape it.
- **Feature flag default `off` for ≥ 1 release.** No "default on" merges.
- **No skipping the security-reviewer for `risk = high`.** Even if the team is tired.
- **Test must reference its AC.** A Playwright test without an `AC-N` in its title is a smell.
- **Performance budget is a budget.** A 50KB bundle bloat triggers a conversation, not a shrug.
