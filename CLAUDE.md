# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout (multi-service monorepo)

This is the National Bank of Egypt Document Management System. Four independent deployables live in one repo:

- **Node.js Express app** (root) — the original web UI + primary HTTP surface. Entry: [server.js](server.js). EJS views in [views/](views/), per-module routers in [routes/](routes/), cross-cutting logic in [services/](services/), SQLite via `better-sqlite3` in [db/](db/).
- **Python FastAPI microservice** ([python-service/](python-service/)) — the "real" backend implementing the architecture in `DMS Architecture.pdf`: document service, OCR, workflow engine, search, integrations, duplicate detection, plus a large surface of compliance/risk/AI routers. Entry: [python-service/app/main.py](python-service/app/main.py). SQLAlchemy + Alembic, async engine auto-initialized when an async driver is installed.
- **Playwright E2E** ([e2e/](e2e/)) — targets the **Python service** by default (`E2E_BASE_URL=http://localhost:8000`), not Node. Five projects: chromium-ltr, chromium-rtl (Arabic locale), firefox, webkit, mobile (Pixel 7).
- **Expo/React Native mobile** ([mobile/](mobile/)) — branch-officer capture app that talks to the Python service's `/api/v1/*` endpoints (JWT auth, not API key).

Supporting pieces: [opa/policies/dms.rego](opa/policies/dms.rego) (ABAC policy), [loadtest/k6.js](loadtest/k6.js) (load test against Python service), [.github/workflows/](.github/workflows/) (CI, multicloud, release, supply-chain).

## Running locally

**Node app** (port 3000):
```bash
npm install
node db/seed.js      # creates db/nbe-dms.db with seed users/docs
npm start            # or `npm run dev` for nodemon
```
Seed logins: `admin/admin123` (Doc Admin), `sara/sara123` (Maker), `mohamed/mohamed123` (Checker), `nour/nour123` (Viewer, Locked).

**Python service** (port 8000):
```bash
cd python-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # pinned
# or requirements-local.txt for Python 3.13+ without wheel-build issues
cp .env.example .env                   # set API_KEY, JWT_SECRET, DATABASE_URL
uvicorn app.main:app --reload --port 8000
```
Swagger at `/docs`, UI at `/`. Default API key header: `X-API-Key: dev-key-change-me`.

**Both services together**: Node proxies to Python via [routes/py-proxy.js](routes/py-proxy.js) mounted at `/py`. Configure with `PYTHON_SERVICE_URL` and `PYTHON_SERVICE_KEY`. Both default to port 8000 independently — run Python on a different port if you need them side-by-side.

**Docker**: `docker compose up --build` starts the Node app only. The Python service has its own [python-service/docker-compose.yml](python-service/docker-compose.yml).

## Testing

```bash
# Python unit/integration tests
cd python-service && pytest -q
pytest tests/test_api.py::test_upload_and_list -q   # single test

# E2E (needs Python service running on :8000)
cd e2e
npm install
npx playwright install --with-deps chromium firefox
npx playwright test                                   # all projects
npx playwright test --project=chromium-ltr            # one project
npx playwright test tests/api.spec.ts                 # one file

# Load test
k6 run --vus 50 --duration 2m loadtest/k6.js
```

There is **no JavaScript test suite** for the Node app — CI only runs `node -c routes/py-proxy.js` as a syntax check. Alembic migrations: `alembic upgrade head` from `python-service/`.

## Architecture — how the pieces talk

**Two parallel auth schemes, do not confuse them:**

- Node app uses **session cookies** for browser users (`express-session`, login via `POST /login`) and **`x-api-key` per-user** for its `/api/v1/*` surface ([routes/api.js](routes/api.js)). The key is stored on the `users.api_key` column.
- Python service uses **a single shared `X-API-Key`** from settings ([python-service/app/security.py](python-service/app/security.py)) for all `/api/v1/*`, AND **JWT** (HS256) for user-scoped flows with tenant+branch+roles claims ([python-service/app/services/auth.py](python-service/app/services/auth.py)). The mobile app uses JWT; `X-API-Key` is the gateway check.

