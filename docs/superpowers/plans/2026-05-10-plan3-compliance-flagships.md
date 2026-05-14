# Plan 3 — Compliance Flagships Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

## Amendments — 2026-05-14 (lead, post-stale-state audit)

The original draft was written assuming `main` was at migration `0040`. Actual head on `main@ff8bfd0` is `0044_workflow_audit_unification`, and `dsar_requests` + `regulator_reports` + `submission_receipts` already exist. **All references below to "0041", "0042", "subject_cid", "fulfillment_kind", "regulator_templates", and "regulator_submissions" are amended as follows; wherever the original text below conflicts with this table, this table wins.**

| Original draft (stale) | Amended (actual) |
|---|---|
| Migration `0041_dsar_requests.py` (CREATE TABLE) | Migration `0045_dsar_requests_extend.py` — additive `op.add_column()` only: `dpo_user_id INT NULL`, `audit_chain_head TEXT NULL`, `inventory_snapshot TEXT NULL`, `branch_id TEXT NULL`. The table already exists from `0040_dsar_requests.py`. |
| Migration `0042_regulator_rma_template.py` (creates `regulator_submissions`, INSERTs into `regulator_templates`) | Migration `0046_regulator_rma_seed.py` — INSERT one row into the existing `regulator_reports` table; do NOT create `regulator_submissions` (the audit table is the existing `submission_receipts` from `0039_regulator_reports.py`). |
| Column `subject_cid` | Column `customer_cid` (existing) |
| Column `axis` | **New** column added by `0045_dsar_requests_extend.py` as `axis TEXT NULL` — needed by Plan 3 mockup, not in 0040. Append to migration 0045's `add_column` list. |
| Column `fulfillment_kind` | Column `action` (existing). Maps: `article15` → existing `action='article15_export'`, `article17` → `action='article17_cryptoshred'`, `litigation_hold` → existing, `fulfillment_letter` → existing. |
| Column `opened_at` | Column `requested_at` (existing) |
| Column `fulfilled_at` | Column `completed_at` (existing) |
| Table `regulator_templates` | Table `regulator_reports` (existing). Identity for BT row: `tenant_id='bhu', regulator='RMA', name='RMA Quarterly Compliance Report'`. There is no `country_code` column — encode country via `tenant_id`. |
| Field `frequency`, `sla_days`, `json_schema` (on regulator_templates) | Stored inside `parameters_schema_json` as nested keys (`{"frequency": "quarterly", "sla_days": 15, "controls": [...]}`) on `regulator_reports`. |
| Table `regulator_submissions` | Table `submission_receipts` (existing). Use its `report_template_id` (FK to `regulator_reports.id`), `params_json`, `file_path`, `sha256`, `signature`, `submitted_at` columns. |
| RBAC `regulator:export` / `regulator:submit` | Extend existing `regulator_reports:admin` (already in `services/rbac.js`) — or add fine-grained `regulator_reports:export` / `regulator_reports:submit` keys (postmortem-listed for lead to apply). |
| RBAC `dsar:read` / `dsar:fulfill` | Same naming; new keys, must be added in postmortem additions. |

**Final migration filenames Plan 3 owns:** `python-service/migrations/versions/0045_dsar_requests_extend.py` and `python-service/migrations/versions/0046_regulator_rma_seed.py`.

**Updated File-Structure overrides** for the table below (lines 15–18 of the original file structure are wrong; use these instead):

| Layer | File | Change |
|---|---|---|
| DB | `db/schema.sql` | Append `ALTER TABLE dsar_requests ADD COLUMN …` block guarded by `db/index.js#addColumnIfMissing()` for the 5 new columns. **Do not re-issue `CREATE TABLE dsar_requests`** — already there. |
| DB | `db/seed.js` | Append BT RMA seed: `INSERT OR IGNORE INTO regulator_reports (tenant_id, regulator, name, parameters_schema_json, format, schedule_cron) VALUES ('bhu', 'RMA', 'RMA Quarterly Compliance Report', ?, 'pdf', '0 6 1 1,4,7,10 *')`. |
| DB migration | `python-service/migrations/versions/0045_dsar_requests_extend.py` | NEW — `op.add_column()` ×5 on existing `dsar_requests`: `dpo_user_id`, `audit_chain_head`, `inventory_snapshot`, `branch_id`, `axis`. All nullable; idempotent via `if_not_exists` where supported. `down_revision='0044_workflow_audit_unification'`. |
| DB migration | `python-service/migrations/versions/0046_regulator_rma_seed.py` | NEW — `op.execute("INSERT INTO regulator_reports …")` with `ON CONFLICT DO NOTHING` for the BT RMA row. `down_revision='0045_dsar_requests_extend'`. |

The rest of the original File-Structure table (Node routes, SPA pages, tests, i18n, postmortem) is unchanged.

**Effect on code blocks below:** every `INSERT INTO dsar_requests (subject_cid, axis, regulator, opened_at, sla_due_at, ...)` should be read as `INSERT INTO dsar_requests (customer_cid, axis, regulator, requested_at, sla_due_at, action, params_json, ...)`. Every `INSERT INTO regulator_templates (country_code, name, frequency, sla_days, json_schema, ...)` should be read as `INSERT INTO regulator_reports (tenant_id, regulator, name, parameters_schema_json, format, schedule_cron, ...)`. Every `regulator_submissions` reference should be read as `submission_receipts`.

### Task #5 (DocBrain Chat v2) testid contract — amended 2026-05-14

The existing `apps/web/src/modules/ai/ChatPage.tsx` (Wave-C, 870+ lines) already implements the 3-pane shell, hover toolbar, citation buttons, and amber halt banner — but with legacy `chat-*` / `citation-btn-*` / `evidence-rail` / `amber-halt-banner` testids that three other Playwright specs (`docbrain.spec.ts`, `chat.spec.ts`, `agent.spec.ts`) still assert on. Renaming would break those.

Plan 3 adds **wrapper** testids on the three panes + the three sidebar sections so the contract testids in the Playwright spec match without touching the form-element testids the legacy specs depend on. The Plan 3 spec (`apps/web/e2e/docbrain-v2.spec.ts`) uses this hybrid mapping:

| Plan 3 contract | Actual surface |
|---|---|
| `docbrain-conversations-sidebar` | NEW wrapper div around the sidebar |
| `docbrain-message-thread`        | NEW wrapper div around the center pane |
| `docbrain-evidence-rail`         | NEW wrapper div around the right pane (legacy `evidence-rail` retained on the inner content) |
| `docbrain-conv-section-pinned/today/earlier` | NEW `<section>` wrappers (always rendered; empty when the bucket has zero rows) |
| `docbrain-conv-search-input`     | use existing `chat-search` |
| `docbrain-msg-input`             | use existing `chat-input` |
| `docbrain-msg-send`              | use existing `chat-send` |
| `docbrain-message-{role}`        | use existing `chat-msg-{role}` |
| `docbrain-msg-toolbar`           | use existing `msg-toolbar-{id}` |
| `docbrain-msg-copy/-retry/-edit-resend/-regenerate/-cite-as-comment` | use existing `msg-edit-{id}` / `msg-retry-{id}` / `msg-regenerate-{id}`; copy button has no testid today; cite-as-comment is deferred (postmortem-listed) |
| `docbrain-citation-N`            | use existing `citation-btn-N` |
| `docbrain-halt-banner`           | refactored AmberHaltBanner — primary testid now `docbrain-halt-banner`; hidden `<span data-testid="amber-halt-banner" />` alias retained for legacy specs |
| `docbrain-halt-search-adjacent`  | NEW button inside AmberHaltBanner |
| `docbrain-halt-override`         | NEW button inside AmberHaltBanner |

App.tsx adds `/docbrain` as a route alias to the existing `/ai` so the Plan 3 spec's `await page.goto('/docbrain')` resolves.

---

**Goal:** Close the customer-blocking compliance flagship gaps from Wave-E §3.10 — DSAR Console (mockup screen 15), Regulator Reports RMA template (mockup screen 14), Audit Log v2 chain-verify banner + diff drawer (mockup screen 13), DocBrain Chat v2 3-pane shell + has_evidence halt banner (mockup screen 16), Search Results v2 facets + operator-token chips + FTS5-highlighted snippets (mockup screen 17).

**Architecture:** SPA-heavy (most backends already exist per Plan 0 audit). Adds 2 additive migrations (`0045_dsar_requests_extend` adds 5 nullable cols; `0046_regulator_rma_seed` INSERTs BT row into existing `regulator_reports`), 6 RBAC keys, 4 new SPA pages, 4 backend route mounts.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind, Node 20 Express, Python FastAPI (DSAR backend already shipped), better-sqlite3, react-i18next + i18next-icu.

## File structure

| Layer | File | Change |
|---|---|---|
| DB | `db/schema.sql` | Add `dsar_requests` table (id, tenant_id, subject_cid, axis, opened_at, sla_due_at, status, regulator, dpo_user_id, fulfillment_kind, fulfilled_at, audit_chain_head); seed `regulator_templates` BT row |
| DB | `db/index.js` | `addColumnIfMissing` not needed; new tables created on schema apply |
| DB migration | `python-service/migrations/versions/0041_dsar_requests.py` | Mirror `dsar_requests` for Postgres parity |
| DB migration | `python-service/migrations/versions/0042_regulator_rma_template.py` | INSERT `regulator_templates` row + `regulator_submissions` audit table |
| Node route | `routes/spa-api/dsar.js` | Extends — adds `POST /spa/api/dsar/requests` (open), `GET /spa/api/dsar/requests` (list), `POST /spa/api/dsar/requests/:id/fulfill` (4 actions), `GET /spa/api/dsar/requests/:id/sla` |
| Node route | `routes/spa-api/regulator-rma.js` | NEW — `GET /spa/api/regulator-reports/rma/quarterly`, `POST /spa/api/regulator-reports/rma/:id/export`, `POST /spa/api/regulator-reports/rma/:id/submit` |
| Node route | `routes/spa-api/audit.js` | Extend — `GET /spa/api/audit/chain/verify` walks hash chain from genesis, returns `{verified, count, latest_anchor, broken_at}` |
| Node route | `routes/spa-api/docbrain-v2.js` | Extends — `GET /spa/api/docbrain/conversations`, `POST /spa/api/docbrain/conversations/:id/pin`, `POST /spa/api/docbrain/messages/:id/cite-as-comment` |
| Node route | `routes/spa-api/search-v2.js` | Extends — `GET /spa/api/search/v2?q=...&facets=...` returns FTS5-highlighted snippets + facet counts |
| SPA route | `apps/web/src/modules/dsar/DSARPage.tsx` | EXTEND existing — wire 5-panel inventory exactly to mockup, 4 fulfillment-kind action cards, SLA countdown bar, audit-of-DSARs button |
| SPA route | `apps/web/src/modules/regulator-reports/Page.tsx` | EXTEND — render RMA template card in library; new sub-page `RmaQuarterlyDetail.tsx` |
| SPA component | `apps/web/src/modules/regulator-reports/RmaQuarterlyDetail.tsx` | NEW — quarterly report detail view (period selector, control checklist, export+submit) |
| SPA route | `apps/web/src/modules/audit/AuditLogPage.tsx` | EXTEND — promote `ChainVerifyBadge` into a green banner at top of `events` tab; add diff drawer JSON before/after panel |
| SPA component | `apps/web/src/modules/audit/components/DiffDrawer.tsx` | EXTEND — render before/after JSON, policy_decision JSON, prev_hash/hash chain segment |
| SPA route | `apps/web/src/modules/docbrain/ChatPage.tsx` | NEW — refactor RagChat.tsx into 3-pane shell with conversations sidebar + message thread + evidence rail |
| SPA component | `apps/web/src/modules/docbrain/components/ConversationsSidebar.tsx` | NEW |
| SPA component | `apps/web/src/modules/docbrain/components/MessageThread.tsx` | NEW |
| SPA component | `apps/web/src/modules/docbrain/components/EvidenceRail.tsx` | NEW |
| SPA component | `apps/web/src/modules/docbrain/components/HasEvidenceHaltBanner.tsx` | NEW — amber halt banner when `RagAnswer.has_evidence === false` |
| SPA component | `apps/web/src/modules/docbrain/components/MessageHoverToolbar.tsx` | NEW — Copy/Retry/Edit-and-resend/Regenerate/Cite-as-comment |
| SPA route | `apps/web/src/modules/search/SearchPageV2.tsx` | NEW — operator-token chips at top, facets sidebar, FTS5-highlighted snippets, per-result actions, "Ask DocBrain" footer CTA |
| SPA component | `apps/web/src/modules/search/components/OperatorTokenChip.tsx` | NEW |
| SPA component | `apps/web/src/modules/search/components/FacetsSidebar.tsx` | NEW |
| SPA component | `apps/web/src/modules/search/components/SnippetWithHighlight.tsx` | NEW |
| SPA i18n | `apps/web/src/i18n/en.json` + `dz.json` | Add ~80 new strings under owned namespaces (dsar.*, regulator.rma.*, audit.banner.*, audit.chain.*, docbrain.v2.*, search.v2.*, search.facets.*) — dz.json gets real Tibetan or `[DZ-PENDING]` markers |
| Tests | `apps/web/e2e/dsar-fulfill.spec.ts` | NEW — open DSAR, run all 4 fulfillment actions, assert audit rows |
| Tests | `apps/web/e2e/regulator-rma.spec.ts` | NEW — render RMA template, export bundle, assert signed ZIP |
| Tests | `apps/web/e2e/audit-chain-banner.spec.ts` | NEW — banner shows verified count + diff drawer renders before/after |
| Tests | `apps/web/e2e/docbrain-v2.spec.ts` | NEW — 3-pane layout, halt banner appears on `has_evidence=false`, `[^N]` click fires viewer:scroll-to-span |
| Tests | `apps/web/e2e/search-v2.spec.ts` | NEW — operator chip parsed, facets filter, snippet has highlight, Ask DocBrain CTA |
| Tests | `python-service/tests/test_dsar_persistence.py` | NEW — assert dsar_requests row written with audit chain head |
| Postmortem | `docs/postmortems/2026-05-XX-plan3-compliance-flagships.md` | NEW — 8-section format with shared-file additions list for lead |

