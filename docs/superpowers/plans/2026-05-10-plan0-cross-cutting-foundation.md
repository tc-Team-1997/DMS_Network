# Plan 0 — Cross-cutting Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the foundation gaps that every Wave 1/2/3 mockup screen depends on — chrome polish (breadcrumbs, branch+role chip, notifications popover, Cmd-K hints), 5 WCAG Level-A fixes, the `audit_log.policy_decision` column that every mutation needs, the forgot-password flow, and the i18n strings introduced by all the above. After this plan ships, every wave plan can focus purely on its own screens.

**Architecture:** Pure additive — no new modules, no schema breaking changes. Adds one nullable column to `audit_log`, one nullable column pair to `users` (reset_token, reset_token_expires_at), one new route group `/spa/api/auth/forgot-password` + `/reset-password`, one new route `/spa/api/audit/events` for SPA-emitted audit rows, plus targeted SPA edits.

**Tech Stack:** Node 20 + Express + better-sqlite3 (Node gateway), React 18 + TypeScript + Vite + Tailwind (SPA), Playwright (E2E), pytest (Python — not touched here), `nodemailer` for password-reset email (already in dep tree per `node_modules/`), react-i18next + i18next-icu.

**Premortem (feature-architect anchor) — top failure mode for this plan**
> *Single most embarrassing thing if we shipped this badly:* "We added an `audit_log.policy_decision` column, claimed regulator-grade audit, but forgot to populate it from the workflow approval handler — so every approve/reject row still has `policy_decision = NULL` and the SOX defense crumbles in week 2."

Mitigation: Task 2 explicitly grep-checks every `writeAuditRow(` call site after the signature change and rejects merge if any caller passes `policyDecision: undefined`.

---

## File structure

| Layer | File | Change |
|---|---|---|
| DB | `db/schema.sql` | Add `policy_decision TEXT` to `audit_log`, add `reset_token TEXT` + `reset_token_expires_at TEXT` to `users` |
| DB | `db/index.js` | Run `addColumnIfMissing` calls for the three new columns at boot |
| DB | `db/seed.js` | No change (nullable columns) |
| Node service | `services/audit-policy.js` | NEW — builds policy_decision JSON from request context |
| Node service | `services/email.js` | NEW (or extend existing) — sends password-reset email via nodemailer |
| Node route | `routes/spa-api/audit.js` | Extend `writeAuditRow` to accept + persist `policyDecision` |
| Node route | `routes/spa-api/audit-events.js` | NEW — `POST /spa/api/audit/events` for SPA-emitted events |
| Node route | `routes/spa-api/auth.js` (or new `auth-reset.js`) | NEW — `POST /forgot-password`, `POST /reset-password`, `GET /reset-password/:token/validate` |
| Node | `server.js` | Mount audit-events + auth-reset routers |
| SPA token | `apps/web/tailwind.config.ts` | `muted: '#6B6962'`; add `secondary-hover` + `danger-hover` tokens |
| SPA | `apps/web/src/components/ui/Button.tsx:18-20` | Replace raw hex with token references |
| SPA | `apps/web/src/components/ui/Input.tsx:23` | Add `useId()` + `aria-describedby` + `aria-invalid` |
| SPA | `apps/web/src/components/layout/Sidebar.tsx:80-95` | Replace `<Link><div>` with `<Link className=… aria-current=…>` |
| SPA | `apps/web/src/components/layout/AppLayout.tsx` | Add skip-to-content link, `id="main"` on `<main>` |
| SPA | `apps/web/src/components/layout/Topbar.tsx` | Add Breadcrumbs slot + branch+role chip |
| SPA | `apps/web/src/components/layout/Breadcrumbs.tsx` | NEW |
| SPA | `apps/web/src/modules/notifications/NotificationFeed.tsx` | Wrap in 3 tabs (Alerts / Approvals / System) + numeric badge |
| SPA | `apps/web/src/components/CommandPalette.tsx` | Add operator-token hints under search input |
| SPA route | `apps/web/src/modules/auth/LoginPage.tsx` | Add "Forgot password?" link |
| SPA route | `apps/web/src/modules/auth/ForgotPasswordPage.tsx` | NEW |
| SPA route | `apps/web/src/modules/auth/ResetPasswordPage.tsx` | NEW |
| SPA | `apps/web/src/App.tsx` | Route `/forgot-password` and `/reset-password` |
| SPA i18n | `apps/web/src/i18n/en.json` + `dz.json` | Add ~18 new strings (placeholder Tibetan flagged for linguist) |
| Test | `apps/web/e2e/wcag-foundation.spec.ts` | NEW — axe-core sweep on top 5 routes |
| Test | `apps/web/e2e/forgot-password.spec.ts` | NEW |
| Test | `apps/web/e2e/notifications-tabs.spec.ts` | NEW |
| Test | `apps/web/e2e/audit-policy-decision.spec.ts` | NEW — asserts `policy_decision` populated on workflow approve |

---

## Task 1: DB migration — `audit_log.policy_decision` + `users.reset_token`

**Files:**
- Modify: `db/schema.sql:185-200` (audit_log) and the `users` table definition
- Modify: `db/index.js` (boot-time `addColumnIfMissing`)

- [ ] **Step 1: Read the current audit_log schema**

```bash
grep -n "CREATE TABLE IF NOT EXISTS audit_log" -A 25 db/schema.sql
grep -n "CREATE TABLE IF NOT EXISTS users" -A 25 db/schema.sql
grep -n "addColumnIfMissing" db/index.js | head -20
```

Expected: see the existing CREATE TABLE bodies; confirm `audit_log` already has columns `prev_hash`, `hash`, `details`, `detail`, `tenant_id`. Note the line range you'll edit.

- [ ] **Step 2: Add the column to `db/schema.sql`**

Append to the `audit_log` CREATE TABLE — but since the table is created in production, the runtime migration is what matters. Edit `db/schema.sql` so a fresh clone gets the column directly:

```sql
-- in db/schema.sql, inside CREATE TABLE IF NOT EXISTS audit_log (...)
policy_decision TEXT,                  -- NEW: JSON {role, branch, risk_band, opa_allow, opa_reason}
```

And the same for users:

```sql
-- in db/schema.sql, inside CREATE TABLE IF NOT EXISTS users (...)
reset_token TEXT,
reset_token_expires_at TEXT,
```