**RBAC lives in two places and must stay in sync:**
- Node: [services/rbac.js](services/rbac.js) — roles `Doc Admin / Maker / Checker / Viewer`.
- Python: [python-service/app/services/auth.py](python-service/app/services/auth.py) — roles `doc_admin / maker / checker / viewer / auditor` (lowercase, plus `auditor`).
- OPA ABAC policy layers tenant, branch, risk-band, and after-hours checks on top: [opa/policies/dms.rego](opa/policies/dms.rego).

**Storage models differ:**
- Node stores files under `uploads/` (gitignored) with filenames in the DB row.
- Python uses **SHA-256 content-addressed storage** under `STORAGE_DIR`; duplicate detection uses SHA-256 + pHash + fuzzy. Dedup is a core invariant — [python-service/app/services/storage.py](python-service/app/services/storage.py) and [services/duplicates.py](python-service/app/services/duplicates.py).

**Full-text search** is an FTS5 virtual table `documents_fts` in the Node schema ([db/schema.sql](db/schema.sql)), kept in sync by `AFTER INSERT/UPDATE/DELETE` triggers over `documents.original_name, customer_name, customer_cid, doc_number, ocr_text, notes`. The Python service uses its own SQL full-text index in [python-service/app/services/search_backend.py](python-service/app/services/search_backend.py).

**Node server wiring** ([server.js](server.js)): route order matters — `/api/v1`, `/py`, `/graphql`, `/webhooks`, `/portal` are mounted **before** the `requireAuth` middleware; everything else (`/`, `/documents`, `/workflows`, etc.) sits behind session auth. SAML is initialized via `services/saml.configure(app)` and two cron-like jobs start on boot: `expiry-job` and `retention`. A WebSocket server from [services/ws.js](services/ws.js) attaches to the same HTTP server.

**Python main.py** imports ~60 routers. When adding a router, include it in both the import block and an `app.include_router(...)` line. Middleware order: CORS → Prometheus metrics → WAF → Carbon → Usage → (optional) Failpoint. Tasks use a worker pool started by `services.tasks.start_workers`; task handlers register themselves via module import side-effects in `services/task_handlers.py`.

## Database conventions

- **Node SQLite**: schema in [db/schema.sql](db/schema.sql), seeded via `node db/seed.js`. Passwords are bcrypt; WAL journal mode is enabled in [db/index.js](db/index.js). The DB file `db/nbe-dms.db` is gitignored — delete it and re-seed to reset state.
- **Python SQLAlchemy**: models in [python-service/app/models.py](python-service/app/models.py). `DATABASE_URL` swaps SQLite ↔ Postgres; pool settings come from env (`DB_POOL_SIZE`, etc.). When you edit models, generate a migration: `alembic revision --autogenerate -m "…" && alembic upgrade head`.

## CI gates

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs: `python -m compileall` (lint), `pytest`, `terraform fmt -check && validate`, `helm lint python-service/helm/nbe-dms`, and Playwright E2E (chromium-ltr + chromium-rtl) against a live uvicorn on port 8000. Tesseract and poppler are apt-installed in CI — local runs need them too for OCR tests (see `TESSERACT_CMD` / `POPPLER_PATH` in [python-service/app/config.py](python-service/app/config.py)).

## Agent teams