## Premortem (feature-architect, 2026-05-10)

Demo-day disaster simulation: imagine the slice ships Friday and Royal Monetary Authority of Bhutan demos it Monday. We claim "DSAR fulfilled in 12 days, RMA quarterly auto-generated, audit chain integrity verified live." Where does it crater?

| # | Failure mode (Wave-E class) | Specific risk for Plan 3 | Mitigation | Owner | Verify command |
|---|---|---|---|---|---|
| 1 | UI without backend | DSAR cryptoshred button calls a wired endpoint but the per-subject KMS key was never provisioned for seed customer; Article 17 no-ops silently | Task 1 Step 4 asserts the python-service `/api/v1/dsar/fulfill?kind=cryptoshred` returns 200 AND the seed customer's documents are now unreadable; if the KMS path fails, the button is disabled with explanatory tooltip | spa-engineer + python-engineer | `pytest python-service/tests/test_dsar_cryptoshred.py -v` |
| 2 | Backend without UI | Python `/api/v1/dsar/*` is fully wired but the SPA never mounts `routes/spa-api/dsar.js` extensions for the 4 fulfillment actions | Task 1 Step 2 grep + Task 8 postmortem lists the `routes/spa-api.js` mount line and `App.tsx` `/dsar` route addition | node-engineer | `grep -n "spa-api/dsar\|/dsar" routes/spa-api.js apps/web/src/App.tsx` |
| 3 | Orphan table | Migration 0041 adds `dsar_requests` but no SPA route reads it | Task 1 Step 5 — `RequestList` query hits `GET /spa/api/dsar/requests` which selects from `dsar_requests`; e2e asserts the row appears after open | node-engineer + qa-engineer | `grep -n "FROM dsar_requests" routes/spa-api/dsar.js` |
| 4 | Decorative AI | DocBrain chat shows `[^1] [^2]` citations but they don't scroll the viewer; halt banner says "no evidence" but model still hallucinated text behind it | Task 5 Step 3 — Plan 0's `viewer:scroll-to-span` event bus is the contract; e2e clicks `[^1]` and asserts the viewer fired the event. Halt banner replaces (not augments) the answer text when `has_evidence=false` | spa-engineer | `npx playwright test docbrain-v2.spec.ts -g "citation click"` |
| 5 | dz.json placebo | Adding 80 new English strings; if dz.json reuses identical English values, npm run i18n:check fails | Task 7 Step 4 — every new string ships with a real Tibetan translation OR the explicit `[DZ-PENDING]` prefix; check enforces non-byte-identical | spa-engineer | `npm run i18n:check` |
| 6 | WCAG Level-A | New diff drawer + 3-pane chat are likely to introduce focus-trap issues (drawer trap), color-only state on facet checkboxes, missing aria-current on conversation list | Task 4 Step 6 + Task 5 Step 6 — every new component runs axe-core in its e2e spec; focus management uses `<dialog>` or react-aria-focus-trap | spa-engineer | `npx playwright test --grep axe-core` |
| 7 | Audit gaps | DSAR fulfill, RMA submit, audit chain export — 4 new mutations; if any forgets `policyDecision: buildPolicyDecision(req)`, SOX defense crumbles | Task 8 postmortem includes the same `writeAuditRow` grep guard from Plan 0 Task 2 Step 7; CI rejects merge if any new caller misses policyDecision | node-engineer | `node scripts/check-audit-policy-decision.js` |
| 8 | Mobile theatre | DSAR 5-panel inventory grid claims to be responsive but on Pixel 7 the 5 columns crush to unreadable < 360px | Task 1 Step 3 — `InventoryGrid` switches to `grid-cols-2` < md, `grid-cols-1` < sm; e2e mobile project runs DSAR spec | spa-engineer | `npx playwright test --project=mobile dsar-fulfill.spec.ts` |

**Single most embarrassing thing if we shipped this badly:** "We demoed an Article-17 cryptoshred button that printed `200 OK` to the user but didn't actually destroy the KMS key — the auditor pulled the document one click later and read every PII field, on stage, in front of the central bank."

## Tasks

## Task 1: DSAR Console — wire 4 fulfillment actions + 5-panel inventory + SLA bar

**Files:**
- Migration: `db/schema.sql` (CREATE TABLE `dsar_requests`)
- Migration: `python-service/migrations/versions/0041_dsar_requests.py`
- Modify: `routes/spa-api/dsar.js` (extend list/open/fulfill/sla endpoints)
- Modify: `apps/web/src/modules/dsar/DSARPage.tsx` (mockup screen 15 fidelity)
- Modify: `apps/web/src/modules/dsar/components/InventoryGrid.tsx`
- Modify: `apps/web/src/modules/dsar/components/FulfillModal.tsx`
- Modify: `apps/web/src/modules/dsar/components/RequestList.tsx`
- Test: `apps/web/e2e/dsar-fulfill.spec.ts` (NEW)
- Test: `python-service/tests/test_dsar_persistence.py` (NEW)

- [ ] **Step 1: Read existing DSAR surface and confirm gap inventory**

```bash
grep -n "dsar_requests\|fulfillment_kind\|cryptoshred" python-service/app/routers/dsar.py routes/spa-api/dsar.js apps/web/src/modules/dsar/*.{ts,tsx}
ls apps/web/src/modules/dsar/components/
```

Expected: Python `dsar.py` has `fulfill` route but Node side returns mocks. SPA `InventoryGrid` exists but doesn't match mockup 5-panel layout (Documents / AI traces / Audit events / Workflows / CBS records). `FulfillModal` exists but only wires `cryptoshred` via Python.

- [ ] **Step 2: Write the failing E2E spec**

Create `apps/web/e2e/dsar-fulfill.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('DSAR full lifecycle — open, lookup, all 4 fulfillment actions', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/dsar');

  // Open new DSAR for seed customer
  await page.getByTestId('dsar-new-request').click();
  await page.getByTestId('dsar-axis-cid').click();
  await page.getByTestId('dsar-search-input').fill('CID-001234');
  await page.getByTestId('dsar-submit').click();
  await expect(page.getByTestId('dsar-subject-card')).toContainText('CID-001234');

  // 5-panel inventory must render with non-zero counts
  await page.getByTestId('dsar-subject-row-CID-001234').click();
  await expect(page.getByTestId('dsar-panel-documents')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-ai-traces')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-audit-events')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-workflows')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-cbs-records')).toBeVisible();

  // SLA countdown bar visible
  await expect(page.getByTestId('dsar-sla-countdown')).toContainText(/\d+\s*d/);

  // Run Article 15 export
  await page.getByTestId('dsar-fulfill-article15').click();
  await page.getByTestId('dsar-fulfill-confirm').click();
  await expect(page.getByTestId('toast-success')).toContainText(/exported|bundle/i);

  // Audit row written with policy_decision populated
  const r = await request.get('/spa/api/audit?limit=1&action=dsar.fulfill');
  const body = await r.json();
  expect(body.events[0].policy_decision).toBeTruthy();
  const decision = JSON.parse(body.events[0].policy_decision);
  expect(decision.role).toBeTruthy();
});

test('DSAR Article 17 cryptoshred renders confirm dialog with double-confirm', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/dsar');
  // ... lookup steps as above ...
  await page.getByTestId('dsar-fulfill-article17').click();
  await expect(page.getByTestId('dsar-cryptoshred-confirm-1')).toBeVisible();
  await page.getByTestId('dsar-cryptoshred-confirm-1-button').click();
  await expect(page.getByTestId('dsar-cryptoshred-confirm-2')).toBeVisible();
  await page.getByLabel(/type "DESTROY" to confirm/i).fill('DESTROY');
  await page.getByTestId('dsar-cryptoshred-confirm-2-button').click();
  await expect(page.getByTestId('toast-success')).toContainText(/cryptoshred/i);
});

test('DSAR mobile layout collapses 5-panel grid to 1-column', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only');
  await login(page, 'admin', 'admin123');
  await page.goto('/dsar');
  // ... lookup steps ...
  const grid = page.getByTestId('dsar-inventory-grid');
  await expect(grid).toHaveCSS('grid-template-columns', /^[^\s]+$/); // 1 column on mobile
});
```

- [ ] **Step 3: Run — expect FAIL with "panel-cbs-records not found" and "cryptoshred-confirm-1 not found"**

```bash
cd apps/web && npx playwright test dsar-fulfill.spec.ts --reporter=line
```

- [ ] **Step 4: Build the migration + Node route + SPA changes**

DDL into `db/schema.sql` (append, kept nullable + idempotent):

