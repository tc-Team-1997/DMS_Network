# Wave E1 — Allocation Matrix (parallel-execution lockfile)

> **For all three plans (Plan 1, Plan 2, Plan 3) running in parallel worktrees, this matrix is binding.** Subagents may only touch what their column lists. Anything not in the matrix needs a lead update before edits.

**Date:** 2026-05-10
**Base:** Plan 0 merged into main at `3acf53d`. Each plan branches from that point.
**Three parallel worktrees:**
- `worktree-wave-e1-plan3-compliance-flagships` ← biggest customer-blocking gaps (DSAR, RMA, audit chain banner, DocBrain v2, Search v2)
- `worktree-wave-e1-plan2-admin-onboarding` ← Login v2, MFA, Indexing, AML decide, Learn Wizard, Customer-360, Templates, Mobile
- `worktree-wave-e1-plan1-operational-polish` ← Dashboard, Workflows filters, Viewer multi-page redaction, Capture revert-to-AI

---

## 1. Migration numbers (one assigner per plan; never re-use)

Last shipped on main: migration **0040** (Plan 0 — `audit_log.policy_decision` + `users.reset_token`).

| Plan 3 (compliance) | Plan 2 (admin) | Plan 1 (operational) |
|---|---|---|
| 0041 — `dsar_requests` table + `dsar_artifacts` join | 0043 — `mfa_factors` table + `users.mfa_factor_default` | 0045 — `redaction_pages` composite-PK migration finalisation |
| 0042 — `regulator_templates.country_code = 'BT'` row + `regulator_submissions` audit table | 0044 — `tenant_calendars (tenant_id, holiday_date, label)` | 0046 — `dashboard_kpi_views (user_id, view_json)` |

If a plan needs a third migration, claim 0047/0048/0049 in the matrix update before adding.

## 2. RBAC permission keys (parity required: `services/rbac.js` + `python-service/app/services/auth.py`)

| Plan 3 | Plan 2 | Plan 1 |
|---|---|---|
| `dsar:read` | `mfa:enroll` | `redaction:multipage` |
| `dsar:fulfill` | `mfa:reset` | `dashboard:custom_view` |
| `regulator:export` | `sod:override` | `viewer:annotate_persist` |
| `regulator:submit` | `calendar:edit` | (workflows filter additions reuse existing `workflow` perm) |
| `audit:chain_view` | `sso:test` | |
| `audit:export_signed` | `users:invite_send` | |

Adding any new key requires updating **both** files in the same PR. The merge-guard from Plan 0 (services/audit-policy.js helper) is the precedent — every plan now has the buildPolicyDecision helper available.

## 3. App.tsx routes (only one plan adds new `<Route>` per route path)

| Plan 3 | Plan 2 | Plan 1 |
|---|---|---|
| `/dsar` (NEW) | `/users` (extends — adds tabs) | (no new routes — modifies existing `/dashboard`, `/workflows`, `/viewer`, `/capture` content only) |
| `/regulator-reports` (extends — adds RMA detail) | `/aml` (extends — Hit Decide modal route) | |
| `/audit` (extends — adds chain-verify banner) | `/indexing` (extends) | |
| `/docbrain` (refactors to v2 3-pane shell) | `/document-types/learn/:id` (extends — inline versioning) | |
| `/search/v2` (NEW route) | `/customers/:cid` (extends — full Customer 360) | |
| | `/workflow-templates/:id` (extends — BoB calendar) | |

For every new lazy() import in App.tsx: import block at the top is alphabetised; each plan inserts in its own place. Conflicts on the import block resolved by re-sorting at merge time.

## 4. i18n namespaces (one owner per top-level key)

| Plan 3 owns | Plan 2 owns | Plan 1 owns |
|---|---|---|
| `dsar.*` | `auth.sso.*` | `dashboard.kpi.*` |
| `regulator.*` (extends, adds `regulator.rma.*`) | `auth.mfa.*` | `workflows.filter.amount.*` |
| `audit.banner.*` | `users.invite.*` | `workflows.filter.date.*` |
| `audit.chain.*` | `indexing.kbd.*` | `viewer.redaction.*` |
| `docbrain.v2.*` | `aml.decide.*` | `viewer.sign.*` |
| `search.v2.*` | `doctypes.versioning.*` | `capture.revert.*` |
| `search.facets.*` | `calendar.bob.*` | |
| | `mobile.*` | |