This repo is set up for [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams). The experimental flag is already on in [.claude/settings.json](.claude/settings.json) (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"`).

Eight reusable teammate roles are defined in [.claude/agents/](.claude/agents/). Spawn any combination by name — each ships with its own non-negotiables, coordination rules, and test gates:

| Agent | Owns | Use when |
|---|---|---|
| `spa-engineer` | `apps/web/` | New SPA module / component / zod-validated endpoint call |
| `node-engineer` | `server.js`, `routes/`, `services/`, `db/` | New `/spa/api/*` endpoint, RBAC change, FTS5 column, proxy |
| `python-engineer` | `python-service/` | New FastAPI router, service, Alembic migration, background task |
| `docbrain-ai-engineer` | `python-service/app/services/docbrain/`, `routers/docbrain.py` | OCR, classify, extract, embed, vector search, RAG work |
| `integrations-engineer` | `python-service/app/services/integrations/` | CBS / CRM adapter (Temenos, FLEXCUBE, Finastra, …) |
| `db-migrator` | `db/schema.sql`, `python-service/migrations/` | Schema change, FTS5 trigger sync, Postgres migration |
| `qa-engineer` | `apps/web/e2e/`, `python-service/tests/` | New Playwright spec, pytest, flake hunt |
| `security-reviewer` | (read-only) | Review a diff against OWASP + banking threat model |
| `docs-architect` | `docs/` | Update strategic + technical docs, maintain changelog |

### Spawn templates — paste one into the lead session

**Parallel M2 build (SPA + Node + Python + DB + QA, bounded):**
```
Create an agent team of 5 teammates to ship M2 Workflows end to end:
- node-engineer: add /spa/api/workflows/* endpoints (list, advance, reject, escalate, approve) with RBAC perm "workflow"
- python-engineer: expose /api/v1/workflows/* for BPMN step execution
- db-migrator: add workflow_instances + workflow_steps tables + seed
- spa-engineer: build src/modules/workflows/WorkflowsPage.tsx with the Maker/Checker/Admin views
- qa-engineer: extend e2e with workflows.spec.ts covering each RBAC path
Require plan approval before any teammate starts writing code. Only approve plans that include a zod schema for every new endpoint and at least one Playwright spec per surface.
```

**Parallel code review (3 reviewers, read-only):**
```
Create a review team of 3 teammates for the current diff on branch feat/workflows:
- security-reviewer: full OWASP + banking threat model sweep
- qa-engineer: verify Playwright + pytest coverage is adequate and specs are deterministic
- docs-architect: check docs are updated and links resolve
Have them post findings to the shared task list. Synthesise a single go/no-go verdict when all three finish.
```

**Integrations surge (5 adapters in parallel):**
```
Create an agent team of 5 teammates, all using the integrations-engineer subagent type, to ship 5 CBS adapters in parallel:
- teammate temenos:       python-service/app/services/integrations/temenos_t24.py
- teammate flexcube:      python-service/app/services/integrations/flexcube.py
- teammate finastra:      python-service/app/services/integrations/finastra_fusion.py
- teammate mambu:         python-service/app/services/integrations/mambu.py
- teammate thought:       python-service/app/services/integrations/thought_machine.py
Each must implement the Adapter Protocol exactly, ship a mock subclass, ship a contract test, and never share state with another tenant. When all finish, have docs-architect update INTEGRATION_STRATEGY.md §3 (capability matrix).
```

**Debugging with competing hypotheses (when a bug's root cause is unclear):**
```
Users report <symptom>. Create a team of 4 investigators, each with a different
hypothesis, and have them message each other to disprove each other's theories.
Update docs/INCIDENT_<date>.md with the surviving explanation once consensus emerges.
Reviewers: do NOT edit production code — only read.
```

### House rules for the team lead

- **Require plan approval for any teammate touching `db/schema.sql`, `python-service/migrations/`, or `services/rbac.js`.** These are high-blast-radius surfaces.
- **Never let two teammates edit the same file concurrently.** If two agents need the same file, sequence them via task dependencies.
- **Before `clean up the team`**, confirm `npm run typecheck`, `npx playwright test`, and `pytest -q` are all green.
- **Display mode:** iTerm2 + `it2` CLI → auto split-panes; anything else → in-process (Shift+Down to cycle).
- **Don't resume agent-team sessions via `/resume`**; in-process teammates don't restore. Re-spawn them.

## Definition of Done — Wave-E standard (binding for every shipment from 2026-05-10)

The Wave-E re-review (`docs/UI_UX_REVIEW.md` + `DocManager-Fortune50-Mockup.html` × 7 Fortune-50 reviewers) found the dominant failure mode in Waves A–D was **partial-stack delivery** — UI present but no backend, backend present but no UI, schema seeded but no route ever queries it. From now on, no slice is "shipped" unless the four layers are wired end-to-end:

1. **DB layer.** Every new column / table lands via a migration that runs on a fresh clone (`db/schema.sql` + Alembic for Python). `db-migrator` runs the verify-after-write protocol. **Tables that are seeded but never read are forbidden** — see `folder_perms` precedent under "RBAC reality" below.
2. **Backend layer.** Every new domain has a router file (`routes/spa-api/<feature>.js` or `python-service/app/routers/<feature>.py`) wired to RBAC (`requirePermJson` / `require_role`) and to the DB rows added in step 1. Branch-scope check at `routes/spa-api/_shared.js:78-82` applies for non-admin reads.
3. **UI layer.** Every promised mockup screen has a routed page in `apps/web/src/App.tsx` (no orphan modules), every fetch goes through `lib/http.ts` with a zod schema, every user-visible string flows through `t()`, and every interactive element is keyboard- and screen-reader-accessible (WCAG 2.1 AA).
4. **Verification layer.** `cd apps/web && npm run typecheck && npx playwright test` green AND `cd python-service && pytest -q` green AND `node -c` parses every changed Node route. Per feature: one happy-path Playwright spec against the real stack + at least one mocked-error spec.

**Hard checks before "done"** (lead does not accept the slice without these):

- `grep -r '<feature_table_name>' routes/ python-service/app/routers/` returns ≥1 hit. *(folder_perms-class regression check.)*
- `grep -rh 'data-testid=' apps/web/src/modules/<feature>/ | sort -u` matches `docs/contracts/<feature>.md` §6.4.
- Every new endpoint is reachable from a routed UI surface in `apps/web/src/App.tsx`. No "backend ready but no DSARPage" repeats.
- Every new permission key is in **both** `services/rbac.js` AND `python-service/app/services/auth.py`. RBAC drift is a P0 bug.
- New user-visible strings exist in **both** `apps/web/src/i18n/en.json` AND `apps/web/src/i18n/dz.json` with real Tibetan-script translations (not English placeholders). The dz.json byte-identical-to-en regression is a release-blocker.
- Audit-relevant actions write to `audit_log` with `policy_decision` populated (OPA decision + role + branch + risk_band JSON blob). PII reveals call `POST /spa/api/audit/events` with `action='pii_reveal'`.

When a slice cannot finish all four layers in the same PR, split the work into a `feat/<feature>-backend` PR and a `feat/<feature>-ui` PR with a tracking issue — but **the feature is not announced shipped** until the UI PR lands and the four hard checks pass. No more "Wave B claimed shipped but DSARPage doesn't exist."

## RBAC reality (verified 2026-05-10)

Use this section as ground truth when reasoning about authorization. The earlier marketing-grade summaries diverge from the code in three places.

### Where enforcement actually lives
- **Node permission bundles** — `services/rbac.js:1-34` ships 6 fixed roles with bundled permission strings:

| Role | Notable bundle |
|---|---|
| `Doc Admin` | capture, index, approve, reject, delete, admin, view_unredacted, worm:admin, kyc:read/write, regulator_reports:admin |
| `Maker` | capture, index, upload, view, workflow, aml:read, cbs:read/write, kyc:write, translate:read |
| `Checker` | approve, reject, view, workflow, aml:read, cbs:read/write, documents:redact |
| `Viewer` | view, aml:read, cbs:read, worm:read, translate:read |
| `auditor` | view, view_unredacted, aml:read, kyc:read, regulator_reports:read |
| `compliance` | view, aml:read, aml:review, cbs:read, regulator_reports:read |

- **Python permission bundles** — `python-service/app/services/auth.py:32-52` mirrors the Node bundle but with lowercase role names (`doc_admin / maker / checker / viewer / auditor / compliance`). RBAC keys must stay in sync across both files; drift is a P0 bug.
- **OPA ABAC layer** — `opa/policies/dms.rego` enforces tenant isolation, branch scoping (non-admin/auditor users locked to their branch), risk-band gate (critical docs require step-up auth), and after-hours gate (admin/approve/sign blocked outside 07:00–22:00 UTC for non-admins). Compiled rules pushed via `routes/spa-api/abac.js` CRUD endpoints + `apps/web/src/modules/abac/AbacPage.tsx`.
- **Route-level pattern** — every endpoint wraps `requirePermJson('<perm>')`; runtime branch scoping at `routes/spa-api/_shared.js:78-82` is the only attribute-level check in the Node layer. There is no per-action granularity within a handler and no per-document or per-folder access check at query time.

### What the admin can actually control
- **Role assignment only.** `routes/spa-api/users.js:105` (`PATCH /users/:id`) lets Doc Admin change a user's role to one of the 6 fixed values. **There is no per-permission override for individual users.** All "fine-grained" control flows through ABAC rules.
- **SoD on role changes.** `routes/spa-api/users.js:75` `sodViolation()` reads forbidden role-pairs from `tenant_config` and blocks any change that would put Maker+Checker on the same person.
- **ABAC rule editor.** Live in the SPA. Authoring path: `RuleList → RuleEditor → TestPolicyPanel → DecisionTraceViewer`. Rules compile to Rego and push to OPA.

### Known dead code (folder_perms case study)
- `db/schema.sql:295-305` defines `folder_perms (folder_id, role, can_view, can_edit, can_delete, tenant_id)`.
- `db/seed.js:150-161` seeds rows: Doc Admin (1/1/1), Maker (1/1/0), Checker (1/0/0), Viewer (1/0/0).
- **No route reads it.** `grep -r 'can_view\|can_edit\|can_delete' routes/spa-api/folders.js` returns nothing. The table is seeded at startup and never queried.
- **DoD implication:** before approving any folder-permission UI work, the slice must include a route that reads this table. Until then, marketing copy must say "folder-level permission scaffolding" not "folder-level RBAC enforced."

### What the Wave-E reviewers got right and wrong
| Earlier claim | Verified status |
|---|---|
| 6 roles with bundled permissions | ✅ Correct |
| Admin can assign roles via UI | ✅ Correct |
| SoD enforcement on role change | ✅ Correct |
| ABAC editor live | ✅ Correct |
| `folder_perms` table exists | ✅ Correct |
| `folder_perms` is enforced in routes | ❌ **Wrong** — table exists, never read |
| Per-user permission override | ❌ **Absent** — only role swap |
| Branch scoping for Viewer/Maker | ✅ Correct |

## Live-code verification log — Wave D (2026-05-10)

Run before relying on any Wave-D-claimed-shipped feature. The earlier UI/UX_REVIEW assertions were checked against on-disk source and confirmed:

- `apps/web/src/components/layout/AppLayout.tsx` — `MobileSidebar` mounted only when `useIsBelowLg()` (< 1024px). Desktop `<Sidebar />` only when `!isBelowLg`. `LocaleEffect` syncs `<html lang>` with i18next.
- `apps/web/src/components/layout/MobileSidebar.tsx` — 147 lines, full Drawer wrapper, nav with `t(i18nKey, label)`, 44px logout button, tenant monogram.
- `apps/web/src/lib/useMatchMedia.ts` — 36 lines, SSR-safe, exports `useIsMobile()` (< 768px) and `useIsBelowLg()` (< 1024px).
- `apps/web/src/lib/i18n.ts` — react-i18next + i18next-icu initialized; locale chain (localStorage → tenant config → en); ICU MessageFormat; missing-key console.warn in dev. Backwards-compat `t()` exported for non-React call sites.
- `apps/web/src/modules/auth/LoginPage.tsx` — 320 lines, `StaticHeroPanel` (no auto-rotating carousel — confirmed absent); all branding fields interpolated from `fetchTenantPublic()`.
- `apps/web/src/modules/capture/components/DocumentSummaryPanel.tsx` — 310 lines, line 181 comment `{/* Restrained loading indicator — no QuantumLoader */}` followed by `<Wand2 animate-pulse>`. **No QuantumLoader anywhere.**

**Open Wave-E gaps still on disk** (carry into next sprint, do not re-claim shipped):
- `apps/web/src/modules/dsar/DSARPage.tsx` — does not exist; backend `python-service/app/routers/dsar.py` is fully wired (lookup, 5-panel inventory, 4 fulfillment actions, 12-day SLA).
- `db/seed.js:923` lists "RMA" token but seeds zero RMA templates — BoB tenant opens Regulator Reports → empty list.
- `apps/web/tailwind.config.ts:48` — `muted: '#888780'` (3.4:1 contrast on white, fails WCAG 1.4.3 AA). Required value: `#6B6962`.
- `apps/web/src/components/layout/Sidebar.tsx:80-95` — `<Link><div>` anti-pattern, no `aria-current="page"`. WCAG 1.4.1 + 4.1.2 fail.
- `apps/web/src/components/ui/Input.tsx:23` — error span has no id; input lacks `aria-describedby` / `aria-invalid`. WCAG 3.3.1 fail.
- `apps/web/src/components/ui/Button.tsx:18-20` — raw `bg-[#d0e3fb]` and `bg-[#c73b3a]` violate the file's own "DO NOT add raw hex" comment.
- Multi-page redaction — migration `0029_redactions_multi_page.py:25-67` ships schema with composite PK `(redaction_id, page)`, but the AnnotationLayer submission still posts page-0 only. Data-leak class issue.
- `audit_log` payload missing `policy_decision` — diff drawer cannot render OPA decision/role/branch/risk_band even though OPA is enforcing them.
- `Customer360Drawer.tsx > PiiRevealField` — flips `masked: false` silently, no `POST /spa/api/audit/events` for `pii_reveal`. GDPR Art. 32 + PDPL §6 violation.

## UI/UX premortem + postmortem (binding for every slice)

The Wave-E re-review showed that the team consistently shipped features that *technically existed* but failed Fortune-50 buyer scrutiny — decorative AI, dz.json placebo, orphan tables, silent PII, demo-grade login. Every recurring failure was visible *before* shipment if anyone had asked the right question. From now on, every slice runs a structured **premortem** before code and a **postmortem** after merge. Both are short (30 minutes max, one screen of output). Skipping them is a release-blocker.

### Premortem — Phase 0, before any code

Owner: **`feature-architect`**, in the same sitting as the contract draft. Inputs: the contract sections 1–3, the relevant mockup screen in `DocManager-Fortune50-Mockup.html`, and the relevant axis in `docs/UI_UX_REVIEW.md`.

The exercise is a **demo-day disaster simulation**: imagine the slice ships next Friday and a Fortune-50 banking buyer (calibrate against Bloomberg, Salesforce FS Cloud, Stripe, ServiceNow GRC, Hebbia, nCino) demos it tomorrow. List the top failure modes that could embarrass the team, then assign a mitigation owner.

Anchor against the **eight Wave-E recurring failure modes** — every premortem must address all eight even if the answer is "n/a, this slice doesn't touch X":

| # | Failure mode | Wave-E precedent | Default mitigation prompt |
|---|---|---|---|
| 1 | UI ships, backend not wired | DSARPage / regulator-RMA | "Which `App.tsx` route + which `routes/` or `app/routers/` file lands in the same PR? `grep` proof?" |
| 2 | Backend ships, UI not routed | regulator routers without page | "Is the SPA page already in `apps/web/src/App.tsx`? If not, who blocks until it is?" |
| 3 | Schema seeded but never read | `folder_perms` | "Which route reads the new table? `grep` proof?" |
| 4 | AI decorative, not inspectable | confidence badges, fake progress | "Is every confidence indicator clickable → popover with model + prompt id + Confirm/Override + scroll-to-source?" |
| 5 | Translation is a placebo | `dz.json` byte-identical to en.json | "Has a Dzongkha-speaking linguist signed off, or is the slice gated on it?" |
| 6 | WCAG Level-A fails | sidebar `<Link><div>`, `--muted` contrast, missing `aria-describedby` | "Skip-link, `aria-current`, `useId()`/`aria-describedby`, contrast ≥ 4.5:1 — all four green?" |
| 7 | Audit chain has gaps | silent PII reveal, missing `policy_decision` | "Every mutation writes to `audit_log` with `policy_decision` JSON? PII reveals emit `pii_reveal` events?" |
| 8 | Mobile / responsive is theatre | iframe PDF letterbox, 28px targets | "Pixel-7 Playwright spec asserts the new page; touch targets ≥ 44px; capture uses `capture='environment'`?" |

**Output format** — written into `docs/contracts/<feature>.md` § Premortem before any engineer starts coding. Reject the slice if any row reads "we'll figure it out":

```markdown
## Premortem (feature-architect, YYYY-MM-DD)

| # | Failure mode | Specific risk for this slice | Mitigation | Owner | Verify with |
|---|---|---|---|---|---|
| 1 | UI without backend | … | … | spa-engineer / node-engineer | `grep -r "<route>" apps/web/src/App.tsx` |
| 2 | Backend without UI | … | … | … | … |
| … | … | … | … | … | … |

**Single most embarrassing thing if we shipped this badly:** <one sentence — the lead reads this aloud at the kickoff>.
```

**Hard rule:** the team lead reads the "single most embarrassing thing" sentence aloud before approving the contract. If it doesn't make at least one engineer flinch, the premortem isn't honest enough — redo it.

### Postmortem — within 24 hours of merge

Owner: **`docs-architect`**, with `qa-engineer` providing test/score deltas and `security-reviewer` providing the audit-grade verdict. Output stored at `docs/postmortems/YYYY-MM-DD-<feature>.md` and linked from `docs/README.md` changelog.

The exercise compares **what we said we'd ship** (premortem + contract AC) to **what actually shipped** (live code + Playwright/pytest output + screenshots), and grades the slice against the same Fortune-50 peers used in `docs/UI_UX_REVIEW.md` §2.2 rubric (0–2 absent, 3–4 internal-tool, 5–6 functional, 7–8 Tier-2 competitive, 9–10 Fortune-50 demo-survivable).

**Output format** — strict, one screen, no marketing prose:

```markdown
# Postmortem — <feature> (YYYY-MM-DD)

## 1. What shipped (file:line evidence)
- <bullet> — `apps/web/src/modules/<feature>/Page.tsx:NN`
- <bullet> — `routes/spa-api/<feature>.js:NN`
- <bullet> — Alembic revision `NNNN_<slug>.py`

## 2. What slipped (carry to next sprint)
- <bullet> — root cause + owner + new ETA

## 3. What surprised us
- <bullet> — anything that wasn't in the premortem; update the premortem template if it's a new failure class

## 4. Wave-E DoD verification
| Hard check | Result | Evidence |
|---|---|---|
| App.tsx route grep | ✅/❌ | `grep` output |
| Orphan-table grep (`folder_perms` class) | ✅/❌ | `grep` output |
| RBAC keys parity (rbac.js ↔ auth.py) | ✅/❌ | `diff` of both files |
| dz.json non-identical for new strings | ✅/❌ | byte-diff hits |
| audit_log has `policy_decision` for new mutations | ✅/❌ | sample row |
| Playwright + pytest green | ✅/❌ | reporter output |
| axe-core critical/serious = 0 | ✅/❌ | scan summary |

## 5. Score delta vs. Fortune-50 peers
| Axis | Score before (UI_UX_REVIEW §9) | Score after | Calibration peer | One-line justification |
|---|---|---|---|---|

## 6. Before/after screenshots
- `docs/postmortems/img/<feature>-before.png`
- `docs/postmortems/img/<feature>-after.png`

## 7. The "demo-day disaster" question revisited
**Premortem said:** <copy the "single most embarrassing thing" sentence>
**Postmortem answer:** <did we close it? if not, what's left?>

## 8. Lessons for the catalogue
- New failure mode discovered? → add row to CLAUDE.md "eight Wave-E recurring failure modes" table.
- New mitigation that worked? → fold into the relevant agent's Wave-E DoD addendum.
```

**Hard rule:** a slice with any ❌ in §4 cannot be tagged as shipped in `docs/ROADMAP.md` or in the changelog. The fix lands as a follow-up commit, the postmortem is updated, and only then does the feature move from "in flight" to "shipped." This is the rule that prevents the next "Wave D claimed shipped but DSARPage doesn't exist" embarrassment.

### Quarterly Wave review

Once per quarter the lead runs a full repeat of the Wave-E exercise — 6–8 Fortune-50 reviewer agents in parallel against the live SPA + the latest mockup — and produces a new score sheet appended to `docs/UI_UX_REVIEW.md`. Postmortems written between reviews feed into it. The premortem template above is updated if any new failure class shows up that the eight-row table didn't catch.

## Compact instructions

When compacting, **preserve**: the current todo list, file paths under edit, the last user directive, green/red state of typecheck + Playwright + pytest, and any open coordination messages between teammates.

**Drop**: tool-call transcripts, dev-server log dumps, intermediate curl output, full test-report bodies (keep pass/fail counts only), and any verbose stdout from `./start.sh` / `./stop.sh`.

Favour the code and the decisions over the mechanics that produced them.