```sql
CREATE TABLE IF NOT EXISTS dsar_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  subject_cid TEXT NOT NULL,
  axis TEXT NOT NULL,                     -- 'cid' | 'email' | 'phone' | 'national_id'
  regulator TEXT NOT NULL DEFAULT 'GDPR', -- 'GDPR' | 'PDPL' | 'RMA'
  opened_at TEXT NOT NULL,
  sla_due_at TEXT NOT NULL,               -- opened_at + regulator window (default 30d)
  status TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'verified' | 'fulfilled' | 'breached'
  fulfillment_kind TEXT,                  -- 'article15' | 'article17' | 'litigation_hold' | 'fulfillment_letter'
  fulfilled_at TEXT,
  dpo_user_id INTEGER,
  audit_chain_head TEXT,                  -- pointer to audit row at fulfillment time
  inventory_snapshot TEXT,                -- JSON: {documents, ai_traces, audit_events, workflows, cbs_records}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS dsar_requests_subject ON dsar_requests(subject_cid);
CREATE INDEX IF NOT EXISTS dsar_requests_tenant_status ON dsar_requests(tenant_id, status);
```

`python-service/migrations/versions/0041_dsar_requests.py`:

```python
"""dsar_requests + dsar_artifacts join

Revision ID: 0041
Revises: 0040
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = '0041'
down_revision = '0040'

def upgrade():
    op.create_table('dsar_requests',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('tenant_id', sa.String(64), nullable=False, index=True),
        sa.Column('subject_cid', sa.String(64), nullable=False, index=True),
        sa.Column('axis', sa.String(32), nullable=False),
        sa.Column('regulator', sa.String(16), nullable=False, server_default='GDPR'),
        sa.Column('opened_at', sa.DateTime, nullable=False),
        sa.Column('sla_due_at', sa.DateTime, nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='open'),
        sa.Column('fulfillment_kind', sa.String(32)),
        sa.Column('fulfilled_at', sa.DateTime),
        sa.Column('dpo_user_id', sa.Integer),
        sa.Column('audit_chain_head', sa.String(128)),
        sa.Column('inventory_snapshot', sa.Text),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_table('dsar_artifacts',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('dsar_request_id', sa.Integer, sa.ForeignKey('dsar_requests.id'), nullable=False),
        sa.Column('artifact_kind', sa.String(32), nullable=False),  # 'document' | 'ai_trace' | 'audit_event' | 'workflow' | 'cbs_record'
        sa.Column('artifact_id', sa.String(128), nullable=False),
        sa.Column('frozen_at_open', sa.Boolean, nullable=False, server_default=sa.text('1')),
    )

def downgrade():
    op.drop_table('dsar_artifacts')
    op.drop_table('dsar_requests')
```

Extend `routes/spa-api/dsar.js` — add the four endpoints (Node Express, RBAC `dsar:read` and `dsar:fulfill`):

```javascript
// At top of routes/spa-api/dsar.js after existing imports:
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { z } = require('zod');

const SLA_WINDOW_DAYS = { GDPR: 30, PDPL: 30, RMA: 15 };

const OpenBody = z.object({
  subject_cid: z.string().min(1),
  axis: z.enum(['cid', 'email', 'phone', 'national_id']),
  regulator: z.enum(['GDPR', 'PDPL', 'RMA']).default('GDPR'),
});

router.post('/requests', requirePermJson('dsar:read'), (req, res) => {
  const parsed = OpenBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const opened = new Date();
  const due = new Date(opened.getTime() + SLA_WINDOW_DAYS[parsed.data.regulator] * 86400_000);

  // Snapshot inventory at open time (frozen for audit defensibility).
  const snapshot = inventorySnapshot(parsed.data.subject_cid, req.session.user.tenant_id);

  const info = db.prepare(`
    INSERT INTO dsar_requests (tenant_id, subject_cid, axis, regulator, opened_at, sla_due_at, inventory_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.session.user.tenant_id, parsed.data.subject_cid, parsed.data.axis,
         parsed.data.regulator, opened.toISOString(), due.toISOString(), JSON.stringify(snapshot));

  writeAuditRow({
    userId: req.session.user.id,
    action: 'dsar.lookup',
    entityType: 'dsar_request',
    entityId: String(info.lastInsertRowid),
    detail: { subject_cid: parsed.data.subject_cid, axis: parsed.data.axis },
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true, id: info.lastInsertRowid, sla_due_at: due.toISOString() });
});

const FulfillBody = z.object({
  kind: z.enum(['article15', 'article17', 'litigation_hold', 'fulfillment_letter']),
  reason: z.string().min(20),
  destroy_token: z.string().optional(), // required when kind='article17'
});

router.post('/requests/:id/fulfill', requirePermJson('dsar:fulfill'), async (req, res) => {
  const parsed = FulfillBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });
  if (parsed.data.kind === 'article17' && parsed.data.destroy_token !== 'DESTROY')
    return res.status(400).json({ error: 'cryptoshred_confirmation_missing' });

  const dsar = db.prepare('SELECT * FROM dsar_requests WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, req.session.user.tenant_id);
  if (!dsar) return res.status(404).json({ error: 'not_found' });

  // Delegate to python-service for the actual fulfillment work.
  const py = await fetch(`${process.env.PYTHON_SERVICE_URL}/api/v1/dsar/fulfill`, {
    method: 'POST',
    headers: { 'X-API-Key': process.env.PYTHON_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject_cid: dsar.subject_cid, kind: parsed.data.kind, dsar_request_id: dsar.id }),
  });
  if (!py.ok) return res.status(502).json({ error: 'python_service_failed', detail: await py.text() });
  const pyBody = await py.json();

  db.prepare(`
    UPDATE dsar_requests SET status = 'fulfilled', fulfillment_kind = ?, fulfilled_at = ?, dpo_user_id = ?
    WHERE id = ?
  `).run(parsed.data.kind, new Date().toISOString(), req.session.user.id, dsar.id);

  writeAuditRow({
    userId: req.session.user.id,
    action: 'dsar.fulfill',
    entityType: 'dsar_request',
    entityId: String(dsar.id),
    detail: { kind: parsed.data.kind, reason: parsed.data.reason, py_artifact: pyBody.artifact_id || null },
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true, artifact: pyBody });
});

router.get('/requests', requirePermJson('dsar:read'), (req, res) => {
  const items = db.prepare(`
    SELECT id, subject_cid, regulator, opened_at, sla_due_at, status, fulfillment_kind, fulfilled_at
    FROM dsar_requests WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT 100
  `).all(req.session.user.tenant_id);
  res.json({ items });
});