dz.json: each plan ships real Tibetan translations OR `[DZ-PENDING] <english>` markers. The Plan 0 `npm run i18n:check` script enforces parity.

## 5. Backend route mounts (`routes/spa-api.js` dispatcher)

| Plan 3 mounts | Plan 2 mounts | Plan 1 mounts |
|---|---|---|
| `routes/spa-api/dsar.js` | `routes/spa-api/mfa-management.js` | (no new mounts — extends existing `workflows.js`, `documents.js` for filter+redaction) |
| `routes/spa-api/regulator-rma.js` (or extends `regulator.js`) | `routes/spa-api/saml-test.js` | |
| `routes/spa-api/docbrain-v2.js` (or extends `docbrain.js`) | `routes/spa-api/calendars.js` | |
| `routes/spa-api/search-v2.js` (or extends `search.js`) | | |

Each plan inserts its `router.use(...)` line in its own block in `routes/spa-api.js`. Conflicts resolved by section ordering at merge time.

## 6. Audit action keys (allow-list owned by `routes/spa-api/audit-events.js` + each plan adds its own)

| Plan 3 | Plan 2 | Plan 1 |
|---|---|---|
| `dsar.lookup` | `mfa.enroll_start` | `redaction.commit_multipage` |
| `dsar.fulfill` | `mfa.enroll_finish` | `dashboard.kpi_save_view` |
| `regulator.report_export` | `mfa.reset` | `viewer.override_applied` |
| `regulator.report_submit` | `sod.violation_override` | |
| `audit.chain_verify` | `sso.test_run` | |
| | `calendar.holiday_add` | |

Each plan extends the SPA_AUDIT_ACTIONS Set in `routes/spa-api/audit-events.js`. Conflicts resolved by entry sorting at merge time.

## 7. Shared backend files — sequential edits only at merge time

These files will be touched by all three plans. **No plan edits these in their worktree.** Instead, each plan's postmortem lists the additions needed; lead applies them at merge time:

- `services/rbac.js` — RBAC additions (all plans)
- `python-service/app/services/auth.py` — RBAC parity (all plans)
- `routes/spa-api.js` — router mounts (Plans 2, 3)
- `routes/spa-api/audit-events.js` — allow-list additions (all plans)
- `apps/web/src/App.tsx` — route additions (Plans 2, 3)
- `apps/web/src/components/layout/nav.ts` — sidebar nav additions

**Process per plan:** in the implementer's report, list the lines to add to each shared file. Lead consolidates and commits to main BEFORE merging the plan.

## 8. Conflict-resolution priority (when merging back)

Order of merges back to main:
1. **Plan 3 first** — biggest, most regulator-relevant; gets the cleanest merge.
2. **Plan 2 second** — rebase onto new main, run `npm run i18n:check` + axe-core, then merge.
3. **Plan 1 last** — rebase onto new main, full Playwright sweep, then merge.

If a Plan-3-shared-file edit conflicts with Plan 2 or Plan 1, Plan 3 wins (it's bigger). The losing plan rebases.

## 9. Per-plan Wave-E DoD checklist (what each plan must satisfy before merge)

Each plan's postmortem must show ✅ on all of:

1. App.tsx route grep — every claimed UI surface is routed
2. Orphan-table grep — every new table has at least one route reading it
3. RBAC keys parity — additions in BOTH rbac.js and auth.py (lead applies these at merge time per §7)
4. Migration consumer — every new column/table read by a route in same PR
5. dz.json non-identical — `npm run i18n:check` exits 0
6. audit_log policy_decision — every new mutation writes through writeAuditRow + buildPolicyDecision
7. Playwright + pytest green
8. axe-core 0 critical/serious on every route the plan touches
9. PII reveal events emit `pii_reveal` audit event (if applicable)
10. Postmortem file:line evidence is real (final reviewer verifies)

## 10. What you do NOT do in any plan

- Edit `services/rbac.js` or `python-service/app/services/auth.py` directly — list additions in postmortem; lead merges them.
- Edit `routes/spa-api.js` dispatcher — list additions in postmortem.
- Edit `apps/web/src/App.tsx` outside your column — Plans 2 and 3 add routes; Plan 1 must not.
- Touch i18n namespaces outside your column — strictly enforced.
- Land migrations outside your number range — claim more numbers in the matrix first.

If you need to break the matrix, STOP and escalate to the lead. The lead updates the matrix and commits the update before any plan resumes.

---

**Status:** Allocation matrix locked at this commit. Plans 1/2/3 may now branch and work in parallel.