- [ ] **Step 3: Add boot-time migration in `db/index.js`**

```javascript
// Inside the boot function, after existing addColumnIfMissing calls:
addColumnIfMissing(db, 'audit_log', 'policy_decision', 'TEXT');
addColumnIfMissing(db, 'users', 'reset_token', 'TEXT');
addColumnIfMissing(db, 'users', 'reset_token_expires_at', 'TEXT');
```

- [ ] **Step 4: Verify the migration runs against the live SQLite file**

```bash
node -e "require('./db/index.js'); console.log('boot OK')"
sqlite3 db/nbe-dms.db "PRAGMA table_info(audit_log);" | grep policy_decision
sqlite3 db/nbe-dms.db "PRAGMA table_info(users);" | grep -E 'reset_token|reset_token_expires_at'
```

Expected: each grep returns one matching row with the new column type `TEXT`.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql db/index.js
git commit -m "feat(db): add audit_log.policy_decision and users.reset_token columns

Foundation for Wave-E DoD: every audit row needs OPA decision context;
forgot-password flow needs reset-token storage."
```

---

## Task 2: Extend `writeAuditRow` to persist `policy_decision`

**Files:**
- Create: `services/audit-policy.js`
- Modify: `routes/spa-api/audit.js:76-` (signature + INSERT)
- Test: `routes/spa-api/__tests__/audit.test.js` (or via Playwright spec — Node has no JS test runner per CLAUDE.md, so we use Playwright + curl)

- [ ] **Step 1: Write the failing Playwright spec**

Create `apps/web/e2e/audit-policy-decision.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('approving a workflow writes policy_decision JSON to audit_log', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');

  // Pick the first pending workflow row, approve it.
  await page.goto('/workflows');
  await page.getByTestId('workflow-row').first().click();
  await page.getByTestId('approve-button').click();
  await page.getByTestId('approve-reason').fill('Manager review complete and signed off');
  await page.getByTestId('approve-confirm').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  // Hit the audit log API and assert the latest row has policy_decision populated.
  const r = await request.get('/spa/api/audit?limit=1&action=workflow.approve');
  const body = await r.json();
  expect(body.rows[0].policy_decision).toBeTruthy();
  const decision = JSON.parse(body.rows[0].policy_decision);
  expect(decision).toMatchObject({
    role: expect.any(String),
    tenant_id: expect.any(String),
    opa_allow: true,
  });
});
```

- [ ] **Step 2: Run the spec — confirm it fails**

```bash
cd apps/web && npx playwright test audit-policy-decision.spec.ts --reporter=line
```

Expected: FAIL with `policy_decision` returning `null` or `undefined`.

- [ ] **Step 3: Build the policy_decision JSON helper**

Create `services/audit-policy.js`:

```javascript
'use strict';

/**
 * Build the policy_decision JSON blob persisted alongside every mutation row.
 * Reads from req.session.user (Node session) and the OPA decision if the route
 * called services/abac.js#evaluate().
 */
function buildPolicyDecision(req, { opaAllow = true, opaReason = null } = {}) {
  const u = req.session?.user || {};
  return {
    role: u.role || null,
    tenant_id: u.tenant_id || null,
    branch: u.branch || null,
    risk_band: req.body?.risk_band || null,
    opa_allow: opaAllow,
    opa_reason: opaReason,
    captured_at: new Date().toISOString(),
  };
}

module.exports = { buildPolicyDecision };
```

- [ ] **Step 4: Extend `writeAuditRow` to accept + persist `policyDecision`**

Edit `routes/spa-api/audit.js:76-` — add the param to the destructure, the INSERT, and the rowDict for hash coverage:

```javascript
function writeAuditRow(opts) {
  const {
    userId = null,
    action,
    entity = null,
    entityType = null,
    entityId = null,
    detail = null,
    result = 'allow',
    tenantId,
    policyDecision = null,         // NEW
  } = opts;

  const createdAt = new Date().toISOString();
  const detailJson = detail !== null ? JSON.stringify(detail) : null;
  const policyJson = policyDecision !== null ? JSON.stringify(policyDecision) : null;

  const lastRow = db.prepare(
    'SELECT hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1',
  ).get();
  const prevHash = lastRow ? lastRow.hash : null;

  const insertAndHash = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO audit_log
        (user_id, action, entity, entity_type, entity_id, detail, details, result,
         tenant_id, policy_decision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, entity, entityType, entityId, detailJson, detailJson,
           result, tenantId, policyJson, createdAt);

    const newId = info.lastInsertRowid;

    const rowDict = {
      action, created_at: createdAt, detail: detailJson, entity,
      entity_id: entityId, entity_type: entityType, id: newId,
      policy_decision: policyJson, result, tenant_id: tenantId, user_id: userId,
    };
    const hash = computeHash(prevHash, rowDict);

    db.prepare('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE id = ?')
      .run(prevHash, hash, newId);

    return newId;
  });

  try {
    insertAndHash();
  } catch (e) {
    console.error('[audit] writeAuditRow failed:', e.message);
  }
}
```

- [ ] **Step 5: Update every existing call site to pass `policyDecision`**

```bash
grep -rn "writeAuditRow(" routes/ services/ | grep -v audit.js
```

For each hit, add `policyDecision: buildPolicyDecision(req)` to the opts object. Example for workflow approve in `routes/spa-api/workflows.js`:

```javascript
const { buildPolicyDecision } = require('../../services/audit-policy');
// ...
writeAuditRow({
  userId: req.session.user.id,
  action: 'workflow.approve',
  entity: instance.id,
  entityType: 'workflow_instance',
  detail: { reason, comment },
  tenantId: req.session.user.tenant_id,
  policyDecision: buildPolicyDecision(req, { opaAllow: true }),
});
```

- [ ] **Step 6: Re-run the Playwright spec — confirm it passes**

```bash
cd apps/web && npx playwright test audit-policy-decision.spec.ts --reporter=line
```

Expected: PASS.

- [ ] **Step 7: Reject-merge guard — every writeAuditRow call has policyDecision**

```bash
# Returns nothing (success) when every call site passes policyDecision.
node -e "
const { execSync } = require('child_process');
const out = execSync('grep -rn \"writeAuditRow(\" routes/ services/ | grep -v audit.js', { encoding: 'utf8' });
const calls = out.split('\n').filter(Boolean);
const missing = [];
calls.forEach(c => {
  const file = c.split(':')[0];
  const line = parseInt(c.split(':')[1], 10);
  const fileText = require('fs').readFileSync(file, 'utf8').split('\n');
  const block = fileText.slice(line - 1, line + 12).join('\n');
  if (!block.includes('policyDecision')) missing.push(c);
});
if (missing.length) { console.error('MISSING policyDecision:'); missing.forEach(m => console.error(' ', m)); process.exit(1); }
console.log('OK — all writeAuditRow calls pass policyDecision');
"
```

Expected: `OK — all writeAuditRow calls pass policyDecision`. If FAIL, fix each call before continuing.

- [ ] **Step 8: Commit**

```bash
git add services/audit-policy.js routes/spa-api/audit.js routes/spa-api/workflows.js \
        apps/web/e2e/audit-policy-decision.spec.ts # plus any other route files updated