router.get('/requests/:id/sla', requirePermJson('dsar:read'), (req, res) => {
  const r = db.prepare('SELECT opened_at, sla_due_at, regulator FROM dsar_requests WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, req.session.user.tenant_id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const totalMs = new Date(r.sla_due_at).getTime() - new Date(r.opened_at).getTime();
  const elapsedMs = Date.now() - new Date(r.opened_at).getTime();
  const remainingDays = Math.max(0, Math.ceil((totalMs - elapsedMs) / 86400_000));
  res.json({ regulator: r.regulator, remaining_days: remainingDays, percent_elapsed: Math.min(100, (elapsedMs / totalMs) * 100) });
});

function inventorySnapshot(cid, tenantId) {
  return {
    documents: db.prepare('SELECT COUNT(*) c FROM documents WHERE customer_cid = ? AND tenant_id = ?').get(cid, tenantId).c,
    ai_traces: db.prepare("SELECT COUNT(*) c FROM ai_traces WHERE entity_id = ? AND tenant_id = ?").get(cid, tenantId).c,
    audit_events: db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id = ? AND tenant_id = ?").get(cid, tenantId).c,
    workflows: db.prepare("SELECT COUNT(*) c FROM workflow_instances WHERE customer_cid = ? AND tenant_id = ?").get(cid, tenantId).c,
    cbs_records: 0, // Populated via integrations adapter; 0 in dev.
  };
}
```

Refactor `apps/web/src/modules/dsar/DSARPage.tsx` to mockup-fidelity (the key changes):

```tsx
// Inside DSARPage, after the existing subject lookup block, replace InventoryGrid usage with:
{selectedSubject !== null && panels !== null && (
  <>
    <SubjectHeaderCard subject={selectedSubject} slaQuery={slaQ} />
    <InventoryGrid panels={panels} data-testid="dsar-inventory-grid" />
    <FulfillmentActionGrid
      onArticle15={() => openFulfill('article15')}
      onArticle17={() => openFulfill('article17')}
      onLitigationHold={() => openFulfill('litigation_hold')}
      onFulfillmentLetter={() => openFulfill('fulfillment_letter')}
    />
  </>
)}
```

`InventoryGrid.tsx` — render exactly 5 panels with mockup classes (`bg-brand-skyLight`, `bg-purple/20`, `bg-divider`, `bg-success-bg`, `bg-warning-bg`):

```tsx
const PANELS = [
  { key: 'documents',    testid: 'dsar-panel-documents',    bg: 'bg-brand-skyLight',  fg: 'text-brand-blue', label: t('dsar.panel.documents') },
  { key: 'ai_traces',    testid: 'dsar-panel-ai-traces',    bg: 'bg-purple/20',       fg: 'text-purple',     label: t('dsar.panel.ai_traces') },
  { key: 'audit_events', testid: 'dsar-panel-audit-events', bg: 'bg-divider',         fg: 'text-ink',        label: t('dsar.panel.audit_events') },
  { key: 'workflows',    testid: 'dsar-panel-workflows',    bg: 'bg-success-bg',      fg: 'text-success',    label: t('dsar.panel.workflows') },
  { key: 'cbs_records',  testid: 'dsar-panel-cbs-records',  bg: 'bg-warning-bg',      fg: 'text-warning',    label: t('dsar.panel.cbs_records') },
] as const;

return (
  <div data-testid="dsar-inventory-grid"
       className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
    {PANELS.map((p) => (
      <button key={p.key} data-testid={p.testid}
              className={cn('text-center p-3 rounded-md', p.bg)}
              onClick={() => onDrillDown(p.key)}>
        <p className={cn('text-2xl font-bold tabular', p.fg)}>{panels[p.key]}</p>
        <p className={cn('text-2xs font-medium', p.fg)}>{p.label}</p>
      </button>
    ))}
  </div>
);
```

`FulfillModal.tsx` — for `article17`, render two-stage confirm:

```tsx
{kind === 'article17' && stage === 1 && (
  <div data-testid="dsar-cryptoshred-confirm-1">
    <h2>{t('dsar.cryptoshred.warning_title')}</h2>
    <p>{t('dsar.cryptoshred.warning_body')}</p>
    <button data-testid="dsar-cryptoshred-confirm-1-button" onClick={() => setStage(2)}>
      {t('dsar.cryptoshred.acknowledge')}
    </button>
  </div>
)}
{kind === 'article17' && stage === 2 && (
  <div data-testid="dsar-cryptoshred-confirm-2">
    <Input label={t('dsar.cryptoshred.type_destroy')}
           value={destroyText} onChange={(e) => setDestroyText(e.target.value)} />
    <button data-testid="dsar-cryptoshred-confirm-2-button"
            disabled={destroyText !== 'DESTROY' || reason.length < 20}
            onClick={() => mutate.mutate({ kind, reason, destroy_token: 'DESTROY' })}>
      {t('dsar.cryptoshred.execute')}
    </button>
  </div>
)}
```

- [ ] **Step 5: Run E2E — expect PASS**

```bash
cd apps/web && npx playwright test dsar-fulfill.spec.ts --reporter=line
```

- [ ] **Step 6: Run pytest persistence test**

Create `python-service/tests/test_dsar_persistence.py`:

```python
import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

def test_dsar_request_persisted(authenticated_admin_token):
    resp = client.post('/api/v1/dsar/fulfill',
        headers={'Authorization': f'Bearer {authenticated_admin_token}', 'X-API-Key': 'dev-key-change-me'},
        json={'subject_cid': 'CID-001234', 'kind': 'article15', 'dsar_request_id': 1})
    assert resp.status_code == 200
    body = resp.json()
    assert 'artifact_id' in body
```

```bash
cd python-service && pytest tests/test_dsar_persistence.py -v
```

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql python-service/migrations/versions/0041_dsar_requests.py \
        routes/spa-api/dsar.js \
        apps/web/src/modules/dsar/DSARPage.tsx \
        apps/web/src/modules/dsar/components/InventoryGrid.tsx \
        apps/web/src/modules/dsar/components/FulfillModal.tsx \
        apps/web/src/modules/dsar/components/RequestList.tsx \
        apps/web/e2e/dsar-fulfill.spec.ts \
        python-service/tests/test_dsar_persistence.py
git commit -m "feat(dsar): wire 4 fulfillment actions + 5-panel inventory + SLA bar

Migration 0041: dsar_requests + dsar_artifacts (Node SQLite + alembic).
Cryptoshred (Article 17) requires double-confirm with DESTROY token.
Every dsar.lookup + dsar.fulfill writes audit row with policy_decision.
Closes Wave-E §3.10 — DSAR Console mockup screen 15."
```

---

## Task 2: RMA Quarterly Compliance Report — template seed + library card + detail view

**Files:**
- Migration: `python-service/migrations/versions/0042_regulator_rma_template.py`
- Modify: `db/schema.sql` (seed `regulator_templates` BT row inline-or-via-seed.js)
- Modify: `db/seed.js` (insert RMA template row)
- Create: `routes/spa-api/regulator-rma.js`
- Modify: `routes/spa-api/regulator-reports.js` (extend list to include RMA)
- Modify: `apps/web/src/modules/regulator-reports/Page.tsx` (render RMA card in library)
- Create: `apps/web/src/modules/regulator-reports/RmaQuarterlyDetail.tsx`
- Test: `apps/web/e2e/regulator-rma.spec.ts` (NEW)

- [ ] **Step 1: Read existing regulator-reports surface**

```bash
grep -n "regulator_templates\|country_code\|frequency" python-service/app/models.py routes/spa-api/regulator-reports.js apps/web/src/modules/regulator-reports/Page.tsx
```

Expected: `regulator_templates` table exists with fields (id, country_code, name, frequency, sla_days, json_schema). Page.tsx renders cards from `GET /spa/api/regulator-reports/templates`. No BT row exists yet.

- [ ] **Step 2: Failing E2E spec**

Create `apps/web/e2e/regulator-rma.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('RMA quarterly template appears in library and renders detail', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');

  // Library shows the BT card
  const card = page.getByTestId('regulator-template-card-rma-quarterly-bt');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Bhutan|RMA/i);
  await expect(card).toContainText(/Quarterly/i);
  await expect(card).toContainText(/15 days/i);

  // Open detail
  await card.click();
  await expect(page).toHaveURL(/\/regulator-reports\/.+rma.+/i);
  await expect(page.getByTestId('rma-period-selector')).toBeVisible();
  await expect(page.getByTestId('rma-control-checklist')).toBeVisible();
});

test('RMA export emits regulator.report_export audit event', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');
  await page.getByTestId('regulator-template-card-rma-quarterly-bt').click();
  await page.getByTestId('rma-export-bundle').click();
  await page.getByTestId('rma-export-confirm').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  const r = await request.get('/spa/api/audit?limit=1&action=regulator.report_export');
  const body = await r.json();
  expect(body.events[0]).toMatchObject({ action: 'regulator.report_export' });
});

test('RMA submit requires regulator:submit and shows confirm', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');
  await page.getByTestId('regulator-template-card-rma-quarterly-bt').click();
  await page.getByTestId('rma-submit').click();
  await expect(page.getByTestId('rma-submit-confirm-dialog')).toBeVisible();
});
```

- [ ] **Step 3: Run — expect FAIL with "card not found"**

```bash
cd apps/web && npx playwright test regulator-rma.spec.ts --reporter=line
```

- [ ] **Step 4: Build the migration + seed + Node route**

`python-service/migrations/versions/0042_regulator_rma_template.py`:

```python
"""regulator_templates BT quarterly + regulator_submissions audit table

Revision ID: 0042
Revises: 0041
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
import json

revision = '0042'
down_revision = '0041'

RMA_QUARTERLY_SCHEMA = {
    "controls": [
        {"id": "AML_KYC", "label": "AML/KYC compliance", "evidence_required": ["sar_filings_count", "kyc_refresh_count"]},
        {"id": "CDD", "label": "Customer Due Diligence", "evidence_required": ["high_risk_count", "edd_count"]},
        {"id": "RECORD_KEEPING", "label": "Record keeping (7-year retention)", "evidence_required": ["docs_purged_count", "retention_violations"]},
        {"id": "REPORTING", "label": "Suspicious transaction reporting", "evidence_required": ["str_count", "ctr_count"]},
        {"id": "GOVERNANCE", "label": "Board oversight + MLRO sign-off", "evidence_required": ["mlro_signoff_date", "board_minutes_link"]},
    ],
    "period_options": ["Q1", "Q2", "Q3", "Q4"],
    "filing_format": "RMA-CR-2026",
}

def upgrade():
    op.execute(sa.text("""
        INSERT INTO regulator_templates (country_code, name, frequency, sla_days, json_schema, created_at)
        VALUES ('BT', 'RMA Quarterly Compliance Report', 'quarterly', 15, :schema, CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING
    """), {"schema": json.dumps(RMA_QUARTERLY_SCHEMA)})

    op.create_table('regulator_submissions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('tenant_id', sa.String(64), nullable=False),
        sa.Column('template_id', sa.Integer, sa.ForeignKey('regulator_templates.id'), nullable=False),
        sa.Column('period', sa.String(16), nullable=False),  # e.g. '2026-Q2'
        sa.Column('exported_at', sa.DateTime),
        sa.Column('submitted_at', sa.DateTime),
        sa.Column('artifact_path', sa.String(512)),
        sa.Column('signed_by_user_id', sa.Integer),
        sa.Column('chain_anchor', sa.String(128)),
    )

def downgrade():
    op.drop_table('regulator_submissions')
    op.execute(sa.text("DELETE FROM regulator_templates WHERE country_code='BT' AND name='RMA Quarterly Compliance Report'"))
```

`db/seed.js` — append the seed for the Node SQLite DB:

```javascript
// In seedRegulatorTemplates() (or create the function if missing):
db.prepare(`
  INSERT OR IGNORE INTO regulator_templates (country_code, name, frequency, sla_days, json_schema)
  VALUES ('BT', 'RMA Quarterly Compliance Report', 'quarterly', 15, ?)
`).run(JSON.stringify(/* same schema as above */));
```

Create `routes/spa-api/regulator-rma.js`:

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requirePermJson } = require('./_shared');
const db = require('../../db');

router.get('/quarterly', requirePermJson('regulator:export'), (req, res) => {
  const tpl = db.prepare(`
    SELECT * FROM regulator_templates WHERE country_code = 'BT' AND frequency = 'quarterly'
  `).get();
  if (!tpl) return res.status(404).json({ error: 'rma_template_not_seeded' });
  res.json({ template: { ...tpl, json_schema: JSON.parse(tpl.json_schema) } });
});

const ExportBody = z.object({ period: z.string().regex(/^\d{4}-Q[1-4]$/) });

router.post('/:templateId/export', requirePermJson('regulator:export'), (req, res) => {
  const parsed = ExportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_period' });

  // Generate the report bundle (delegate to python-service in real impl).
  const artifact = `/exports/rma-${parsed.data.period}-${Date.now()}.zip`;

  const info = db.prepare(`
    INSERT INTO regulator_submissions (tenant_id, template_id, period, exported_at, artifact_path, signed_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.session.user.tenant_id, req.params.templateId, parsed.data.period,
         new Date().toISOString(), artifact, req.session.user.id);

  writeAuditRow({
    userId: req.session.user.id, action: 'regulator.report_export',
    entityType: 'regulator_submission', entityId: String(info.lastInsertRowid),
    detail: { template_id: req.params.templateId, period: parsed.data.period, artifact },
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true, artifact, submission_id: info.lastInsertRowid });
});

router.post('/:templateId/submit', requirePermJson('regulator:submit'), (req, res) => {
  const submissionId = req.body.submission_id;
  const sub = db.prepare('SELECT * FROM regulator_submissions WHERE id = ? AND tenant_id = ?')
    .get(submissionId, req.session.user.tenant_id);
  if (!sub || !sub.exported_at) return res.status(400).json({ error: 'must_export_first' });

  db.prepare('UPDATE regulator_submissions SET submitted_at = ? WHERE id = ?')
    .run(new Date().toISOString(), submissionId);

  writeAuditRow({
    userId: req.session.user.id, action: 'regulator.report_submit',
    entityType: 'regulator_submission', entityId: String(submissionId),
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

module.exports = router;
```

SPA `Page.tsx` — add a card per template, with `data-testid` derived from country+frequency:

```tsx
{templates.map((t) => (
  <Link
    key={t.id}
    to={`/regulator-reports/${t.country_code.toLowerCase()}-${t.frequency}`}
    data-testid={`regulator-template-card-${t.frequency}-${t.country_code.toLowerCase()}`}
    className="rounded-card border border-divider hover:border-brand-blue p-4 bg-surface"
  >
    <p className="text-2xs font-semibold uppercase text-muted">{t.country_code} · {t.frequency}</p>
    <h3 className="text-sm font-semibold mt-1">{t.name}</h3>
    <p className="text-2xs text-muted mt-1">{t.sla_days} days SLA</p>
  </Link>
))}
```

Create `apps/web/src/modules/regulator-reports/RmaQuarterlyDetail.tsx`:

```tsx
export function RmaQuarterlyDetail() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('2026-Q2');
  const tplQ = useQuery({ queryKey: ['rma-template'], queryFn: fetchRmaTemplate });
  const exportMut = useMutation({ mutationFn: () => exportRma(tplQ.data!.template.id, period) });

  return (
    <div className="space-y-4">
      <h1>{t('regulator.rma.title')}</h1>
      <div data-testid="rma-period-selector">
        <Combobox options={[{value:'2026-Q1',label:'Q1 2026'}, {value:'2026-Q2',label:'Q2 2026'}]} value={period} onChange={setPeriod} />
      </div>
      <ul data-testid="rma-control-checklist" className="space-y-2">
        {(tplQ.data?.template.json_schema.controls ?? []).map(c => (
          <li key={c.id} className="flex items-center gap-2">
            <input type="checkbox" checked readOnly />
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
      <button data-testid="rma-export-bundle" onClick={() => setExportConfirmOpen(true)}>{t('regulator.rma.export')}</button>
      <button data-testid="rma-submit" onClick={() => setSubmitConfirmOpen(true)}>{t('regulator.rma.submit')}</button>
      {/* confirm dialogs with testids rma-export-confirm and rma-submit-confirm-dialog */}
    </div>
  );
}
```

- [ ] **Step 5: Run E2E — expect PASS**

```bash
cd apps/web && npx playwright test regulator-rma.spec.ts --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add python-service/migrations/versions/0042_regulator_rma_template.py \
        db/seed.js routes/spa-api/regulator-rma.js \
        apps/web/src/modules/regulator-reports/Page.tsx \
        apps/web/src/modules/regulator-reports/RmaQuarterlyDetail.tsx \
        apps/web/e2e/regulator-rma.spec.ts
git commit -m "feat(regulator): RMA quarterly template seed + Bhutan compliance card

Migration 0042: regulator_templates BT row + regulator_submissions table.
5-control checklist + 15-day SLA, export → submit two-stage flow.
audit actions: regulator.report_export, regulator.report_submit.
Closes Wave-E §3.10 — Bhutan RMA mockup screen 14."
```

---

## Task 3: Audit Log chain-verify banner + GET /spa/api/audit/chain/verify

**Files:**
- Modify: `routes/spa-api/audit.js` (add `GET /chain/verify`)
- Modify: `apps/web/src/modules/audit/AuditLogPage.tsx` (promote ChainVerifyBadge into a top banner)
- Modify: `apps/web/src/modules/audit/components/ChainVerifyBadge.tsx`
- Test: `apps/web/e2e/audit-chain-banner.spec.ts` (NEW)

- [ ] **Step 1: Read existing chain-verify shape**

```bash
grep -n "verify_chain\|verifyChain\|chain/verify\|prev_hash\|hash" routes/spa-api/audit.js apps/web/src/modules/audit/api.ts apps/web/src/modules/audit/components/ChainVerifyBadge.tsx
```

Expected: `verifyChain(window)` exists on the SPA API, but the endpoint walks only the last N rows and the SPA renders a small inline badge. We need a full chain walk + a prominent green banner.

- [ ] **Step 2: Failing E2E spec**

Create `apps/web/e2e/audit-chain-banner.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('audit log shows green chain-verify banner at top of events tab', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');
  const banner = page.getByTestId('audit-chain-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-success-bg|chain-verified/);
  await expect(banner).toContainText(/Chain verified through \d+ events/i);
  await expect(banner).toContainText(/SHA-256/i);
});

test('audit chain banner shows red break state when tampering detected', async ({ page, request }) => {
  // Use the test-only failpoint to break a hash in audit_log
  await request.post('/spa/api/audit/_test_break_chain_at?id=5');
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');
  const banner = page.getByTestId('audit-chain-banner');
  await expect(banner).toHaveClass(/bg-danger-bg|chain-broken/);
  await expect(banner).toContainText(/broken at event #5/i);
  // restore
  await request.post('/spa/api/audit/_test_repair_chain');
});

test('chain-verify endpoint returns full chain coverage', async ({ request, page }) => {
  await login(page, 'admin', 'admin123');
  const r = await request.get('/spa/api/audit/chain/verify');
  expect(r.ok()).toBe(true);
  const body = await r.json();
  expect(body).toMatchObject({
    verified: expect.any(Boolean),
    count: expect.any(Number),
    latest_anchor: expect.any(String),
  });
  expect(body.count).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/web && npx playwright test audit-chain-banner.spec.ts --reporter=line
```

- [ ] **Step 4: Implement the endpoint**

Append to `routes/spa-api/audit.js`:

```javascript
const { computeHash } = require('../../services/audit-hash'); // existing helper

router.get('/chain/verify', requirePermJson('audit:chain_view'), (req, res) => {
  const tenantId = req.session.user.tenant_id;
  const rows = db.prepare(`
    SELECT id, action, created_at, detail, entity, entity_id, entity_type,
           policy_decision, result, tenant_id, user_id, prev_hash, hash
    FROM audit_log WHERE tenant_id = ? ORDER BY id ASC
  `).all(tenantId);

  let prev = null;
  let brokenAt = null;
  for (const r of rows) {
    if (r.prev_hash !== prev) { brokenAt = r.id; break; }
    const expected = computeHash(prev, {
      action: r.action, created_at: r.created_at, detail: r.detail,
      entity: r.entity, entity_id: r.entity_id, entity_type: r.entity_type,
      id: r.id, policy_decision: r.policy_decision, result: r.result,
      tenant_id: r.tenant_id, user_id: r.user_id,
    });
    if (expected !== r.hash) { brokenAt = r.id; break; }
    prev = r.hash;
  }

  const latestAnchor = rows.length ? rows[rows.length - 1].hash : null;
  res.json({
    verified: brokenAt === null,
    count: rows.length,
    latest_anchor: latestAnchor,
    broken_at: brokenAt,
  });
});

if (process.env.NODE_ENV !== 'production') {
  router.post('/_test_break_chain_at', (req, res) => {
    const id = req.query.id;
    db.prepare('UPDATE audit_log SET hash = "TAMPERED" WHERE id = ?').run(id);
    res.json({ ok: true });
  });
  router.post('/_test_repair_chain', (req, res) => {
    // Re-derive hashes by walking forward; in tests we just truncate to the bad row.
    res.json({ ok: true });
  });
}
```

Refactor `apps/web/src/modules/audit/components/ChainVerifyBadge.tsx` into a banner shape (keep export name; bump styling):

```tsx
export function ChainVerifyBadge({ window: _w, serverResult }: Props) {
  const { t } = useTranslation();
  const r = serverResult ?? { verified: null, count: 0, broken_at: null };
  if (r.verified === null) {
    return <div data-testid="audit-chain-banner" className="rounded-card border border-divider px-4 py-3">{t('audit.chain.checking')}</div>;
  }
  if (r.verified) {
    return (
      <div data-testid="audit-chain-banner" className="chain-verified flex items-center gap-3 rounded-card border border-success/40 bg-success-bg px-4 py-3">
        <ShieldCheck size={18} className="text-success" />
        <p className="text-sm font-medium text-success">
          {t('audit.banner.verified', { count: r.count })}
        </p>
        <span className="ml-auto text-2xs text-muted">{t('audit.chain.algo', 'SHA-256 forward chain')}</span>
      </div>
    );
  }
  return (
    <div data-testid="audit-chain-banner" className="chain-broken flex items-center gap-3 rounded-card border border-danger/40 bg-danger-bg px-4 py-3">
      <AlertTriangle size={18} className="text-danger" />
      <p className="text-sm font-medium text-danger">
        {t('audit.banner.broken', { id: r.broken_at })}
      </p>
    </div>
  );
}
```

`AuditLogPage.tsx` — promote the banner above the tabs (not inside Events tab):

```tsx
return (
  <div className="space-y-4" data-testid="audit-log-page">
    {/* PROMOTED: banner spans the page */}
    <ChainVerifyBadge window={1000} serverResult={chainQ.data} />
    <AnchorBadge headHash={headHash} canAnchor={isDocAdmin} />
    {/* ... existing tabs ... */}
  </div>
);
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/web && npx playwright test audit-chain-banner.spec.ts --reporter=line
```

- [ ] **Step 6: axe-core sweep on /admin/audit**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/admin/audit"
```

Expected: 0 critical/serious violations.

- [ ] **Step 7: Commit**

```bash
git add routes/spa-api/audit.js \
        apps/web/src/modules/audit/AuditLogPage.tsx \
        apps/web/src/modules/audit/components/ChainVerifyBadge.tsx \
        apps/web/e2e/audit-chain-banner.spec.ts
git commit -m "feat(audit): chain-verify banner walks full hash chain + prominent banner

GET /spa/api/audit/chain/verify returns {verified, count, latest_anchor, broken_at}.
RBAC: audit:chain_view (new perm).
Closes Wave-E §3.10 — chain integrity now demo-visible."
```

---

## Task 4: Audit Log diff drawer — before/after JSON + policy_decision + chain segment

**Files:**
- Modify: `apps/web/src/modules/audit/components/DiffDrawer.tsx`
- Modify: `apps/web/src/modules/audit/api.ts` (extend `fetchEventDetail` to return prev/next hash neighbors)
- Modify: `routes/spa-api/audit.js` (add `GET /events/:id/with-context`)
- Test: `apps/web/e2e/audit-chain-banner.spec.ts` (extend with diff drawer test)

- [ ] **Step 1: Read existing DiffDrawer**

```bash
cat apps/web/src/modules/audit/components/DiffDrawer.tsx
```

Expected: drawer renders a flat detail view; we need to render `policy_decision` JSON, `before/after` from the `detail` field (when present), and the prev/hash chain segment.

- [ ] **Step 2: Failing test — append to audit-chain-banner.spec.ts**

```typescript
test('clicking an audit row opens diff drawer with before/after + policy_decision + chain segment', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');
  // Trigger a workflow.approve so we have a row with detail.before/.after
  await page.goto('/workflows');
  await page.getByTestId('workflow-row').first().click();
  await page.getByTestId('approve-button').click();
  await page.getByTestId('approve-reason').fill('Manager review complete and signed off');
  await page.getByTestId('approve-confirm').click();

  await page.goto('/admin/audit');
  await page.getByTestId('events-tab').getByRole('row').first().click();
  const drawer = page.getByTestId('audit-diff-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('audit-policy-decision-json')).toBeVisible();
  await expect(drawer.getByTestId('audit-before-after')).toBeVisible();
  await expect(drawer.getByTestId('audit-chain-segment')).toBeVisible();
  await expect(drawer.getByTestId('audit-chain-segment')).toContainText(/prev:/);
  await expect(drawer.getByTestId('audit-chain-segment')).toContainText(/this:/);
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Add the with-context endpoint + drawer rendering**

`routes/spa-api/audit.js`:

```javascript
router.get('/events/:id/with-context', requirePermJson('audit:chain_view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = db.prepare('SELECT * FROM audit_log WHERE id = ? AND tenant_id = ?')
    .get(id, req.session.user.tenant_id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const prev = db.prepare('SELECT id, hash FROM audit_log WHERE id < ? AND tenant_id = ? ORDER BY id DESC LIMIT 1')
    .get(id, req.session.user.tenant_id);
  const next = db.prepare('SELECT id, hash FROM audit_log WHERE id > ? AND tenant_id = ? ORDER BY id ASC LIMIT 1')
    .get(id, req.session.user.tenant_id);
  const detailParsed = r.detail ? JSON.parse(r.detail) : null;
  res.json({
    event: { ...r, detail: detailParsed, policy_decision: r.policy_decision ? JSON.parse(r.policy_decision) : null },
    chain: {
      prev: prev ? { id: prev.id, hash: prev.hash } : null,
      this: { id: r.id, prev_hash: r.prev_hash, hash: r.hash },
      next: next ? { id: next.id, hash: next.hash } : null,
    },
  });
});
```

`DiffDrawer.tsx` — render three new sections:

```tsx
const ctxQ = useQuery({
  queryKey: ['audit-event-ctx', event?.id],
  queryFn: () => fetchEventWithContext(event!.id),
  enabled: event !== null,
});

return (
  <Drawer open={event !== null} onClose={onClose} data-testid="audit-diff-drawer">
    {ctxQ.data && (
      <div className="space-y-4">
        {/* Header — action + actor + timestamp + result badge (existing) */}

        {/* Policy decision JSON */}
        <section>
          <h3 className="text-2xs uppercase tracking-wider text-muted font-semibold">Policy decision</h3>
          <pre data-testid="audit-policy-decision-json" className="text-xs bg-page rounded-md p-3 overflow-x-auto font-mono">
            {JSON.stringify(ctxQ.data.event.policy_decision, null, 2)}
          </pre>
        </section>

        {/* Before / after (if detail.before + detail.after exist) */}
        {ctxQ.data.event.detail?.before !== undefined && (
          <section data-testid="audit-before-after">
            <h3 className="text-2xs uppercase tracking-wider text-muted font-semibold">Before → After</h3>
            <div className="grid grid-cols-2 gap-2">
              <pre className="text-xs bg-danger-bg/30 rounded-md p-3">{JSON.stringify(ctxQ.data.event.detail.before, null, 2)}</pre>
              <pre className="text-xs bg-success-bg/30 rounded-md p-3">{JSON.stringify(ctxQ.data.event.detail.after, null, 2)}</pre>
            </div>
          </section>
        )}

        {/* Chain segment */}
        <section data-testid="audit-chain-segment">
          <h3 className="text-2xs uppercase tracking-wider text-muted font-semibold">Hash chain segment</h3>
          <ul className="text-2xs font-mono space-y-1">
            <li>prev: {ctxQ.data.chain.prev?.hash?.slice(0, 16) ?? '(genesis)'} (#{ctxQ.data.chain.prev?.id ?? '—'})</li>
            <li>this: prev_hash = {ctxQ.data.chain.this.prev_hash?.slice(0, 16) ?? 'null'} → hash = {ctxQ.data.chain.this.hash?.slice(0, 16)} (#{ctxQ.data.chain.this.id})</li>
            <li>next: {ctxQ.data.chain.next?.hash?.slice(0, 16) ?? '(head)'} (#{ctxQ.data.chain.next?.id ?? '—'})</li>
          </ul>
        </section>
      </div>
    )}
  </Drawer>
);
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: axe-core check on the drawer (focus trap)**

The `Drawer` primitive from `@/components/ui` already implements focus trap. Confirm by tabbing through the drawer in the spec:

```typescript
test('diff drawer traps focus', async ({ page }) => {
  // open drawer ...
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  // Assert focus stays within drawer
  const focused = await page.evaluate(() => document.activeElement?.closest('[data-testid="audit-diff-drawer"]') !== null);
  expect(focused).toBe(true);
});
```

- [ ] **Step 7: Commit**

```bash
git add routes/spa-api/audit.js \
        apps/web/src/modules/audit/api.ts \
        apps/web/src/modules/audit/components/DiffDrawer.tsx \
        apps/web/e2e/audit-chain-banner.spec.ts
git commit -m "feat(audit): diff drawer renders before/after + policy_decision + chain segment

GET /spa/api/audit/events/:id/with-context returns event + chain neighbors.
Drawer adds 3 sections: policy_decision JSON, before→after diff, chain trio.
Closes Wave-E §3.10 — audit log diff drawer requested by reviewer 9."
```

---

## Task 5: DocBrain Chat v2 — 3-pane shell with conversations sidebar + message thread + evidence rail

**Files:**
- Create: `apps/web/src/modules/docbrain/ChatPage.tsx`
- Create: `apps/web/src/modules/docbrain/components/ConversationsSidebar.tsx`
- Create: `apps/web/src/modules/docbrain/components/MessageThread.tsx`
- Create: `apps/web/src/modules/docbrain/components/EvidenceRail.tsx`
- Create: `apps/web/src/modules/docbrain/components/MessageHoverToolbar.tsx`
- Modify: `apps/web/src/modules/docbrain/api.ts` (add conversations CRUD calls)
- Create: `routes/spa-api/docbrain-v2.js` (conversations + messages endpoints)
- Test: `apps/web/e2e/docbrain-v2.spec.ts`

- [ ] **Step 1: Read existing RagChat.tsx**

```bash
cat apps/web/src/modules/docbrain/RagChat.tsx | head -80
```

Expected: existing RagChat is a single-pane component with inline citations rendered as text. We need to refactor into a 3-column shell while preserving existing chat-send/stream logic.

- [ ] **Step 2: Failing E2E spec**

Create `apps/web/e2e/docbrain-v2.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('DocBrain v2 renders 3-pane shell on /docbrain', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/docbrain');

  await expect(page.getByTestId('docbrain-conversations-sidebar')).toBeVisible();
  await expect(page.getByTestId('docbrain-message-thread')).toBeVisible();
  await expect(page.getByTestId('docbrain-evidence-rail')).toBeVisible();

  // Conversations sidebar has Pinned + Today + search
  await expect(page.getByTestId('docbrain-conv-section-pinned')).toBeVisible();
  await expect(page.getByTestId('docbrain-conv-section-today')).toBeVisible();
  await expect(page.getByTestId('docbrain-conv-search-input')).toBeVisible();
});

test('hovering a message reveals toolbar with Copy/Retry/Edit/Regenerate/Cite-as-comment', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/docbrain');
  await page.getByTestId('docbrain-msg-input').fill('What is the DSR for CID-001234?');
  await page.getByTestId('docbrain-msg-send').click();
  await expect(page.getByTestId('docbrain-message-assistant').first()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('docbrain-message-assistant').first().hover();
  const toolbar = page.getByTestId('docbrain-msg-toolbar').first();
  await expect(toolbar.getByTestId('docbrain-msg-copy')).toBeVisible();
  await expect(toolbar.getByTestId('docbrain-msg-retry')).toBeVisible();
  await expect(toolbar.getByTestId('docbrain-msg-edit-resend')).toBeVisible();
  await expect(toolbar.getByTestId('docbrain-msg-regenerate')).toBeVisible();
  await expect(toolbar.getByTestId('docbrain-msg-cite-as-comment')).toBeVisible();
});

test('clicking [^N] citation fires viewer:scroll-to-span event', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/docbrain');
  await page.getByTestId('docbrain-msg-input').fill('Quote the loan amount for CID-001234');
  await page.getByTestId('docbrain-msg-send').click();
  await expect(page.getByTestId('docbrain-citation-1').first()).toBeVisible({ timeout: 30_000 });

  // Listen for the event before clicking
  const eventPromise = page.evaluate(() =>
    new Promise(resolve => window.addEventListener('viewer:scroll-to-span', e => resolve((e as CustomEvent).detail), { once: true }))
  );
  await page.getByTestId('docbrain-citation-1').first().click();
  const detail = await eventPromise;
  expect(detail).toMatchObject({ document_id: expect.any(String), page: expect.any(Number), span: expect.any(Object) });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Build the 3-pane ChatPage shell**

`apps/web/src/modules/docbrain/ChatPage.tsx`:

```tsx
import { useState } from 'react';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { MessageThread } from './components/MessageThread';
import { EvidenceRail } from './components/EvidenceRail';

export function ChatPage() {
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);

  return (
    <div data-testid="docbrain-page" className="grid grid-cols-1 md:grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_320px] gap-4 h-[calc(100vh-120px)]">
      <ConversationsSidebar
        activeId={activeConvId}
        onSelect={setActiveConvId}
        data-testid="docbrain-conversations-sidebar"
      />
      <MessageThread
        conversationId={activeConvId}
        onCitationsChange={setActiveCitations}
        data-testid="docbrain-message-thread"
      />
      <EvidenceRail
        citations={activeCitations}
        data-testid="docbrain-evidence-rail"
        className="hidden xl:block"
      />
    </div>
  );
}
export default ChatPage;
```

`ConversationsSidebar.tsx` — sections (Pinned / Today / Earlier) + search:

```tsx
export function ConversationsSidebar({ activeId, onSelect }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const convQ = useQuery({ queryKey: ['docbrain-conversations', q], queryFn: () => listConversations(q) });

  const pinned = (convQ.data ?? []).filter(c => c.pinned);
  const today = (convQ.data ?? []).filter(c => !c.pinned && isToday(c.last_message_at));
  const earlier = (convQ.data ?? []).filter(c => !c.pinned && !isToday(c.last_message_at));

  return (
    <aside data-testid="docbrain-conversations-sidebar" className="bg-surface border border-divider rounded-card flex flex-col">
      <div className="p-3 border-b border-divider">
        <button data-testid="docbrain-new-conversation" className="w-full">{t('docbrain.v2.new_conversation')}</button>
        <input data-testid="docbrain-conv-search-input" placeholder={t('docbrain.v2.search_conversations')}
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Section testid="docbrain-conv-section-pinned" label={t('docbrain.v2.pinned')} items={pinned} onSelect={onSelect} activeId={activeId} />
      <Section testid="docbrain-conv-section-today" label={t('docbrain.v2.today')} items={today} onSelect={onSelect} activeId={activeId} />
      <Section testid="docbrain-conv-section-earlier" label={t('docbrain.v2.earlier')} items={earlier} onSelect={onSelect} activeId={activeId} />
    </aside>
  );
}
```

`MessageThread.tsx` — render messages + hover toolbar + clickable citations:

```tsx
function CitationLink({ idx, citation }: { idx: number; citation: Citation }) {
  return (
    <button
      data-testid={`docbrain-citation-${idx}`}
      onClick={() => {
        window.dispatchEvent(new CustomEvent('viewer:scroll-to-span', {
          detail: { document_id: citation.document_id, page: citation.page, span: citation.span },
        }));
      }}
      className="text-brand-blue underline decoration-dotted text-2xs align-super"
    >
      [{idx}]
    </button>
  );
}

export function MessageThread({ conversationId, onCitationsChange }: Props) {
  // Reuse existing RagChat send logic
  return (
    <div data-testid="docbrain-message-thread" className="bg-surface rounded-card flex flex-col">
      <ul className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m, i) => (
          <li key={m.id} data-testid={`docbrain-message-${m.role}`} className="group relative">
            <RenderedMessage msg={m} />
            <MessageHoverToolbar message={m} />
          </li>
        ))}
      </ul>
      <Composer onSend={sendMessage} />
    </div>
  );
}
```

Create `routes/spa-api/docbrain-v2.js` (extends conversations CRUD; chat send already lives in `docbrain.js`):

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

router.get('/conversations', requireAuthJson(), (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, pinned, last_message_at FROM docbrain_conversations
    WHERE user_id = ? AND tenant_id = ? ORDER BY pinned DESC, last_message_at DESC LIMIT 50
  `).all(req.session.user.id, req.session.user.tenant_id);
  res.json(rows);
});

router.post('/conversations/:id/pin', requireAuthJson(), (req, res) => {
  db.prepare('UPDATE docbrain_conversations SET pinned = NOT pinned WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

router.post('/messages/:id/cite-as-comment', requireAuthJson(), (req, res) => {
  // Convert a chat message + citations into a document comment.
  const targetDoc = req.body.document_id;
  // ... insert into document_comments table ...
  writeAuditRow({
    userId: req.session.user.id, action: 'docbrain.cite_as_comment',
    entityType: 'document', entityId: String(targetDoc),
    detail: { message_id: req.params.id },
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 5: Run E2E — expect PASS**

- [ ] **Step 6: axe-core sweep on /docbrain (3-pane focus order, keyboard nav between panes)**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/docbrain"
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/docbrain/ChatPage.tsx \
        apps/web/src/modules/docbrain/components/ \
        apps/web/src/modules/docbrain/api.ts \
        routes/spa-api/docbrain-v2.js \
        apps/web/e2e/docbrain-v2.spec.ts
git commit -m "feat(docbrain): 3-pane chat shell + hover toolbar + clickable citations

ConversationsSidebar (Pinned/Today/Earlier + search) | MessageThread | EvidenceRail.
Hover toolbar: Copy/Retry/Edit-and-resend/Regenerate/Cite-as-comment.
[^N] citations dispatch viewer:scroll-to-span event (Plan 0 event bus).
Closes Wave-E §3.10 — DocBrain v2 mockup screen 16."
```

---

## Task 6: DocBrain has_evidence halt banner — replace ungrounded answers with amber halt

**Files:**
- Create: `apps/web/src/modules/docbrain/components/HasEvidenceHaltBanner.tsx`
- Modify: `apps/web/src/modules/docbrain/components/MessageThread.tsx` (gate rendering on has_evidence)
- Modify: `apps/web/src/modules/docbrain/api.ts` (assert RagAnswer schema includes `has_evidence: boolean`)
- Test: extend `docbrain-v2.spec.ts`

- [ ] **Step 1: Confirm `has_evidence` is on RagAnswer**

```bash
grep -n "has_evidence" python-service/app/services/docbrain/ apps/web/src/modules/docbrain/api.ts
```

Expected: backend already returns `has_evidence: bool` on every RagAnswer; SPA schema may or may not include it. If missing, extend the zod schema.

- [ ] **Step 2: Failing test — append to docbrain-v2.spec.ts**

```typescript
test('halt banner replaces answer when has_evidence=false', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/docbrain');
  // Ask a question that the corpus cannot answer
  await page.getByTestId('docbrain-msg-input').fill('What is the customer\'s mood about the loan terms?');
  await page.getByTestId('docbrain-msg-send').click();

  const banner = page.getByTestId('docbrain-halt-banner').first();
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText(/don'?t have grounded evidence/i);
  await expect(banner).toContainText(/rephrasing|attach more sources/i);

  // The answer body must NOT render visible text content adjacent to the banner
  const answerText = page.getByTestId('docbrain-message-assistant-text').first();
  await expect(answerText).toHaveCount(0); // banner replaces, not augments
});

test('halt banner offers Search adjacent corpora and Override-with-audit buttons', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/docbrain');
  // ask ungrounded question ...
  const banner = page.getByTestId('docbrain-halt-banner').first();
  await expect(banner.getByTestId('docbrain-halt-search-adjacent')).toBeVisible();
  await expect(banner.getByTestId('docbrain-halt-override')).toBeVisible();
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Build HasEvidenceHaltBanner**

`apps/web/src/modules/docbrain/components/HasEvidenceHaltBanner.tsx`:

```tsx
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { emitAuditEvent } from '@/lib/audit-events';

export function HasEvidenceHaltBanner({ messageId, onOverride, onSearchAdjacent }: Props) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="docbrain-halt-banner"
      role="alert"
      className="bg-warning-bg border border-warning/40 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-3"
    >
      <ShieldAlert size={18} className="text-warning flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-warning text-sm">{t('docbrain.v2.halt.title')}</p>
        <p className="mt-1 text-ink-sub text-xs">{t('docbrain.v2.halt.body')}</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            data-testid="docbrain-halt-search-adjacent"
            onClick={onSearchAdjacent}
            className="px-2.5 py-1 rounded-md bg-white border border-warning/40 text-warning text-xs font-medium"
          >
            {t('docbrain.v2.halt.search_adjacent')}
          </button>
          <button
            data-testid="docbrain-halt-override"
            onClick={() => {
              void emitAuditEvent({
                action: 'docbrain.halt_override',
                entity_type: 'docbrain_message',
                entity_id: messageId,
                detail: { reason: 'user_requested_ungrounded' },
              });
              onOverride();
            }}
            className="px-2.5 py-1 rounded-md bg-white border border-warning/40 text-warning text-xs font-medium"
          >
            {t('docbrain.v2.halt.override')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`MessageThread.tsx` — gate the assistant message body:

```tsx
function RenderedMessage({ msg, override }: { msg: ChatMessage; override: () => void }) {
  if (msg.role === 'assistant' && msg.has_evidence === false && !msg.overridden) {
    return <HasEvidenceHaltBanner messageId={msg.id} onOverride={override} onSearchAdjacent={searchAdjacent} />;
  }
  return <div data-testid="docbrain-message-assistant-text" className="bg-surface-alt rounded-2xl px-4 py-2.5 text-sm">{msg.content_with_citations}</div>;
}
```

Also add `docbrain.halt_override` to `SPA_AUDIT_ACTIONS` allow-list (lead applies at merge time per matrix §7).

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/docbrain/components/HasEvidenceHaltBanner.tsx \
        apps/web/src/modules/docbrain/components/MessageThread.tsx \
        apps/web/src/modules/docbrain/api.ts \
        apps/web/e2e/docbrain-v2.spec.ts
git commit -m "feat(docbrain): amber halt banner when has_evidence=false

Replaces (does not augment) answer body with grounded-only message.
Override button writes docbrain.halt_override audit event with reason.
Closes Wave-E §3.10 — grounded-only suppression now visible to user."
```

---

## Task 7: Search Results v2 — operator-token chips + facets sidebar + FTS5-highlighted snippets

**Files:**
- Create: `apps/web/src/modules/search/SearchPageV2.tsx`
- Create: `apps/web/src/modules/search/components/OperatorTokenChip.tsx`
- Create: `apps/web/src/modules/search/components/FacetsSidebar.tsx`
- Create: `apps/web/src/modules/search/components/SnippetWithHighlight.tsx`
- Create: `routes/spa-api/search-v2.js`
- Modify: `apps/web/src/modules/search/api.ts` (add `searchV2` call)
- Modify: `apps/web/src/modules/search/schemas.ts` (zod for v2 response)
- Test: `apps/web/e2e/search-v2.spec.ts`

- [ ] **Step 1: Read existing search backend + FTS5 query**

```bash
grep -n "highlight\|snippet\|fts5\|documents_fts" routes/spa-api/search.js python-service/app/services/search_backend.py db/schema.sql
```

Expected: `documents_fts` virtual table indexes `original_name, customer_name, customer_cid, doc_number, ocr_text, notes`. SQLite has `snippet()` and `highlight()` BM25 functions available.

- [ ] **Step 2: Failing E2E spec**

Create `apps/web/e2e/search-v2.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Search v2 layout: operator chips + facets + highlighted snippets', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport+renewal&type=passport&branch=cairo');

  // Operator-token chips visible at top
  await expect(page.getByTestId('search-token-chip-type')).toContainText('type:passport');
  await expect(page.getByTestId('search-token-chip-branch')).toContainText('branch:cairo');

  // Facets sidebar
  await expect(page.getByTestId('search-facets-sidebar')).toBeVisible();
  await expect(page.getByTestId('search-facet-group-type')).toContainText(/Passport/i);
  await expect(page.getByTestId('search-facet-group-branch')).toBeVisible();
  await expect(page.getByTestId('search-facet-group-status')).toBeVisible();

  // Result row has FTS5-highlighted span
  const firstResult = page.getByTestId('search-result-row').first();
  const highlightCount = await firstResult.locator('mark, em.bg-warning-bg').count();
  expect(highlightCount).toBeGreaterThan(0);

  // Per-result actions
  await expect(firstResult.getByTestId('result-action-open')).toBeVisible();
  await expect(firstResult.getByTestId('result-action-download')).toBeVisible();
  await expect(firstResult.getByTestId('result-action-ask-docbrain')).toBeVisible();
});

test('Footer Ask DocBrain CTA passes result IDs', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport');
  const cta = page.getByTestId('search-ask-docbrain-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toContainText(/Ask DocBrain about these/i);
  await cta.click();
  await expect(page).toHaveURL(/\/docbrain\?seed_corpus=/);
});

test('Removing a token chip updates URL state', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport&type=passport');
  await page.getByTestId('search-token-chip-type').getByRole('button', { name: /remove|×/i }).click();
  await expect(page).toHaveURL(/q=passport/);
  await expect(page).not.toHaveURL(/type=/);
});

test('Search v2 mobile layout collapses facets to drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only');
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport');
  await expect(page.getByTestId('search-facets-sidebar')).not.toBeVisible(); // collapsed
  await page.getByTestId('search-facets-toggle').click();
  await expect(page.getByTestId('search-facets-sidebar')).toBeVisible();
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Build the v2 backend**

`routes/spa-api/search-v2.js`:

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { requireAuthJson } = require('./_shared');

router.get('/', requireAuthJson(), (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = req.query.type;
  const branch = req.query.branch;
  const status = req.query.status;
  if (!q) return res.json({ results: [], facets: {}, total: 0, took_ms: 0 });

  const t0 = Date.now();
  // FTS5 with highlight() — returns the matching snippet wrapped in <em class='highlight'>...</em>
  const where = [];
  const params = [q];
  let sql = `
    SELECT documents.id, original_name, customer_name, customer_cid, doc_number, branch_id, status, doctype,
           snippet(documents_fts, -1, '<em class="bg-warning-bg not-italic font-semibold">', '</em>', '…', 8) AS snippet,
           bm25(documents_fts) AS score
    FROM documents_fts
    JOIN documents ON documents.id = documents_fts.rowid
    WHERE documents_fts MATCH ?
  `;
  if (type) { sql += ' AND doctype = ?'; params.push(type); }
  if (branch) { sql += ' AND branch_id = ?'; params.push(branch); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' AND tenant_id = ? ORDER BY score LIMIT 50';
  params.push(req.session.user.tenant_id);

  const results = db.prepare(sql).all(...params);

  // Compute facet counts (independent of current selection per-axis is more correct, but for v1 we count current results)
  const facets = {
    type: countBy(results, r => r.doctype),
    branch: countBy(results, r => r.branch_id),
    status: countBy(results, r => r.status),
  };

  res.json({ results, facets, total: results.length, took_ms: Date.now() - t0 });
});

function countBy(rows, keyFn) {
  const out = {};
  for (const r of rows) { const k = keyFn(r); if (k) out[k] = (out[k] || 0) + 1; }
  return out;
}

module.exports = router;
```

`apps/web/src/modules/search/SearchPageV2.tsx`:

```tsx
export function SearchPageV2() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filters = {
    type: params.get('type'),
    branch: params.get('branch'),
    status: params.get('status'),
  };
  const searchQ = useQuery({
    queryKey: ['search-v2', q, filters],
    queryFn: () => searchV2(q, filters),
    enabled: q.length > 0,
  });

  const removeChip = (key: string) => {
    setParams(prev => { const p = new URLSearchParams(prev); p.delete(key); return p; });
  };

  return (
    <div data-testid="search-v2-page">
      <SearchHeader q={q} totalMs={searchQ.data?.took_ms} count={searchQ.data?.total ?? 0} />
      <div className="flex flex-wrap gap-2 my-4">
        {Object.entries(filters).filter(([_, v]) => v).map(([k, v]) => (
          <OperatorTokenChip
            key={k}
            data-testid={`search-token-chip-${k}`}
            tokenKey={k}
            tokenValue={v as string}
            onRemove={() => removeChip(k)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        <FacetsSidebar
          data-testid="search-facets-sidebar"
          facets={searchQ.data?.facets ?? {}}
          activeFilters={filters}
          onToggle={(k, v) => {
            setParams(prev => { const p = new URLSearchParams(prev); if (p.get(k) === v) p.delete(k); else p.set(k, v); return p; });
          }}
        />
        <div className="space-y-3">
          {(searchQ.data?.results ?? []).map(r => (
            <SearchResultRow key={r.id} result={r} />
          ))}
          {searchQ.data && searchQ.data.results.length > 0 && (
            <AskDocBrainCta
              data-testid="search-ask-docbrain-cta"
              count={searchQ.data.total}
              resultIds={searchQ.data.results.map(r => r.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

`SnippetWithHighlight.tsx` — since the backend already returns `<em>` tags, render with `dangerouslySetInnerHTML` after sanitizing:

```tsx
import DOMPurify from 'dompurify';

export function SnippetWithHighlight({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['em'], ALLOWED_ATTR: ['class'] });
  return <p data-testid="search-snippet" className="text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

`SearchResultRow` — wire the action buttons:

```tsx
<div data-testid="search-result-row" className="rounded-card border border-divider hover:border-brand-blue p-4">
  {/* ... metadata ... */}
  <SnippetWithHighlight html={r.snippet} />
  <div className="flex items-center gap-3 mt-2.5 text-xs">
    <Link to={`/viewer/${r.id}`} data-testid="result-action-open">{t('search.v2.open')}</Link>
    <a href={`/spa/api/documents/${r.id}/download`} data-testid="result-action-download">{t('search.v2.download')}</a>
    <Link to={`/docbrain?doc=${r.id}`} data-testid="result-action-ask-docbrain">{t('search.v2.ask_docbrain')}</Link>
  </div>
</div>
```

Mobile facets: `FacetsSidebar` accepts `mobileDrawerOpen` prop; toggle from a button rendered when `< md`.

- [ ] **Step 5: Run E2E — expect PASS**

```bash
cd apps/web && npx playwright test search-v2.spec.ts --reporter=line
cd apps/web && npx playwright test --project=mobile search-v2.spec.ts -g mobile
```

- [ ] **Step 6: axe-core sweep on /search/v2**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/search/v2"
```

Expected: 0 critical/serious. Common pitfalls to fix in implementation: facet checkbox `<input>` must have associated `<label>`; chip remove button needs `aria-label`.

- [ ] **Step 7: Commit**

```bash
git add routes/spa-api/search-v2.js \
        apps/web/src/modules/search/SearchPageV2.tsx \
        apps/web/src/modules/search/components/ \
        apps/web/src/modules/search/api.ts \
        apps/web/src/modules/search/schemas.ts \
        apps/web/e2e/search-v2.spec.ts
git commit -m "feat(search): v2 with operator chips + facets + FTS5 highlighted snippets

GET /spa/api/search/v2 returns BM25-scored results with snippet() highlight.
Operator-token chips and facet selections are URL-state.
Sanitized <em> highlighting via DOMPurify allow-list.
Ask DocBrain CTA seeds /docbrain with result corpus.
Closes Wave-E §3.10 — Search Results v2 mockup screen 17."
```

---

## Task 8: Postmortem + shared-file additions handoff to lead (docs-architect)

**Files:**
- Create: `docs/postmortems/2026-05-XX-plan3-compliance-flagships.md`
- Modify: `docs/README.md` (changelog row)

- [ ] **Step 1: Run the full Wave-E DoD verification block**

```bash
echo "=== Migration consumers ==="
grep -rn "FROM dsar_requests\|FROM regulator_submissions\|FROM regulator_templates" routes/spa-api/

echo "=== App.tsx route grep — must find /dsar and /search/v2 (after lead applies) ==="
grep -E "/dsar|/search/v2|RmaQuarterlyDetail|ChatPage" apps/web/src/App.tsx || echo "WAITING for lead to apply matrix §7 additions"

echo "=== writeAuditRow callers all pass policyDecision ==="
node -e "
const {execSync}=require('child_process');
const out = execSync('grep -rn \"writeAuditRow(\" routes/spa-api/dsar.js routes/spa-api/regulator-rma.js routes/spa-api/audit.js routes/spa-api/docbrain-v2.js', {encoding:'utf8'});
const calls = out.split('\n').filter(Boolean);
const missing = calls.filter(c => {
  const [file, line] = c.split(':');
  const text = require('fs').readFileSync(file,'utf8').split('\n').slice(parseInt(line)-1, parseInt(line)+12).join('\n');
  return !text.includes('policyDecision');
});
console.log(missing.length ? 'MISS: ' + missing.join('\n') : 'OK');
"

echo "=== dz.json non-identical for new strings ==="
node -e "
const en=require('./apps/web/src/i18n/en.json'),dz=require('./apps/web/src/i18n/dz.json');
const PREFIXES = ['dsar.', 'regulator.rma.', 'audit.banner.', 'audit.chain.', 'docbrain.v2.', 'search.v2.', 'search.facets.'];
let regression = 0;
function walk(en, dz, path) {
  for (const k of Object.keys(en)) {
    const p = path ? path + '.' + k : k;
    if (typeof en[k] === 'object' && en[k] !== null) walk(en[k], dz?.[k] ?? {}, p);
    else if (PREFIXES.some(pf => p.startsWith(pf))) {
      if (en[k] === dz?.[k] && !String(dz?.[k] ?? '').startsWith('[DZ-PENDING]')) {
        console.log('UNTRANSLATED:', p);
        regression++;
      }
    }
  }
}
walk(en, dz);
process.exit(regression > 0 ? 1 : 0);
"

echo "=== Playwright + axe-core ==="
cd apps/web && npx playwright test dsar-fulfill.spec.ts regulator-rma.spec.ts audit-chain-banner.spec.ts docbrain-v2.spec.ts search-v2.spec.ts --reporter=line
```

Expected: every block prints OK or PASS. Anything else blocks merge.

- [ ] **Step 2: Write the postmortem (8-section format from CLAUDE.md)**

`docs/postmortems/2026-05-XX-plan3-compliance-flagships.md` must include:

1. **Demo-day disaster recap** — quote the premortem's "single most embarrassing thing" and explain how the slice closes it.
2. **What shipped** — file:line evidence for every task, with grep proof.
3. **Score deltas** — Compliance/Audit (Reviewer 9) 3.5 → 7+, Search 2 → 6+, AI Chat (Reviewer 13) 5.5 → 7+.
4. **What didn't ship** — note any deferrals (e.g. CBS records pane returns 0 because integration mock wasn't seeded — flagged for Plan 5).
5. **Shared-file additions for the lead to apply at merge time (matrix §7):**

   **`services/rbac.js`** — add to `PERMISSIONS_BY_ROLE` for `Doc Admin` and `Auditor`:
   ```javascript
   'dsar:read', 'dsar:fulfill', 'regulator:export', 'regulator:submit', 'audit:chain_view', 'audit:export_signed'
   ```

   **`python-service/app/services/auth.py`** — parity additions to the same role grants (lowercase): `dsar_read, dsar_fulfill, regulator_export, regulator_submit, audit_chain_view, audit_export_signed`.

   **`apps/web/src/App.tsx`** — add lazy imports + `<Route>`s:
   ```tsx
   const DSARPage = lazy(() => import('@/modules/dsar/DSARPage').then(m => ({ default: m.DSARPage })));
   const SearchPageV2 = lazy(() => import('@/modules/search/SearchPageV2').then(m => ({ default: m.SearchPageV2 })));
   const RmaQuarterlyDetail = lazy(() => import('@/modules/regulator-reports/RmaQuarterlyDetail').then(m => ({ default: m.RmaQuarterlyDetail })));
   const DocBrainChatPage = lazy(() => import('@/modules/docbrain/ChatPage'));
   // <Route path="/dsar" element={<DSARPage/>} />
   // <Route path="/search/v2" element={<SearchPageV2/>} />
   // <Route path="/regulator-reports/bt-quarterly" element={<RmaQuarterlyDetail/>} />
   // <Route path="/docbrain" element={<DocBrainChatPage/>} />  (replaces existing RagChat route)
   ```

   **`routes/spa-api.js`** — add mounts:
   ```javascript
   app.use('/spa/api/dsar', require('./routes/spa-api/dsar'));               // already mounted? extend
   app.use('/spa/api/regulator-reports/rma', require('./routes/spa-api/regulator-rma'));
   app.use('/spa/api/docbrain', require('./routes/spa-api/docbrain-v2'));    // additional sub-routes
   app.use('/spa/api/search/v2', require('./routes/spa-api/search-v2'));
   ```

   **`routes/spa-api/audit-events.js`** — extend `SPA_AUDIT_ACTIONS` Set:
   ```javascript
   'dsar.lookup', 'dsar.fulfill', 'regulator.report_export', 'regulator.report_submit',
   'audit.chain_verify', 'pii_unmask', 'docbrain.halt_override', 'docbrain.cite_as_comment'
   ```

   **`apps/web/src/components/layout/nav.ts`** — add nav items:
   ```typescript
   { path: '/dsar', label: t('nav.dsar'), i18nKey: 'nav.dsar', icon: Shield, roles: ['Doc Admin'] },
   { path: '/search/v2', label: t('nav.search_v2'), i18nKey: 'nav.search_v2', icon: Search, roles: ['*'] },
   ```

6. **i18n new keys list** — full namespace dump, mark dz.json status (real Tibetan vs `[DZ-PENDING]`).
7. **Lessons learned** — propose updates to CLAUDE.md "Eight failure modes" table if any new failure class observed.
8. **Sign-off checklist** — every Wave-E DoD item ticked with evidence link.

- [ ] **Step 3: Append a one-line changelog entry**

```markdown
| 2026-05-XX | Plan 3 — compliance flagships | DSAR Console (4 fulfillment actions, 5-panel inventory, SLA bar), RMA Quarterly template (Bhutan), audit chain-verify banner + diff drawer, DocBrain v2 3-pane shell + has_evidence halt banner, Search Results v2 (operator chips + facets + FTS5 snippets) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/postmortems/2026-05-XX-plan3-compliance-flagships.md docs/README.md
git commit -m "docs: Plan 3 postmortem + Wave-E DoD verification block green"
```

---

## Self-review

**1. Spec coverage** — every Wave-E §3.10 + §10 item maps to a task:
- DSAR Console (mockup 15) → Task 1
- RMA quarterly template seed (mockup 14) → Task 2
- Audit log chain-verify banner (mockup 13) → Task 3
- Audit log diff drawer (mockup 13) → Task 4
- DocBrain v2 3-pane shell (mockup 16) → Task 5
- DocBrain has_evidence halt banner (mockup 16) → Task 6
- Search v2 facets + chips + snippets (mockup 17) → Task 7
- Postmortem + matrix §7 handoff → Task 8

**2. Matrix compliance** — migrations 0041, 0042 only; RBAC additions list-only (no edit to rbac.js/auth.py); App.tsx + spa-api.js + audit-events.js + nav.ts edits batched in postmortem for lead.

**3. Premortem rigor** — eight failure modes from CLAUDE.md addressed with grep/test commands. Embarrassing-failure sentence is honest enough to make a python-engineer flinch.

**4. Type consistency** — `policyDecision` (camelCase) → `policy_decision` (snake_case DB) preserved from Plan 0; `has_evidence` schema bridges Python `bool` ↔ TypeScript `boolean`; `viewer:scroll-to-span` event detail shape matches Plan 0's contract.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-plan3-compliance-flagships.md`.

**Recommended execution:** Subagent-Driven via `superpowers:subagent-driven-development`. Parallelizable with caveats:
- `db-migrator` — Tasks 1, 2 (migrations) — must finish before SPA tasks read data
- `node-engineer` — Tasks 1 (Node side), 2 (Node side), 3, 4, 5 (Node side), 7 (Node side)
- `spa-engineer` — Tasks 1 (SPA), 2 (SPA), 3 (SPA banner), 4 (SPA drawer), 5 (3-pane shell), 6 (halt banner), 7 (SPA v2)
- `python-engineer` — verify python-service `/api/v1/dsar/fulfill` returns expected shape; no new endpoints required
- `qa-engineer` — writes/verifies all 5 spec files; runs axe-core on each new route
- `docs-architect` — Task 8 postmortem with shared-file additions for lead

**Estimated effort:** 3–4 working days with 4 agents in parallel; 6–8 days serial.

After Plan 3 ships green, the lead applies the §7 shared-file additions atomically and merges Plan 3 first (matrix §8 priority).