git commit -m "feat(audit): persist policy_decision JSON on every audit row

Closes Wave-E gap §3.10 — diff drawer can now render OPA decision.
Every writeAuditRow caller updated to pass buildPolicyDecision(req)."
```

---

## Task 3: SPA-emitted audit endpoint — `POST /spa/api/audit/events`

**Files:**
- Create: `routes/spa-api/audit-events.js`
- Modify: `server.js` (mount the router)
- Test: `apps/web/e2e/audit-events.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/e2e/audit-events.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('SPA can emit audit events through /spa/api/audit/events', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');

  const r = await request.post('/spa/api/audit/events', {
    data: {
      action: 'pii_reveal',
      entity_type: 'customer',
      entity_id: 'cust-001',
      detail: { field: 'national_id' },
    },
  });
  expect(r.ok()).toBe(true);

  const list = await request.get('/spa/api/audit?limit=1&action=pii_reveal');
  const body = await list.json();
  expect(body.rows[0]).toMatchObject({
    action: 'pii_reveal',
    entity_type: 'customer',
    entity_id: 'cust-001',
  });
  expect(body.rows[0].policy_decision).toBeTruthy();
});

test('SPA audit endpoint rejects untrusted action prefixes', async ({ request, page }) => {
  await login(page, 'admin', 'admin123');
  const r = await request.post('/spa/api/audit/events', {
    data: { action: 'workflow.approve', entity_type: 'doc', entity_id: '1' },
  });
  expect(r.status()).toBe(400);
});
```

- [ ] **Step 2: Run — expect FAIL with 404**

```bash
cd apps/web && npx playwright test audit-events.spec.ts --reporter=line
```

Expected: FAIL — endpoint not mounted yet.

- [ ] **Step 3: Build the router**

Create `routes/spa-api/audit-events.js`:

```javascript
'use strict';

const express = require('express');
const { z } = require('zod');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requireAuthJson } = require('./_shared');

const router = express.Router();

// Allow-list of action keys the SPA may emit. Anything not here is rejected.
const SPA_AUDIT_ACTIONS = new Set([
  'pii_reveal',
  'pii_mask',
  'document.preview_open',
  'export.csv_requested',
  'export.pdf_requested',
]);

const Body = z.object({
  action: z.string().min(1).max(64),
  entity_type: z.string().min(1).max(64).optional().nullable(),
  entity_id: z.string().min(1).max(128).optional().nullable(),
  detail: z.record(z.unknown()).optional().nullable(),
});

router.post('/events', requireAuthJson(), (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  if (!SPA_AUDIT_ACTIONS.has(parsed.data.action)) {
    return res.status(400).json({ error: 'action_not_allowed_from_spa', action: parsed.data.action });
  }

  writeAuditRow({
    userId: req.session.user.id,
    action: parsed.data.action,
    entity: null,
    entityType: parsed.data.entity_type || null,
    entityId: parsed.data.entity_id || null,
    detail: parsed.data.detail || null,
    tenantId: req.session.user.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server.js`**

Find the block where other `/spa/api/*` routers are mounted (search `routes/spa-api/audit`). Add:

```javascript
app.use('/spa/api/audit', require('./routes/spa-api/audit-events'));
```

Note: `audit` and `audit-events` both mount at `/spa/api/audit` — confirm Express merges via the `events` sub-path. If existing audit router has its own routes at the bare path, mount audit-events explicitly:

```javascript
app.use('/spa/api/audit', require('./routes/spa-api/audit-events')); // for /events
app.use('/spa/api/audit', require('./routes/spa-api/audit'));         // existing routes
```

- [ ] **Step 5: Re-run the spec**

```bash
cd apps/web && npx playwright test audit-events.spec.ts --reporter=line
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/spa-api/audit-events.js server.js apps/web/e2e/audit-events.spec.ts
git commit -m "feat(audit): /spa/api/audit/events for SPA-emitted events

Allow-list of safe actions (pii_reveal, document.preview_open, etc).
Every event writes through writeAuditRow + buildPolicyDecision."
```

---

## Task 4: Customer 360 PII reveal emits audit event

**Files:**
- Modify: `apps/web/src/modules/customer-360/components/PiiRevealField.tsx:35-` (add audit emit on success)
- Modify: `apps/web/src/modules/customer-360/api.ts` (add `emitAuditEvent` helper, OR confirm `revealPii` server endpoint already audits)
- Test: extend `apps/web/e2e/customer-360.spec.ts` or new `pii-reveal-audit.spec.ts`

- [ ] **Step 1: Verify the backend `revealPii` endpoint behaviour**

```bash
grep -rn "revealPii\|reveal_pii\|/pii/reveal" python-service/app/routers/ routes/ services/ | head
```

Expected: find the route handler. **If it already calls `writeAuditRow` (Node) or `record_audit` (Python) with `action='pii_reveal'`, this task is no-op. Skip to Task 5.** If it does not, continue with Step 2.

- [ ] **Step 2: Write the failing spec**

Create `apps/web/e2e/pii-reveal-audit.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('PII reveal on Customer-360 writes a pii_reveal audit row', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');

  // Prep: capture the current max audit_log id for pii_reveal
  const before = await request.get('/spa/api/audit?limit=1&action=pii_reveal');
  const beforeBody = await before.json();
  const beforeId = beforeBody.rows[0]?.id || 0;

  await page.goto('/customers');
  await page.getByTestId('customer-row').first().click();
  await page.getByTestId('pii-reveal-national_id').click();
  await page.getByLabel(/reason/i).fill('KYC review for compliance check');
  await page.getByTestId('pii-reveal-submit-national_id').click();

  await expect(page.getByTestId('pii-revealed-national_id')).toBeVisible();

  // The reveal should have written one new audit row with action='pii_reveal'.
  await expect.poll(async () => {
    const r = await request.get('/spa/api/audit?limit=1&action=pii_reveal');
    const body = await r.json();
    return body.rows[0]?.id || 0;
  }, { timeout: 5000 }).toBeGreaterThan(beforeId);
});
```

- [ ] **Step 3: Run — expect either PASS (already audited server-side) or FAIL (need SPA hook)**

```bash
cd apps/web && npx playwright test pii-reveal-audit.spec.ts --reporter=line
```

- [ ] **Step 4: If FAIL — wire SPA emit on success**

In `apps/web/src/modules/customer-360/components/PiiRevealField.tsx:35-`, edit the `revealMutation`'s `onSuccess`:

```tsx
import { emitAuditEvent } from '@/lib/audit-events'; // new helper

// ...
const revealMutation = useMutation({
  mutationFn: () => revealPii(cid, [field], reason.trim()),
  onSuccess: (data) => {
    const value = data.revealed[field];
    setRevealedValue(typeof value === 'string' ? value : null);
    setShowReasonDialog(false);
    setReason('');
    void emitAuditEvent({
      action: 'pii_reveal',
      entity_type: 'customer',
      entity_id: cid,
      detail: { field, reason: reason.trim() },
    });
  },
  // ...
});
```

Create `apps/web/src/lib/audit-events.ts`:

```typescript
import { http } from './http';
import { z } from 'zod';

const Body = z.object({
  action: z.string(),
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof Body>;

const Resp = z.object({ ok: z.literal(true) });

export async function emitAuditEvent(ev: AuditEvent): Promise<void> {
  await http.post('/spa/api/audit/events', Body.parse(ev), Resp);
}
```

- [ ] **Step 5: Re-run — expect PASS**

```bash
cd apps/web && npx playwright test pii-reveal-audit.spec.ts --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/customer-360/components/PiiRevealField.tsx \
        apps/web/src/lib/audit-events.ts apps/web/e2e/pii-reveal-audit.spec.ts
git commit -m "feat(customer-360): emit pii_reveal audit event on field reveal

Closes Wave-E gap §10.4 — GDPR Art. 32 / PDPL §6 compliance."
```

---

## Task 5: WCAG Level-A sweep (5 sub-edits)

**Files:**
- Modify: `apps/web/tailwind.config.ts:48` and add `secondary-hover` / `danger-hover` tokens
- Modify: `apps/web/src/components/ui/Button.tsx:18-20`
- Modify: `apps/web/src/components/ui/Input.tsx:23`
- Modify: `apps/web/src/components/layout/Sidebar.tsx:80-95`
- Modify: `apps/web/src/components/layout/AppLayout.tsx`
- Test: `apps/web/e2e/wcag-foundation.spec.ts` (NEW)

- [ ] **Step 1: Install axe-core for Playwright**

```bash
cd apps/web && npm install --save-dev @axe-core/playwright
```

- [ ] **Step 2: Write the failing axe-core spec**

Create `apps/web/e2e/wcag-foundation.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

const ROUTES = ['/', '/workflows', '/repository', '/customers', '/audit'];

for (const route of ROUTES) {
  test(`axe-core: ${route} has zero critical or serious violations`, async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const blockers = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (blockers.length) {
      console.error(JSON.stringify(blockers.map(v => ({ id: v.id, nodes: v.nodes.length })), null, 2));
    }
    expect(blockers).toHaveLength(0);
  });
}
```

- [ ] **Step 3: Run — expect FAIL with violations**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --reporter=line
```

Expected output includes violations like `color-contrast` (muted), `aria-current` (sidebar), `label` / `aria-describedby` (Input), `bypass` (skip-link).

- [ ] **Step 4: Fix `--muted` contrast in `tailwind.config.ts:48`**

```typescript
// In apps/web/tailwind.config.ts, theme.extend.colors:
muted: '#6B6962',          // was '#888780' — bumped for WCAG 1.4.3 AA (4.5:1+)

// Add new tokens (used by Task 5 Step 5)
'secondary-hover': '#d0e3fb',
'danger-hover':    '#c73b3a',
```

- [ ] **Step 5: Replace raw hex in `Button.tsx:18-20`**

```tsx
// Before:
//   secondary: '… hover:bg-[#d0e3fb] …'
//   danger:    '… hover:bg-[#c73b3a] …'
// After:
const variants = {
  primary:   '…',
  secondary: '… hover:bg-secondary-hover …',
  danger:    '… hover:bg-danger-hover …',
  ghost:     '…',
};
```

- [ ] **Step 6: Add `useId()` + aria attrs to `Input.tsx:23`**

```tsx
import { useId } from 'react';

export function Input({ label, error, id: idProp, ...rest }: InputProps) {
  const auto = useId();
  const id = idProp ?? auto;
  const errId = `${id}-err`;

  return (
    <div className="field">
      {label && <label className="label" htmlFor={id}>{label}</label>}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        {...rest}
      />
      {error && <span id={errId} className="field-error" role="alert">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 7: Replace `<Link><div>` anti-pattern in `Sidebar.tsx:80-95`**

```tsx
// Before:
//   <Link to={path} className="…">
//     <div className={cls(
//       'h-7 mx-1 px-2 rounded-input text-2xs flex items-center gap-1',
//       isActive ? 'bg-brand-blue text-white' : 'text-sidebar-text hover:bg-sidebar-hover'
//     )}>
//       <Icon size={12} />
//       <span>{label}</span>
//     </div>
//   </Link>
// After:
<Link
  to={path}
  aria-current={isActive ? 'page' : undefined}
  className={cls(
    'h-7 mx-1 px-2 rounded-input text-2xs flex items-center gap-1',
    isActive
      ? 'bg-brand-blue text-white'
      : 'text-sidebar-text hover:bg-sidebar-hover focus-visible:bg-sidebar-hover'
  )}
>
  <Icon size={12} aria-hidden="true" />
  <span>{label}</span>
</Link>
```

- [ ] **Step 8: Add skip-to-content link + `id="main"` in `AppLayout.tsx`**

```tsx
// At the very top of the rendered tree, before <Sidebar /> / <MobileSidebar />:
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:px-3 focus:py-2 focus:bg-surface focus:rounded-input focus:outline-none focus:ring-2 focus:ring-brand-blue"
>
  {t('a11y.skip_to_content', 'Skip to main content')}
</a>

// Then on the existing <main> element, add id="main":
<main id="main" className="…">
  …
</main>
```

- [ ] **Step 9: Re-run axe-core spec — expect 0 critical/serious**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --reporter=line
```

Expected: PASS for all 5 routes. If a violation remains, follow the printed `id` to the failing node and fix.

- [ ] **Step 10: Commit**

```bash
git add apps/web/tailwind.config.ts \
        apps/web/src/components/ui/Button.tsx \
        apps/web/src/components/ui/Input.tsx \
        apps/web/src/components/layout/Sidebar.tsx \
        apps/web/src/components/layout/AppLayout.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/wcag-foundation.spec.ts apps/web/package.json apps/web/package-lock.json
git commit -m "fix(a11y): close 5 WCAG Level-A failures

- muted #888780 → #6B6962 (1.4.3 contrast)
- Sidebar Link>div → Link aria-current (1.4.1, 4.1.2)
- Input useId + aria-describedby + aria-invalid (3.3.1)
- Skip-to-content link + main#main (2.4.1)
- Button raw hex → secondary-hover/danger-hover tokens"
```

---

## Task 6: Topbar — Breadcrumbs + branch+role chip

**Files:**
- Create: `apps/web/src/components/layout/Breadcrumbs.tsx`
- Modify: `apps/web/src/components/layout/Topbar.tsx`
- Modify: `apps/web/src/components/layout/nav.ts` (export breadcrumb labels per route)
- Test: `apps/web/e2e/breadcrumbs.spec.ts` (NEW)

- [ ] **Step 1: Failing test**

Create `apps/web/e2e/breadcrumbs.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Topbar shows breadcrumb trail reflecting the current route', async ({ page }) => {
  await login(page, 'admin', 'admin123');

  await page.goto('/repository');
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Repository/i);

  await page.goto('/workflows?tab=approved');
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Workflows/i);
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Approved/i);
});

test('Topbar shows branch+role chip from session user', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');
  await expect(page.getByTestId('topbar-branch-role-chip'))
    .toContainText(/Doc Admin/i);
});
```

- [ ] **Step 2: Run — expect FAIL with `breadcrumbs not found`**

```bash
cd apps/web && npx playwright test breadcrumbs.spec.ts --reporter=line
```

- [ ] **Step 3: Build `Breadcrumbs.tsx`**

```tsx
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { navItems } from './nav';

interface Crumb { label: string; to?: string; }

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const crumbs: Crumb[] = [{ label: t('nav.home', 'Home'), to: '/' }];

  // Resolve the nav entry for this path.
  const item = navItems.find(n => pathname === n.path || pathname.startsWith(n.path + '/'));
  if (item) crumbs.push({ label: t(item.i18nKey ?? '', item.label), to: item.path });

  // For tab-based routes, append the active tab label.
  const tab = params.get('tab');
  if (tab) crumbs.push({ label: tab[0].toUpperCase() + tab.slice(1) });

  return (
    <nav data-testid="breadcrumbs" aria-label={t('a11y.breadcrumb', 'Breadcrumb')}>
      <ol className="flex items-center gap-1 text-2xs text-muted">
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-divider" aria-hidden="true" />}
            {c.to && i < crumbs.length - 1 ? (
              <Link to={c.to} className="hover:text-ink">
                {i === 0 ? <Home size={11} aria-hidden="true" /> : c.label}
              </Link>
            ) : (
              <span className="text-ink font-medium" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                {i === 0 ? <Home size={11} aria-hidden="true" /> : c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Wire into `Topbar.tsx` — between collapse-toggle and search**

```tsx
import { Breadcrumbs } from './Breadcrumbs';

// In the Topbar JSX, replace the static `module / title` text region with:
<div className="flex-1 flex items-center gap-3 min-w-0">
  <Breadcrumbs />
</div>

// Add the branch+role chip before the avatar block:
<span
  data-testid="topbar-branch-role-chip"
  className="hidden md:inline-flex items-center gap-1 rounded-full bg-brand-skyLight/40 text-brand-navy text-2xs px-2 py-0.5"
  title={`${user.branch ?? ''} · ${user.role}`}
>
  <span className="font-medium">{user.branch ?? t('topbar.no_branch', 'HQ')}</span>
  <span className="text-divider" aria-hidden="true">·</span>
  <span>{user.role}</span>
</span>
```

- [ ] **Step 5: Re-run — expect PASS**

```bash
cd apps/web && npx playwright test breadcrumbs.spec.ts --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/Breadcrumbs.tsx \
        apps/web/src/components/layout/Topbar.tsx \
        apps/web/src/components/layout/nav.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/breadcrumbs.spec.ts
git commit -m "feat(chrome): Topbar breadcrumb trail + branch+role chip

Closes Wave-E IA gap §3.2 — chrome now matches mockup lines 232–283."
```

---

## Task 7: Notifications popover — 3 tabs + numeric badge + severity

**Files:**
- Modify: `apps/web/src/modules/notifications/NotificationFeed.tsx`
- Modify: `apps/web/src/components/layout/Topbar.tsx` (badge count rendering)
- Test: `apps/web/e2e/notifications-tabs.spec.ts` (NEW)

- [ ] **Step 1: Failing test**

```typescript
// apps/web/e2e/notifications-tabs.spec.ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('notifications popover shows 3 tabs and numeric badge', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');
  await expect(page.getByTestId('notif-badge-count')).toBeVisible();
  await expect(page.getByTestId('notif-badge-count')).toHaveText(/^\d+$/);

  await page.getByTestId('notif-bell').click();
  await expect(page.getByTestId('notif-tab-alerts')).toBeVisible();
  await expect(page.getByTestId('notif-tab-approvals')).toBeVisible();
  await expect(page.getByTestId('notif-tab-system')).toBeVisible();

  await page.getByTestId('notif-tab-system').click();
  await expect(page.getByTestId('notif-list')).toBeVisible();
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Refactor `NotificationFeed.tsx` to render tabs**

```tsx
// Bucket each notification into one of three tabs.
function tabFor(n: Notif): 'alerts' | 'approvals' | 'system' {
  if (n.event_type?.startsWith('alert.') || n.severity === 'critical') return 'alerts';
  if (n.channel === 'workflow' || n.event_type?.startsWith('workflow.')) return 'approvals';
  return 'system';
}

// Inside the component:
const [tab, setTab] = useState<'alerts'|'approvals'|'system'>('alerts');
const counts = { alerts: 0, approvals: 0, system: 0 };
notifs.forEach(n => { counts[tabFor(n)] += n.read_at ? 0 : 1; });
const filtered = notifs.filter(n => tabFor(n) === tab);

return (
  <div className="w-[360px]">
    <div role="tablist" className="flex border-b border-divider">
      {(['alerts','approvals','system'] as const).map(t => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          data-testid={`notif-tab-${t}`}
          onClick={() => setTab(t)}
          className={cls(
            'flex-1 px-3 py-2 text-2xs font-medium border-b-2',
            tab === t ? 'border-brand-blue text-brand-navy' : 'border-transparent text-muted hover:text-ink'
          )}
        >
          {t[0].toUpperCase() + t.slice(1)}
          {counts[t] > 0 && (
            <span className={cls(
              'ml-1 rounded-full px-1.5 text-[10px]',
              t === 'alerts' ? 'bg-danger-bg text-danger' :
              t === 'approvals' ? 'bg-warning-bg text-warning' : 'bg-divider text-muted'
            )}>
              {counts[t]}
            </span>
          )}
        </button>
      ))}
    </div>
    <ul data-testid="notif-list" className="max-h-[420px] overflow-auto">
      {filtered.map(n => <NotifRow key={n.id} n={n} />)}
    </ul>
  </div>
);
```

- [ ] **Step 4: Update `Topbar.tsx` badge to render numeric count**

```tsx
const unread = useUnreadCount();   // existing hook
// Replace the old red dot with:
{unread > 0 && (
  <span
    data-testid="notif-badge-count"
    className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-danger text-white text-[10px] font-medium flex items-center justify-center px-1"
    aria-label={t('notif.unread_count', { count: unread })}
  >
    {unread > 99 ? '99+' : unread}
  </span>
)}
```

- [ ] **Step 5: Re-run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/notifications/NotificationFeed.tsx \
        apps/web/src/components/layout/Topbar.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/notifications-tabs.spec.ts
git commit -m "feat(notifications): 3-tab popover + numeric badge

Closes Wave-E gap §3.13 — Alerts/Approvals/System with severity colors."
```

---

## Task 8: Cmd-K palette — operator-token hints

**Files:**
- Modify: `apps/web/src/components/CommandPalette.tsx:283` (add hints row under search input)
- Test: extend an existing palette spec or add `apps/web/e2e/cmdk-hints.spec.ts`

- [ ] **Step 1: Failing test**

```typescript
// apps/web/e2e/cmdk-hints.spec.ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Cmd-K palette shows operator-token hints', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');
  await page.keyboard.press('Meta+K');
  await expect(page.getByTestId('cmdk-hints')).toBeVisible();
  await expect(page.getByTestId('cmdk-hints')).toContainText('cid:');
  await expect(page.getByTestId('cmdk-hints')).toContainText('expiry:');
  await expect(page.getByTestId('cmdk-hints')).toContainText('type:');
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add hints row to `PaletteOverlay`**

```tsx
// Right under the search input element in PaletteOverlay():
<div data-testid="cmdk-hints" className="px-3 py-1.5 border-b border-divider text-[10px] text-muted">
  {t('cmdk.hints', 'Try:')}{' '}
  <code className="text-brand-blue">cid:001234</code>{' · '}
  <code className="text-brand-blue">expiry:&lt;30d</code>{' · '}
  <code className="text-brand-blue">type:passport</code>{' · '}
  <code className="text-brand-blue">branch:thimphu</code>
</div>
```

- [ ] **Step 4: Re-run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CommandPalette.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/cmdk-hints.spec.ts
git commit -m "feat(cmdk): show operator-token hints under palette search input"
```

---

## Task 9: Forgot-password flow

**Files:**
- Create: `services/email.js` (if not present — or extend)
- Create: `routes/spa-api/auth-reset.js`
- Modify: `server.js`
- Modify: `apps/web/src/modules/auth/LoginPage.tsx` (add link)
- Create: `apps/web/src/modules/auth/ForgotPasswordPage.tsx`
- Create: `apps/web/src/modules/auth/ResetPasswordPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/e2e/forgot-password.spec.ts`

- [ ] **Step 1: Failing E2E spec**

```typescript
// apps/web/e2e/forgot-password.spec.ts
import { test, expect } from '@playwright/test';

test('forgot-password → reset-password full flow', async ({ page, request }) => {
  // Request reset.
  await page.goto('/login');
  await page.getByTestId('forgot-password-link').click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel(/username|email/i).fill('admin');
  await page.getByTestId('forgot-submit').click();
  await expect(page.getByTestId('forgot-success')).toBeVisible();

  // Pull the token from the test inbox endpoint (test-only — see Step 5).
  const inbox = await request.get('/spa/api/auth/_test_last_reset_token?username=admin');
  const { token } = await inbox.json();
  expect(token).toBeTruthy();

  // Use the token to set a new password.
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel(/new password/i).fill('newpass123');
  await page.getByLabel(/confirm/i).fill('newpass123');
  await page.getByTestId('reset-submit').click();
  await expect(page).toHaveURL(/\/login/);

  // Confirm new password works.
  await page.getByLabel(/username/i).fill('admin');
  await page.getByLabel(/password/i).fill('newpass123');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/^\/(?!login)/);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Build the Node router**

Create `routes/spa-api/auth-reset.js`:

```javascript
'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../../db');
const { sendResetEmail } = require('../../services/email');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();
const RESET_TTL_MS = 30 * 60 * 1000;   // 30 min

const ForgotBody = z.object({ username: z.string().min(1) });
const ResetBody  = z.object({ token: z.string().min(32), password: z.string().min(8) });

router.post('/forgot-password', (req, res) => {
  const parsed = ForgotBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const u = db.prepare('SELECT id, email, username, tenant_id FROM users WHERE username = ?').get(parsed.data.username);
  // Always 200 to avoid user-enumeration.
  if (!u) return res.json({ ok: true });

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MS).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?')
    .run(token, expires, u.id);

  if (u.email) sendResetEmail(u.email, token).catch(e => console.error('[reset-email]', e.message));

  writeAuditRow({
    userId: u.id, action: 'auth.reset_request', entityType: 'user', entityId: String(u.id),
    detail: { username: u.username }, tenantId: u.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

router.get('/reset-password/:token/validate', (req, res) => {
  const u = db.prepare('SELECT id, reset_token_expires_at FROM users WHERE reset_token = ?').get(req.params.token);
  if (!u) return res.status(404).json({ ok: false, error: 'invalid_token' });
  if (new Date(u.reset_token_expires_at).getTime() < Date.now())
    return res.status(410).json({ ok: false, error: 'expired_token' });
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const parsed = ResetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const u = db.prepare('SELECT id, tenant_id, reset_token_expires_at FROM users WHERE reset_token = ?').get(parsed.data.token);
  if (!u) return res.status(404).json({ error: 'invalid_token' });
  if (new Date(u.reset_token_expires_at).getTime() < Date.now())
    return res.status(410).json({ error: 'expired_token' });

  const hash = await bcrypt.hash(parsed.data.password, 12);
  db.prepare(`
    UPDATE users
       SET password = ?, reset_token = NULL, reset_token_expires_at = NULL
     WHERE id = ?
  `).run(hash, u.id);

  writeAuditRow({
    userId: u.id, action: 'auth.reset_complete', entityType: 'user', entityId: String(u.id),
    tenantId: u.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

// TEST-ONLY helper to fetch the last issued reset token for a username.
// Guarded by NODE_ENV !== 'production' so it never reaches a deployed env.
if (process.env.NODE_ENV !== 'production') {
  router.get('/_test_last_reset_token', (req, res) => {
    const u = db.prepare('SELECT reset_token FROM users WHERE username = ?').get(req.query.username);
    res.json({ token: u?.reset_token || null });
  });
}

module.exports = router;
```

- [ ] **Step 4: Mount in `server.js`**

```javascript
app.use('/spa/api/auth', require('./routes/spa-api/auth-reset'));
```

- [ ] **Step 5: Stub `services/email.js` for dev (logs token; real SMTP in prod via `nodemailer`)**

```javascript
'use strict';
async function sendResetEmail(to, token) {
  if (process.env.NODE_ENV === 'production') {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({ /* read from env */ });
    await t.sendMail({
      to, from: process.env.RESET_EMAIL_FROM || 'no-reply@example.com',
      subject: 'Password reset',
      text: `Click to reset: ${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`,
    });
  } else {
    console.log(`[reset-email] would send token=${token} to=${to}`);
  }
}
module.exports = { sendResetEmail };
```

- [ ] **Step 6: Build SPA pages**

`apps/web/src/modules/auth/ForgotPasswordPage.tsx`:

```tsx
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { http } from '@/lib/http';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

const Resp = z.object({ ok: z.literal(true) });

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await http.post('/spa/api/auth/forgot-password', { username }, Resp).catch(() => {});
          setBusy(false);
          setDone(true);
        }}
        className="w-full max-w-sm space-y-3"
      >
        <h1 className="text-lg font-semibold">{t('auth.forgot_title', 'Reset your password')}</h1>
        {done ? (
          <p data-testid="forgot-success" className="text-2xs text-success">
            {t('auth.forgot_done', 'If that account exists, a reset link has been sent.')}
          </p>
        ) : (
          <>
            <Input
              label={t('auth.username_or_email', 'Username or email')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
            <Button type="submit" data-testid="forgot-submit" disabled={busy || !username}>
              {t('auth.send_reset_link', 'Send reset link')}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}
```

`apps/web/src/modules/auth/ResetPasswordPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { http } from '@/lib/http';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

const Resp = z.object({ ok: z.literal(true) });

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setErr(t('auth.reset_missing_token', 'Missing token')); return; }
    fetch(`/spa/api/auth/reset-password/${token}/validate`).then(r => {
      if (!r.ok) setErr(t('auth.reset_invalid_token', 'Reset link is invalid or expired'));
    });
  }, [token, t]);

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) { setErr(t('auth.reset_mismatch', 'Passwords do not match')); return; }
          setBusy(true);
          try {
            await http.post('/spa/api/auth/reset-password', { token, password: pw }, Resp);
            navigate('/login');
          } catch (e: any) {
            setErr(e?.message || t('auth.reset_failed', 'Reset failed'));
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-sm space-y-3"
      >
        <h1 className="text-lg font-semibold">{t('auth.reset_title', 'Set a new password')}</h1>
        <Input label={t('auth.new_password', 'New password')} type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <Input label={t('auth.confirm_password', 'Confirm password')} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        {err && <p role="alert" className="text-2xs text-danger">{err}</p>}
        <Button type="submit" data-testid="reset-submit" disabled={busy || !pw || !pw2}>
          {t('auth.reset_submit', 'Reset password')}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Add link in `LoginPage.tsx` and routes in `App.tsx`**

```tsx
// In LoginPage.tsx, near the password input footer:
<Link to="/forgot-password" data-testid="forgot-password-link" className="text-2xs text-brand-blue hover:underline">
  {t('auth.forgot_password', 'Forgot password?')}
</Link>

// In App.tsx routes:
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

- [ ] **Step 8: Re-run E2E — expect PASS**

```bash
cd apps/web && npx playwright test forgot-password.spec.ts --reporter=line
```

- [ ] **Step 9: Commit**

```bash
git add routes/spa-api/auth-reset.js services/email.js server.js \
        apps/web/src/modules/auth/ForgotPasswordPage.tsx \
        apps/web/src/modules/auth/ResetPasswordPage.tsx \
        apps/web/src/modules/auth/LoginPage.tsx apps/web/src/App.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/forgot-password.spec.ts
git commit -m "feat(auth): forgot-password + reset-password flow

User enumeration safe (always 200 on forgot-password).
Token TTL 30min, audit-logged on request + complete."
```

---

## Task 10: i18n strings — en.json + dz.json

**Files:**
- Modify: `apps/web/src/i18n/en.json` and `apps/web/src/i18n/dz.json`

- [ ] **Step 1: Collect every new t() key introduced by Tasks 5–9**

```bash
git diff --unified=0 apps/web/src/ | grep -E "t\('([^']+)'" -o | sort -u > /tmp/new-keys.txt
cat /tmp/new-keys.txt
```

- [ ] **Step 2: Add to `en.json`** — paste each key with the English fallback shown in the t() call. Verify file is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/en.json'))"`.

- [ ] **Step 3: Add to `dz.json`** — for each new key:
- If the user-visible string has a known Dzongkha equivalent in the existing dz.json, copy the convention.
- If not, **add the key with a `[DZ-PENDING]` prefix** so the linguist can find them. Example:
  ```json
  "auth.reset_title": "[DZ-PENDING] Set a new password"
  ```
- Track these in a follow-up issue assigned to the linguist contact.

- [ ] **Step 4: Verify dz.json is not byte-identical to en.json for new keys**

```bash
node -e "
const en = require('./apps/web/src/i18n/en.json');
const dz = require('./apps/web/src/i18n/dz.json');
let regression = 0;
for (const k of Object.keys(en)) {
  if (typeof en[k] === 'string' && en[k] === dz[k] && !dz[k].startsWith('[DZ-PENDING]')) {
    console.log('UNTRANSLATED w/o pending tag:', k);
    regression++;
  }
}
process.exit(regression > 0 ? 1 : 0);
"
```

Expected: exit 0 (no untagged regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "i18n: en/dz strings for Plan 0 chrome + WCAG + auth-reset

Strings tagged [DZ-PENDING] await linguist sign-off; tracked in issue."
```

---

## Task 11: Plan 0 postmortem (docs-architect)

**Files:**
- Create: `docs/postmortems/2026-05-XX-plan0-cross-cutting-foundation.md`
- Modify: `docs/README.md` (changelog row)

- [ ] **Step 1: Run the full Wave-E DoD verification block**

```bash
# Hard checks from CLAUDE.md "Definition of Done — Wave-E standard"
echo "=== App.tsx route grep ==="
grep -E "ForgotPasswordPage|ResetPasswordPage" apps/web/src/App.tsx

echo "=== Orphan-table grep (new tables — none in Plan 0, but spot-check)"
grep -rn "policy_decision" routes/ services/

echo "=== writeAuditRow callers all pass policyDecision (re-run Task 2 Step 7)"
node -e "$(cat <<'EOF'
const { execSync } = require('child_process');
const out = execSync('grep -rn "writeAuditRow(" routes/ services/ | grep -v audit.js', {encoding:'utf8'});
const calls = out.split('\n').filter(Boolean);
const missing = calls.filter(c => {
  const [file, line] = c.split(':');
  const text = require('fs').readFileSync(file,'utf8').split('\n').slice(parseInt(line)-1, parseInt(line)+12).join('\n');
  return !text.includes('policyDecision');
});
console.log(missing.length ? 'MISS: ' + missing.join('\n') : 'OK');
EOF
)"

echo "=== dz.json non-identical for new strings (re-run Task 10 Step 4)"
node -e "const en=require('./apps/web/src/i18n/en.json'),dz=require('./apps/web/src/i18n/dz.json');for(const k of Object.keys(en)){if(typeof en[k]==='string'&&en[k]===dz[k]&&!dz[k].startsWith('[DZ-PENDING]'))console.log('UNTRANSLATED:',k)}"

echo "=== Playwright + axe-core green ==="
cd apps/web && npx playwright test --reporter=line
```

- [ ] **Step 2: Write the postmortem** — strict 8-section format from CLAUDE.md "UI/UX premortem + postmortem". Include:
  - File:line evidence for each shipped feature
  - Score deltas: WCAG axis 4.5 → ≥7 (target), Brand/Polish 4.5 → ≥6 (target), Compliance/Audit 7.0 → 7.5 (target via `policy_decision`)
  - The "demo-day disaster" sentence and whether the slice closed it ("Did every writeAuditRow caller get policyDecision? Yes — Task 2 Step 7 grep returned OK.")
  - Lessons → propose any updates to CLAUDE.md eight-failure-modes table

- [ ] **Step 3: Append a one-line changelog entry to `docs/README.md`**

```markdown
| 2026-05-XX | Plan 0 — cross-cutting foundation | audit_log.policy_decision, 5 WCAG Level-A fixes, breadcrumbs, branch+role chip, 3-tab notifications popover, Cmd-K hints, forgot-password flow, dz.json parity check |
```

- [ ] **Step 4: Commit**

```bash
git add docs/postmortems/ docs/README.md
git commit -m "docs: Plan 0 postmortem + Wave-E DoD verification block green"
```

---

## Self-review

**1. Spec coverage** — every Wave-E sprint item from the synthesis maps to a task:
- ✅ DSARPage UI → deferred to Plan 3 (out of scope for Plan 0)
- ✅ RMA template seed → deferred to Plan 3
- ✅ WCAG sweep → Task 5
- ✅ audit_log policy_decision → Tasks 1+2
- ✅ PII reveal audit → Task 4
- ✅ Multi-page redaction wiring → deferred to Plan 1 (Viewer slice)
- ✅ Forgot-password flow → Task 9
- ✅ Breadcrumbs + URL-state → Task 6 (URL-state per-feature deferred to Plan 1/2)
- ✅ Notifications 3-tab popover → Task 7
- BONUS: Cmd-K operator-token hints → Task 8 (closes Reviewer A's gap #4)
- BONUS: SPA-emitted audit endpoint → Task 3 (foundation that PII reveal Task 4 depends on)

**2. Placeholder scan** — re-read every step. No "TBD," no "implement later," no "similar to Task N" without code.

**3. Type consistency** — `policyDecision` (camelCase param) maps to `policy_decision` (snake_case DB column + JSON key); `buildPolicyDecision(req, opts)` signature is consistent across all use sites; `ForgotPasswordPage` / `ResetPasswordPage` exported as default and routed in App.tsx the same way.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-plan0-cross-cutting-foundation.md`.

Recommended execution: **Subagent-Driven** via `superpowers:subagent-driven-development` — fresh subagent per task, two-stage review between tasks, parallelizable across `node-engineer` (Tasks 1–3, 9-Node), `spa-engineer` (Tasks 5–8, 9-SPA), `db-migrator` (Task 1 owns DDL), `qa-engineer` (writes/verifies all spec files), `docs-architect` (Task 11).

After Plan 0 ships green, I'll write **Plan 3 — compliance flagships** (DSARPage, RMA template, audit chain banner, DocBrain v2 shell, Search v2 facets) next, since BoB go-live depends on it.
