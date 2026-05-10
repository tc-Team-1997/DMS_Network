# Plan 2 — Admin & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Branch:** `worktree-wave-e1-plan2-admin-onboarding` (already prepared per the allocation matrix).
> **Base commit:** Plan 0 merged into main at `3acf53d`.
> **Sister plans (parallel worktrees):** Plan 1 (operational polish) · Plan 3 (compliance flagships).

**Goal:** Close every Wave-E gap in the **administration / onboarding / training surface**: a real banking front-door (SSO + MFA + legal banner + last-login disclosure), real user provisioning (factor inventory, SAML admin UI, kill-session), an Indexing station that doesn't feel like a 2008 list, an AML hit-decide modal that closes the false-positive treadmill, schema-versioning *inside* the Learn Wizard so admins stop trusting AI blindly, a Customer-360 drawer that earns its 480px, a workflow Templates designer that knows about Bhutan's monastery-day calendar, and a Mobile viewer + capture surface that survives a Pixel-7 demo. Per the matrix, this plan runs **in parallel** with Plans 1 + 3 — no edits to shared backend files; additions logged in §Postmortem and applied at merge time by the lead.

**Architecture:** Pure additive against the matrix — two Node migrations (0043 `mfa_factors` + `users.mfa_factor_default`; 0044 `tenant_calendars`), three new backend routers (`mfa-management.js`, `saml-test.js`, `calendars.js`), six existing SPA modules **extended** (auth/users/indexing/aml-screening/document-types/customer-360/workflow-templates/viewer), one new SPA route `/customers/:cid` mapped onto the existing `Customer360Drawer`, plus a tightly-scoped mobile breakpoint refactor of `ViewerPage.tsx`.

**Tech Stack:** unchanged from Plan 0 — Node 20 + Express + better-sqlite3 (Node gateway), React 18 + TypeScript + Vite + Tailwind (SPA), Playwright (E2E), pytest (Python — *not* touched here, only RBAC parity edits listed in §Postmortem). PDF.js fluid renderer is reused (already in viewer's `usePdfDocument` hook). WebAuthn step-up reuses `@/lib/step-up` (shipped in Wave A).

**Spec citations:**
- `docs/UI_UX_REVIEW.md` §3.6 (Workflows / SoD), §5.4 (AML hit-decide), §5.5 (Doctypes versioning), §5.6 (Users + RBAC, score 2/10), §5.7 (Login front-door, score 3.5/10), §5.9 (Mobile, 2/10 → 7/10 after Wave D — finish what Wave D started), §7.1 mockup screens 5–12, §10 Top-15 P0 items #10/11/12/13/14/15.
- `docs/superpowers/plans/2026-05-10-wave-e1-allocation-matrix.md` — binding lockfile (this plan's column).
- Mockup `DocManager-Fortune50-Mockup.html` — screens #5/6/7/8/9/10/11/12 (lines 1134–2343).

---

## Premortem (binding) — Phase 0, before any code

> **Demo-day disaster simulation.** Slice ships Friday. A Bank of Bhutan deputy MD demos to the RMA on Monday. What goes wrong?

| # | Wave-E failure mode | Concrete risk for Plan 2 | Mitigation | Owner | Verify command |
|---|---|---|---|---|---|
| 1 | UI without backend | Login v2 ships an "Continue with SSO" button that 404s because SAML isn't configured on the demo tenant. CISO clicks it, blank page, demo dies. | Detect SAML availability via `/spa/api/auth/saml/discover` (returns `{enabled, entryPoint}`) before render; hide the button if `enabled=false` AND surface a toast "SSO not configured for this tenant". Task 1 ships this discover endpoint in same PR. | node-engineer + spa-engineer | `grep -n "saml/discover" routes/spa-api/*.js && grep -n "samlDiscover" apps/web/src/modules/auth/` |
| 2 | Backend without UI | `mfa_factors` table created but nothing reads `mfa_factor_default`; the column stays `NULL` for every user, the "Default factor" pill in MfaTab renders "—" forever. | Task 3 step 5 grep-verifies `mfa_factor_default` is read by at least one endpoint AND rendered in MfaTab. | python-engineer + spa-engineer | `grep -rn "mfa_factor_default" routes/spa-api apps/web/src/modules/users` (must hit ≥3 paths) |
| 3 | Orphan table | `tenant_calendars` migrates but no route reads it; SLA computations still use `business_calendars`. The calendar editor shows BoB monastery days but the workflow engine ignores them. | Task 7 step 4 ships `services/sla.js#nextBusinessDay()` reading `tenant_calendars` first, then falling back to `business_calendars`. Step 5 adds a Playwright spec that creates a workflow on a holiday and asserts due_at lands on the next non-holiday. | db-migrator + node-engineer + qa-engineer | `grep -rn "tenant_calendars" services/ routes/` (must show read site, not just migration) |
| 4 | Decorative AI | The Learn Wizard shows "5/5 ✓" rings but the underlying `agreement_count` is hard-coded. Disagreement banners never appear, so nothing stops a Doc Admin from publishing a bad schema. | Task 5 step 4: `agreement_count` derived from `doctype_field_bbox` rows where `source='confirmed'`; spec asserts ring goes amber on a doctype with intentionally divergent samples. | spa-engineer + qa-engineer | `apps/web/e2e/learn-wizard-versioning.spec.ts` — disagreement scenario must FAIL→PASS through TDD |
| 5 | Dzongkha placebo | Plan 0 wired `npm run i18n:check`. Plan 2 adds ~80 strings. Forgetting to add them to dz.json with `[DZ-PENDING]` tags fails the gate at merge. | Task 9 step 4 runs the parity check as the **last** gate before commit; CI block. | spa-engineer | `cd apps/web && npm run i18n:check` (exit 0) |
| 6 | WCAG Level-A | Hit Decide v2 modal action buttons are 28×28; the "Trust this device" checkbox has no visible label; the Customer-360 doc cards have only colour to convey status. axe-core fails. | Each task has an axe-core sub-step on its own route; AC-defined enforcement: every action button is min-h-[40px]; status badges always carry text + icon (not colour-only). | spa-engineer + qa-engineer | `cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "users\|aml\|indexing\|customers"` |
| 7 | Audit gaps | `mfa.enroll_finish` and `sso.test_run` look like client-side analytics events and never reach `audit_log`. Compliance officer can't show how SAML was tested before go-live. | Task 2 step 6 + Task 3 step 6 + Task 7 step 5 use `writeAuditRow + buildPolicyDecision` from Plan 0; SPA emits route through `/spa/api/audit/events` allow-list. Postmortem lists every action key for lead to add to `SPA_AUDIT_ACTIONS`. | node-engineer + qa-engineer | `grep -rn "writeAuditRow.*action: 'mfa\." routes/spa-api/` (must hit ≥3 sites) |
| 8 | Mobile theatre | The `Open in browser` fallback exists, but on Pixel-7 the **"Continue with SSO"** button overflows the 360px viewport, hidden behind the demo bar. Sales lead taps to switch to credential, the form is visible but the keyboard hides the submit. Demo on stage in Thimphu, dies. | Task 8 ships **mobile breakpoint pass** of LoginPage AND ViewerPage in same PR; touch targets ≥44px enforced via Tailwind class on every viewer button; bottom-sheet AI panel uses `safe-area-inset-bottom`. | spa-engineer + qa-engineer | `cd apps/web && npx playwright test --project=mobile mobile-login.spec.ts mobile-viewer.spec.ts` |

**Single most embarrassing thing if we shipped this badly:** A Doc Admin clicks "Reset MFA" for a user, the modal disappears, and **the user can still log in with the old TOTP factor** because the SPA called `/factors/:fid/disable` but the Node proxy never reached the Python `/api/v1/users-admin/.../webauthn-credentials/:id` endpoint due to a path-mismatch bug — and the audit log still shows `mfa.reset` because the SPA emits the event optimistically before the network round-trip resolves. We just gave a regulator a perfectly logged false positive. Read the team lead the `mfa.reset` Playwright spec aloud at kickoff and confirm it asserts the **server** confirmation, not just the toast.

---

## File structure

| Layer | File | Change |
|---|---|---|
| DB | `db/schema.sql` | Add `CREATE TABLE IF NOT EXISTS mfa_factors (...)` and `CREATE TABLE IF NOT EXISTS tenant_calendars (...)`; add `mfa_factor_default TEXT` to `users` |
| DB | `db/index.js` | Migration 0043 + 0044 boot blocks (idempotent, addColumnIfMissing + table-existence-checked CREATE) |
| DB | `db/seed.js` | Seed BoB monastery-day calendar into `tenant_calendars` for tenant `bob`; seed one demo MFA factor for `admin` user |
| Node service | `services/sla.js` | NEW — `nextBusinessDay(tenant_id, date)` reads `tenant_calendars` first, falls back to `business_calendars` |
| Node service | `services/audit-policy.js` | UNCHANGED (consumed only) |
| Node route | `routes/spa-api/auth-saml-discover.js` | NEW — `GET /spa/api/auth/saml/discover` returns `{enabled, entryPoint}` for the SSO button gating |
| Node route | `routes/spa-api/mfa-management.js` | NEW — `POST /factors/enroll/start`, `POST /factors/enroll/finish`, `POST /factors/:id/reset`, `PUT /users/:id/mfa-default` |
| Node route | `routes/spa-api/saml-test.js` | NEW — `POST /spa/api/admin/saml-idps/:id/test` (extends existing test that returns request XML; adds dry-run claim-mapping evaluator) |
| Node route | `routes/spa-api/calendars.js` | NEW — `GET/POST/PATCH /spa/api/calendars` over `tenant_calendars` |
| Node | `routes/spa-api/users.js` | (Read-only ref; new mfa-management routes mounted **separately** so Plan 2 does not edit this file) |
| Node | `routes/spa-api.js` | NOT EDITED — additions listed in postmortem; lead applies at merge |
| Node | `services/rbac.js` | NOT EDITED — additions listed in postmortem; lead applies at merge |
| Python | `python-service/app/services/auth.py` | NOT EDITED — additions listed in postmortem; lead applies at merge |
| Node | `routes/spa-api/audit-events.js` | NOT EDITED — `SPA_AUDIT_ACTIONS` additions listed in postmortem; lead applies at merge |
| SPA route | `apps/web/src/App.tsx` | NOT EDITED — `/customers/:cid` route addition listed in postmortem; lead applies at merge |
| SPA nav | `apps/web/src/components/layout/nav.ts` | NOT EDITED — Customers entry listed in postmortem; lead applies at merge |
| SPA Login | `apps/web/src/modules/auth/LoginPage.tsx` | EXTEND — add SSO primary button (gated by discover), MFA challenge step, "Trust this device", smart-card / magic-link links, RMA legal banner, last-login disclosure |
| SPA Login | `apps/web/src/modules/auth/components/MfaChallenge.tsx` | NEW — TOTP / WebAuthn challenge step rendered after primary login response shape `{mfa_required: true, factors: [...]}` |
| SPA Login | `apps/web/src/modules/auth/components/LegalBanner.tsx` | NEW — "Authorised use only · RMA circular X/2024" pulled from `tenant_config.auth.legal_banner` |
| SPA Users | `apps/web/src/modules/users/tabs/UsersTab.tsx` | EXTEND — avatar + role + branch chip (HQ ▸ Region ▸ Branch) + MFA factor icons + Source column; 5-step invite stepper drawer |
| SPA Users | `apps/web/src/modules/users/components/InviteStepper.tsx` | NEW — Identity → Role → Branch → MFA → SoD validator preview |
| SPA Users | `apps/web/src/modules/users/components/SoDValidator.tsx` | NEW — runs against role conflicts (Maker + Checker on same user → block) |
| SPA Users | `apps/web/src/modules/users/components/FactorEnroll.tsx` | NEW — TOTP QR / WebAuthn / SMS enroll flow used by both admin reset and self-enroll |
| SPA Users | `apps/web/src/modules/users/tabs/MfaTab.tsx` | EXTEND — factor reset action + default-factor pill + step-up gating banner |
| SPA Users | `apps/web/src/modules/users/tabs/SamlTab.tsx` | EXTEND — claim-mapping inputs (NameID, role, branch); test-SSO returns dry-run claim eval result |
| SPA Users | `apps/web/src/modules/users/tabs/SessionsTab.tsx` | EXTEND — kill-session-by-id + force-logout-all action with reason ≥20 chars |
| SPA Indexing | `apps/web/src/modules/indexing/components/FieldPane.tsx` | EXTEND — wire `AiConfidenceBadge#onOverride` to a real "Override" affordance with audit emit; restore visual indication of override state |
| SPA Indexing | `apps/web/src/modules/indexing/components/PdfPane.tsx` | EXTEND — bbox click-to-fill (already partial — finish wiring `onClick` → focus matching field input) |
| SPA Indexing | `apps/web/src/modules/indexing/hooks/useIndexingKeyboard.ts` | EXTEND — Tab key cycles fields (already J/K + Shift+Enter; add Tab without breaking native nav inside text inputs) |
| SPA AML | `apps/web/src/modules/aml-screening/components/HitDecideV2Modal.tsx` | EXTEND — most already shipped; this task fills the gaps: tokenized name diff legend wired to `tenant_config.aml.token_diff_palette`; "Apply prior verdict" button on DecisionHistoryTab; Adverse-Media tab is enabled (already exists, currently stubbed) |
| SPA AML | `apps/web/src/modules/aml-screening/components/DecisionHistoryTab.tsx` | EXTEND — "Apply prior verdict" button copies notes + decision into Action panel |
| SPA Doctypes | `apps/web/src/modules/document-types/LearnWizard.tsx` | EXTEND — embed Versions tab inside Step 5 (currently surfaces only after publish); solid-green vs dashed-amber bbox styling |
| SPA Doctypes | `apps/web/src/modules/document-types/components/VersionsPanel.tsx` | EXTEND — wire A/B test scaffold (mockup screen 9 shows it); rollback affordance reads from `doctype_versions.status='archived'` and republishes |
| SPA Customer-360 | `apps/web/src/modules/customer-360/components/DocumentsTab.tsx` | EXTEND — doc card with version + status badges (mockup #10) |
| SPA Customer-360 | `apps/web/src/modules/customer-360/components/ActivityTab.tsx` | EXTEND — live filter (action-type chip + branch + date) |
| SPA Customer-360 | `apps/web/src/modules/customer-360/components/WorkflowsTab.tsx` | EXTEND — workflow rows are clickable Links to `/workflows?id={id}` |
| SPA Customer-360 | `apps/web/src/modules/customer-360/CustomerDetailPage.tsx` | NEW — page wrapper around `Customer360Drawer` for the `/customers/:cid` route addition |
| SPA Workflow Templates | `apps/web/src/modules/workflow-templates/components/CalendarEditor.tsx` | EXTEND — render `tenant_calendars` rows above default `business_calendars`; "Use BoB monastery calendar" preset button |
| SPA Workflow Templates | `apps/web/src/modules/workflow-templates/DesignerPage.tsx` | EXTEND — calendar dropdown sources from new `tenant_calendars` API |
| SPA Viewer | `apps/web/src/modules/viewer/ViewerPage.tsx` | EXTEND — mobile breakpoint: replace iframe fallback with PDF.js fluid render at < md; bottom-sheet AI panel on mobile; touch targets ≥44px on toolbar |
| SPA Viewer | `apps/web/src/modules/viewer/components/Toolbar.tsx` | EXTEND — `min-h-[44px] min-w-[44px]` on every toolbar button (banking-grade touch) |
| SPA Viewer | `apps/web/src/modules/viewer/components/MobileBottomSheet.tsx` | NEW — slide-up sheet over PDF, hosts AI/Annotations/Versions tab content on mobile |
| SPA i18n | `apps/web/src/i18n/en.json` + `dz.json` | Add ~80 new strings (placeholder Tibetan flagged with `[DZ-PENDING]`) |
| Test | `apps/web/e2e/login-v2.spec.ts` | NEW — SSO discover, MFA challenge, legal banner, last-login |
| Test | `apps/web/e2e/users-invite-stepper.spec.ts` | NEW — 5 steps; SoD violation blocks at step 5 |
| Test | `apps/web/e2e/mfa-enroll-reset.spec.ts` | NEW — admin-resets-factor flow + audit row written |
| Test | `apps/web/e2e/saml-claim-mapping.spec.ts` | NEW — test-sso returns claim eval; audit row `sso.test_run` |
| Test | `apps/web/e2e/sessions-killall.spec.ts` | NEW — force-logout-all writes audit row, sessions table refreshes |
| Test | `apps/web/e2e/indexing-bbox-click.spec.ts` | NEW — click bbox → field focuses; Tab cycles |
| Test | `apps/web/e2e/aml-prior-verdict.spec.ts` | NEW — Apply prior verdict copies notes |
| Test | `apps/web/e2e/learn-wizard-versioning.spec.ts` | NEW — disagreement amber ring, A/B activate, rollback |
| Test | `apps/web/e2e/customer-360-page.spec.ts` | NEW — direct-link `/customers/CID-001` renders all 6 tabs |
| Test | `apps/web/e2e/calendar-bob.spec.ts` | NEW — BoB tenant adds Zhabdrung Kuchoe; SLA on workflow lands on next business day |
| Test | `apps/web/e2e/mobile-login.spec.ts` | NEW — Pixel-7 viewport, all controls visible, touch ≥44px |
| Test | `apps/web/e2e/mobile-viewer.spec.ts` | NEW — bottom-sheet open, PDF fluid-rendered, no iframe |

---

## Wave-E DoD anchors (cited per task)

Per the matrix and CLAUDE.md, every task in this plan must satisfy:

1. **DB row that proves it works** — every new table seeds at least one canonical row in `db/seed.js` consumed by a Playwright spec.
2. **Routed UI surface** — every claimed UI either hangs off an existing App.tsx `<Route>` (extension) or is documented in §Postmortem for `/customers/:cid` addition by the lead.
3. **RBAC keys parity** — `mfa:enroll, mfa:reset, sod:override, calendar:edit, sso:test, users:invite_send` listed in §Postmortem for both `services/rbac.js` AND `python-service/app/services/auth.py`.
4. **Audit + i18n manifest** — `mfa.enroll_start, mfa.enroll_finish, mfa.reset, sod.violation_override, sso.test_run, calendar.holiday_add` listed in §Postmortem for `SPA_AUDIT_ACTIONS`. ~80 new i18n keys ship with both `en.json` and `dz.json` entries.

---

## Task 1: SAML discover endpoint + Login v2 polish

**Spec:** `docs/UI_UX_REVIEW.md` §5.7 + mockup #5 (lines 1134–1273).

**Files:**
- Create: `routes/spa-api/auth-saml-discover.js`
- Modify: `apps/web/src/modules/auth/LoginPage.tsx`
- Create: `apps/web/src/modules/auth/components/MfaChallenge.tsx`
- Create: `apps/web/src/modules/auth/components/LegalBanner.tsx`
- Test: `apps/web/e2e/login-v2.spec.ts`

**Personas:** Branch Officer at Thimphu Main, Doc Admin at HQ Compliance.

**AC-1** — Given a tenant with SAML configured (`SAML_ENTRY_POINT` set), when the LoginPage mounts, then the "Continue with NBE/BoB Single Sign-On" primary button renders **above** the credentials form and posts to `/sso/saml`. Given SAML not configured, the button is hidden (no 404 on click).
**AC-2** — Given a user enters valid credentials and the server response is `{mfa_required: true, factors: ['totp', 'webauthn']}`, when the form submits, then the credentials form is replaced with `<MfaChallenge>` showing one input per factor; submitting the OTP/passkey completes login.
**AC-3** — Given any login screen, when the page loads, then the legal banner ("Authorised use only · RMA circular X/2024") is visible at the bottom and the last-login string ("Last login: 09:14 Thimphu · 192.0.2.x") renders if the user previously authenticated (read from `localStorage.last_login_meta`).
**AC-4** — Given the page loads on a Pixel-7 viewport (412×915), when measured, then no input/button overflows; SSO and credentials are both visible without scrolling past the keyboard.

- [ ] **Step 1: Failing E2E**

`apps/web/e2e/login-v2.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Plan 2 / AC-1+2+3 — Login v2', () => {
  test('SSO button renders when /auth/saml/discover returns enabled', async ({ page }) => {
    await page.route('**/spa/api/auth/saml/discover', (r) =>
      r.fulfill({ json: { enabled: true, entryPoint: '/sso/saml' } }),
    );
    await page.goto('/login');
    await expect(page.getByTestId('login-sso-primary')).toBeVisible();
    await expect(page.getByTestId('login-sso-primary')).toHaveAttribute('href', /\/sso\/saml/);
  });

  test('SSO button hidden when discover returns disabled', async ({ page }) => {
    await page.route('**/spa/api/auth/saml/discover', (r) =>
      r.fulfill({ json: { enabled: false } }),
    );
    await page.goto('/login');
    await expect(page.getByTestId('login-sso-primary')).toHaveCount(0);
  });

  test('legal banner + last-login disclosure render', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'last_login_meta',
        JSON.stringify({ at: '2026-05-09T09:14:00Z', ip: '192.0.2.5', branch: 'Thimphu' }),
      ),
    );
    await page.goto('/login');
    await expect(page.getByTestId('login-legal-banner')).toBeVisible();
    await expect(page.getByTestId('login-legal-banner')).toContainText(/RMA/i);
    await expect(page.getByTestId('login-last-login')).toContainText(/Thimphu/);
  });

  test('MFA challenge step replaces password form when server signals mfa_required', async ({ page }) => {
    await page.route('**/spa/api/auth/login', async (r, request) => {
      if (request.method() !== 'POST') return r.fallback();
      r.fulfill({ json: { mfa_required: true, factors: ['totp'], challenge_id: 'chal-1' } });
    });
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('sara');
    await page.getByLabel(/password/i).fill('s');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('mfa-challenge-form')).toBeVisible();
    await expect(page.getByLabel(/totp code/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx playwright test login-v2.spec.ts --reporter=line
```

- [ ] **Step 3: Build the discover endpoint**

`routes/spa-api/auth-saml-discover.js`:

```javascript
'use strict';
const express = require('express');
const router = express.Router();

router.get('/auth/saml/discover', (req, res) => {
  const enabled = Boolean(process.env.SAML_ENTRY_POINT && process.env.SAML_IDP_CERT);
  res.json({
    enabled,
    entryPoint: enabled ? '/sso/saml' : null,
    issuer: process.env.SAML_ISSUER || null,
  });
});

module.exports = router;
```

(Mount `/spa/api` line listed in §Postmortem for the lead.)

- [ ] **Step 4: Build `LegalBanner` and `MfaChallenge` components**

`apps/web/src/modules/auth/components/LegalBanner.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useTenantPublic } from '@/store/tenant';

export function LegalBanner() {
  const { t } = useTranslation();
  const tenant = useTenantPublic();
  const text = tenant?.legal_banner ??
    t('auth.legal_default', 'Authorised use only · activity is monitored and logged');
  return (
    <p
      data-testid="login-legal-banner"
      className="mt-4 text-[10px] text-muted text-center px-3 py-2 bg-surface-alt rounded-input"
    >
      {text}
    </p>
  );
}
```

`apps/web/src/modules/auth/components/MfaChallenge.tsx`:

```tsx
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useTranslation } from 'react-i18next';

interface MfaChallengeProps {
  factors: Array<'totp' | 'webauthn' | 'sms'>;
  challengeId: string;
  onSubmit: (factor: string, value: string) => Promise<void>;
}

export function MfaChallenge({ factors, challengeId, onSubmit }: MfaChallengeProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [factor, setFactor] = useState(factors[0] ?? 'totp');
  const [value, setValue] = useState('');

  return (
    <form
      data-testid="mfa-challenge-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSubmit(factor, value); }
        finally { setBusy(false); }
      }}
      className="space-y-3"
    >
      {/* tab strip when ≥2 factors */}
      {factors.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b border-divider">
          {factors.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={factor === f}
              onClick={() => setFactor(f)}
              className={`px-3 py-1.5 text-xs ${factor === f ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-muted'}`}
              data-testid={`mfa-factor-${f}`}
            >
              {t(`auth.mfa.factor_${f}`)}
            </button>
          ))}
        </div>
      )}

      {factor === 'totp' && (
        <Input
          label={t('auth.mfa.totp_label', 'TOTP code')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      )}
      {factor === 'webauthn' && (
        <p className="text-xs text-muted">{t('auth.mfa.webauthn_prompt', 'Touch your security key…')}</p>
      )}
      {factor === 'sms' && (
        <Input
          label={t('auth.mfa.sms_label', 'SMS code')}
          inputMode="numeric"
          maxLength={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      )}

      <Button type="submit" data-testid="mfa-submit" loading={busy} className="w-full">
        {t('auth.mfa.submit', 'Verify and continue')}
      </Button>
      <input type="hidden" name="challenge_id" value={challengeId} />
    </form>
  );
}
```

- [ ] **Step 5: Wire into `LoginPage.tsx`**

In `apps/web/src/modules/auth/LoginPage.tsx`, after the existing imports add:

```tsx
import { LegalBanner } from './components/LegalBanner';
import { MfaChallenge } from './components/MfaChallenge';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { z } from 'zod';

const SamlDiscoverSchema = z.object({
  enabled: z.boolean(),
  entryPoint: z.string().nullable(),
  issuer: z.string().nullable(),
});

function useSamlDiscover() {
  return useQuery({
    queryKey: ['auth', 'saml-discover'],
    queryFn: () => http.get('/spa/api/auth/saml/discover', SamlDiscoverSchema),
    staleTime: 60_000,
  });
}
```

In the `LoginPage` component body, after `useForm`:

```tsx
const samlQ = useSamlDiscover();
const [mfa, setMfa] = useState<{ factors: string[]; challengeId: string } | null>(null);
const lastLoginRaw = typeof window !== 'undefined' ? localStorage.getItem('last_login_meta') : null;
const lastLogin = lastLoginRaw ? JSON.parse(lastLoginRaw) : null;
```

Inside the right-hand sign-in column, **before** the `<form>`, render:

```tsx
{samlQ.data?.enabled && (
  <a
    data-testid="login-sso-primary"
    href={samlQ.data.entryPoint!}
    className="flex items-center justify-center gap-2 w-full h-11 rounded-input bg-brand-blue text-white font-medium hover:bg-brand-blueHover mb-3"
  >
    <ShieldCheck size={16} />
    {t('auth.sso.primary_cta', 'Continue with Single Sign-On')}
  </a>
)}
{samlQ.data?.enabled && (
  <div className="flex items-center gap-3 mb-3">
    <span className="flex-1 h-px bg-divider" />
    <span className="text-[10px] text-muted uppercase tracking-wider">
      {t('auth.sso.divider', 'or sign in with credentials')}
    </span>
    <span className="flex-1 h-px bg-divider" />
  </div>
)}
```

Replace the existing `<form>` with a conditional:

```tsx
{mfa ? (
  <MfaChallenge
    factors={mfa.factors as Array<'totp'|'webauthn'|'sms'>}
    challengeId={mfa.challengeId}
    onSubmit={async (factor, value) => {
      // POST /spa/api/auth/mfa-verify — backend already exists per Wave A step-up
      await http.post('/spa/api/auth/mfa-verify', { challenge_id: mfa.challengeId, factor, value }, z.object({ ok: z.literal(true) }));
      navigate(returnTo, { replace: true });
    }}
  />
) : (
  <form onSubmit={onSubmit} ...>
    {/* existing fields */}
    <label className="flex items-center gap-2 text-xs text-ink-sub">
      <input type="checkbox" data-testid="login-trust-device" />
      {t('auth.trust_device', 'Trust this device for 30 days')}
    </label>
    {/* existing submit + forgot-password link */}
  </form>
)}
{!mfa && <div className="flex justify-center gap-4 mt-3 text-2xs text-brand-blue">
  <a href="#" data-testid="login-smartcard">{t('auth.smartcard', 'Use smart-card')}</a>
  <span className="text-divider">·</span>
  <a href="#" data-testid="login-magic-link">{t('auth.magic_link', 'Magic link via email')}</a>
</div>}
{lastLogin && (
  <p data-testid="login-last-login" className="text-[10px] text-success font-medium mt-3 text-center">
    {t('auth.last_login', { at: lastLogin.at, branch: lastLogin.branch, ip: lastLogin.ip })}
  </p>
)}
<LegalBanner />
```

Update `onSubmit` to detect `mfa_required` in the response:

```tsx
const onSubmit = handleSubmit(async ({ username, password }) => {
  setServerError(null);
  try {
    const res = await login(username, password); // existing zustand action
    if (res?.mfa_required) {
      setMfa({ factors: res.factors, challengeId: res.challenge_id });
      return;
    }
    // existing happy path…
  } catch (err) { /* existing handling */ }
});
```

- [ ] **Step 6: Re-run E2E — expect PASS**

```bash
cd apps/web && npx playwright test login-v2.spec.ts --reporter=line
```

- [ ] **Step 7: axe-core sweep on /login**

```bash
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/login" --reporter=line
```

- [ ] **Step 8: Commit**

```bash
git add routes/spa-api/auth-saml-discover.js \
        apps/web/src/modules/auth/LoginPage.tsx \
        apps/web/src/modules/auth/components/ \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/login-v2.spec.ts
git commit -m "feat(auth): Login v2 — SSO discover + MFA challenge + legal banner + last-login

Closes Wave-E gap §5.7 — Tier-1 RFP login front door.
SSO button gated by /spa/api/auth/saml/discover (no dead 404).
MFA step rendered when server returns mfa_required.
Legal banner + last-login disclosure per RMA/CBE convention."
```

---

## Task 2: MFA management backend — mfa_factors table + factor enroll/reset routes

**Spec:** `docs/UI_UX_REVIEW.md` §5.6 — "MFA is read-only and binary".
**Migration:** **0043** (per matrix).

**Files:**
- Modify: `db/schema.sql` (add `mfa_factors` table + `users.mfa_factor_default` column block)
- Modify: `db/index.js` (boot migration 0043)
- Modify: `db/seed.js` (seed one TOTP factor for `admin` user)
- Create: `routes/spa-api/mfa-management.js`
- Test: `apps/web/e2e/mfa-enroll-reset.spec.ts`

**Personas:** Doc Admin resetting a Maker's lost YubiKey. Maker self-enrolling TOTP.

**AC-1** — Given `mfa_factors` does not exist on a fresh clone, when `node db/seed.js` runs, then the table exists with one canonical row for `admin` (`kind='totp', is_active=1`), and `users.mfa_factor_default = 'totp'` for `admin`.
**AC-2** — Given a Doc Admin POSTs `/spa/api/admin/users/:id/factors/enroll/start` with `{kind:'totp'}`, when accepted, then the response includes `{secret, otpauth_uri, qr_data_url}` and a row is inserted in `mfa_factors` with `is_active=0`.
**AC-3** — Given a pending factor is finished via `/factors/:fid/enroll/finish` with a valid TOTP code, then `is_active=1`, an `audit_log` row with action `mfa.enroll_finish` and `policy_decision` JSON is written.
**AC-4** — Given a Doc Admin POSTs `/factors/:fid/reset` with `reason ≥ 20 chars`, then `is_active=0`, an `audit_log` row `mfa.reset` is written, and the user's `mfa_factor_default` is recomputed to the next active factor (or NULL if none).

- [ ] **Step 1: DB migration 0043 in `db/index.js`**

```javascript
// Migration 0043 — Plan 2: MFA factors inventory.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mfa_factors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      tenant_id       TEXT    NOT NULL DEFAULT 'nbe',
      kind            TEXT    NOT NULL CHECK(kind IN ('totp','webauthn','sms')),
      label           TEXT,
      secret_enc      TEXT,                           -- TOTP secret (base32, KEK-wrapped)
      credential_id   TEXT,                           -- WebAuthn credential id
      phone_last4     TEXT,                           -- SMS factor masked phone
      is_active       INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_at    TEXT,
      last_used_at    TEXT,
      reset_reason    TEXT,
      reset_by        INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mfa_user   ON mfa_factors(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_mfa_tenant ON mfa_factors(tenant_id);
  `);
  addColumnIfMissing('users', 'mfa_factor_default', 'mfa_factor_default TEXT');
  console.log('[db] migration 0043: mfa_factors + users.mfa_factor_default ready.');
} catch (err) {
  console.error('[db] migration 0043 skipped:', err.message);
}
```

Append the same DDL block to `db/schema.sql` so fresh clones get it directly (under the `Migration 0043 — Plan 2` heading).

- [ ] **Step 2: Seed canonical row in `db/seed.js`**

```javascript
// Plan 2 / AC-1 — seed one TOTP factor for admin so MfaTab renders on fresh clone.
const adminRow = db.prepare("SELECT id, tenant_id FROM users WHERE username='admin'").get();
if (adminRow) {
  const exists = db.prepare('SELECT 1 FROM mfa_factors WHERE user_id=? AND kind=\'totp\'').get(adminRow.id);
  if (!exists) {
    db.prepare(`
      INSERT INTO mfa_factors (user_id, tenant_id, kind, label, secret_enc, is_active, activated_at)
      VALUES (?, ?, 'totp', 'Demo TOTP', 'ENC:DEMO_BASE32', 1, datetime('now'))
    `).run(adminRow.id, adminRow.tenant_id);
    db.prepare("UPDATE users SET mfa_factor_default='totp' WHERE id=?").run(adminRow.id);
  }
}
```

- [ ] **Step 3: Verify the migration**

```bash
node -e "require('./db/index.js'); console.log('boot OK')"
sqlite3 db/nbe-dms.db "PRAGMA table_info(mfa_factors);" | head -15
sqlite3 db/nbe-dms.db "PRAGMA table_info(users);" | grep mfa_factor_default
node db/seed.js
sqlite3 db/nbe-dms.db "SELECT user_id, kind, is_active FROM mfa_factors;"
```

Expected: rows present; admin user has `mfa_factor_default='totp'`.

- [ ] **Step 4: Failing E2E**

`apps/web/e2e/mfa-enroll-reset.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Plan 2 / Task 2 — MFA management', () => {
  test('AC-2 enroll start returns secret + qr', async ({ page, request }) => {
    await login(page, 'admin', 'admin123');
    const me = await request.get('/spa/api/me');
    const adminId = (await me.json()).id;
    const r = await request.post(`/spa/api/admin/users/${adminId}/factors/enroll/start`, {
      data: { kind: 'totp', label: 'New phone' },
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.secret).toBeTruthy();
    expect(body.otpauth_uri).toContain('otpauth://totp/');
    expect(body.qr_data_url).toMatch(/^data:image\/(png|svg)/);
    expect(body.factor_id).toBeTruthy();
  });

  test('AC-4 reset disables factor and writes audit row', async ({ page, request }) => {
    await login(page, 'admin', 'admin123');
    // Find sara's existing or seeded factor
    const factors = await request.get('/spa/api/admin/users/2/factors');
    const list = await factors.json();
    if (list.factors.length === 0) test.skip();
    const fid = list.factors[0].id;

    const r = await request.post(`/spa/api/admin/users/2/factors/${fid}/reset`, {
      data: { reason: 'Lost YubiKey reported by ServiceDesk ticket #4421' },
    });
    expect(r.ok()).toBe(true);

    const audit = await request.get('/spa/api/audit?limit=1&action=mfa.reset');
    const ab = await audit.json();
    expect(ab.rows[0]).toBeTruthy();
    expect(ab.rows[0].policy_decision).toBeTruthy();
  });
});
```

- [ ] **Step 5: Build the router**

`routes/spa-api/mfa-management.js`:

```javascript
'use strict';

const express = require('express');
const crypto  = require('crypto');
const QRCode  = require('qrcode');
const speakeasy = require('speakeasy');
const db = require('../../db');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requireAuthJson, tenantScope } = require('./_shared');
const { requirePermJson } = require('../../services/rbac-helpers'); // existing helper

const router = express.Router();

router.use(requireAuthJson);

// --- start enrollment ---------------------------------------------------------
router.post('/admin/users/:id/factors/enroll/start', requirePermJson('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const { kind, label } = req.body || {};
  if (!['totp', 'webauthn', 'sms'].includes(kind)) {
    return res.status(400).json({ error: 'invalid_kind' });
  }

  const u = db.prepare('SELECT id, username, tenant_id FROM users WHERE id=?').get(userId);
  if (!u) return res.status(404).json({ error: 'user_not_found' });

  if (kind === 'totp') {
    const secret = speakeasy.generateSecret({ name: `BoB-DMS:${u.username}`, length: 32 });
    const ins = db.prepare(`
      INSERT INTO mfa_factors (user_id, tenant_id, kind, label, secret_enc, is_active)
      VALUES (?, ?, 'totp', ?, ?, 0)
    `).run(userId, u.tenant_id, label || 'TOTP', secret.base32);
    const otpauth = secret.otpauth_url || `otpauth://totp/${u.username}?secret=${secret.base32}`;
    const qr = await QRCode.toDataURL(otpauth);

    writeAuditRow({
      userId: req.session.user.id, action: 'mfa.enroll_start',
      entityType: 'mfa_factor', entityId: String(ins.lastInsertRowid),
      detail: { for_user: userId, kind },
      tenantId: tenantScope(req),
      policyDecision: buildPolicyDecision(req, { opaAllow: true }),
    });

    return res.json({ factor_id: ins.lastInsertRowid, secret: secret.base32, otpauth_uri: otpauth, qr_data_url: qr });
  }

  // WebAuthn + SMS proxy through Python or use existing services/webauthn.js
  return res.status(501).json({ error: 'kind_not_implemented_yet', kind });
});

// --- finish enrollment --------------------------------------------------------
router.post('/admin/users/:id/factors/:fid/enroll/finish', requirePermJson('admin'), (req, res) => {
  const fid = Number(req.params.fid);
  const code = String(req.body?.code || '');
  const f = db.prepare('SELECT * FROM mfa_factors WHERE id=?').get(fid);
  if (!f) return res.status(404).json({ error: 'factor_not_found' });

  if (f.kind === 'totp') {
    const ok = speakeasy.totp.verify({ secret: f.secret_enc, encoding: 'base32', token: code, window: 1 });
    if (!ok) return res.status(400).json({ error: 'invalid_code' });
  }

  db.prepare('UPDATE mfa_factors SET is_active=1, activated_at=datetime(\'now\') WHERE id=?').run(fid);
  // Set as default if user has none.
  const u = db.prepare('SELECT id, mfa_factor_default FROM users WHERE id=?').get(f.user_id);
  if (!u.mfa_factor_default) {
    db.prepare('UPDATE users SET mfa_factor_default=? WHERE id=?').run(f.kind, u.id);
  }

  writeAuditRow({
    userId: req.session.user.id, action: 'mfa.enroll_finish',
    entityType: 'mfa_factor', entityId: String(fid),
    detail: { for_user: f.user_id, kind: f.kind },
    tenantId: tenantScope(req),
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

// --- reset --------------------------------------------------------------------
router.post('/admin/users/:id/factors/:fid/reset', requirePermJson('admin'), (req, res) => {
  const fid = Number(req.params.fid);
  const reason = String(req.body?.reason || '');
  if (reason.trim().length < 20) {
    return res.status(400).json({ error: 'reason_too_short', min: 20 });
  }
  const f = db.prepare('SELECT * FROM mfa_factors WHERE id=?').get(fid);
  if (!f) return res.status(404).json({ error: 'factor_not_found' });

  db.prepare(`
    UPDATE mfa_factors
       SET is_active=0, reset_reason=?, reset_by=?
     WHERE id=?
  `).run(reason, req.session.user.id, fid);

  // Recompute default
  const next = db.prepare('SELECT kind FROM mfa_factors WHERE user_id=? AND is_active=1 ORDER BY activated_at DESC LIMIT 1').get(f.user_id);
  db.prepare('UPDATE users SET mfa_factor_default=? WHERE id=?').run(next?.kind || null, f.user_id);

  writeAuditRow({
    userId: req.session.user.id, action: 'mfa.reset',
    entityType: 'mfa_factor', entityId: String(fid),
    detail: { for_user: f.user_id, kind: f.kind, reason },
    tenantId: tenantScope(req),
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

// --- update default factor ----------------------------------------------------
router.put('/admin/users/:id/mfa-default', requirePermJson('admin'), (req, res) => {
  const kind = String(req.body?.kind || '');
  if (!['totp','webauthn','sms'].includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
  db.prepare('UPDATE users SET mfa_factor_default=? WHERE id=?').run(kind, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
```

(Mount at `/spa/api` listed in §Postmortem.)

- [ ] **Step 6: Confirm packages installed**

```bash
node -e "require('speakeasy'); require('qrcode'); console.log('OK')"
```

Speakeasy + qrcode are already in `node_modules` from the WebAuthn / step-up ship. If not, **check before adding** — Plan 2 should not introduce new dependencies without lead approval. If missing:

```bash
npm install --save speakeasy qrcode
```

- [ ] **Step 7: Re-run E2E — expect PASS**

```bash
cd apps/web && npx playwright test mfa-enroll-reset.spec.ts --reporter=line
```

- [ ] **Step 8: Commit**

```bash
git add db/schema.sql db/index.js db/seed.js routes/spa-api/mfa-management.js \
        apps/web/e2e/mfa-enroll-reset.spec.ts
git commit -m "feat(mfa): mfa_factors table + enroll/reset/default routes (migration 0043)

Closes Wave-E gap §5.6 — MFA was read-only and binary.
Doc Admin can now reset a factor with reason ≥20 chars; audit row written.
mfa_factor_default recomputed on disable. Speakeasy TOTP + qrcode used."
```

---

## Task 3: Users + Invite v2 — UsersTab columns, InviteStepper, MFA factor row, SoD validator

**Spec:** mockup #6 (lines 1275–~1500); UI/UX §5.6.

**Files:**
- Modify: `apps/web/src/modules/users/tabs/UsersTab.tsx`
- Create: `apps/web/src/modules/users/components/InviteStepper.tsx`
- Create: `apps/web/src/modules/users/components/SoDValidator.tsx`
- Create: `apps/web/src/modules/users/components/FactorEnroll.tsx`
- Modify: `apps/web/src/modules/users/tabs/MfaTab.tsx` (default-pill + reset action)
- Modify: `apps/web/src/modules/users/tabs/SamlTab.tsx` (claim mapping inputs — done in Task 4)
- Modify: `apps/web/src/modules/users/tabs/SessionsTab.tsx` (kill-all action — done in Task 4)
- Test: `apps/web/e2e/users-invite-stepper.spec.ts`

**Personas:** Doc Admin onboarding 6 new branch officers.

**AC-1** — Given UsersTab renders, when a row has multiple MFA factors, then each factor renders as a colored chip (W/T/S = WebAuthn/TOTP/SMS), the default factor has a `★` overlay, and tapping the chip opens a popover listing label + last-used.
**AC-2** — Given the invite drawer opens, when the user clicks "Next" on each step, then the stepper progresses Identity → Role → Branch → MFA → SoD review, and Step 5 calls `POST /spa/api/admin/users/sod-check` with the proposed `{role, branch}` returning `{conflicts: []}` or `{conflicts: ['maker_checker_same_user']}`.
**AC-3** — Given the SoD check returns a conflict, when the admin clicks "Send invite", then the button is disabled and a "Resolve conflicts" callout renders with each conflict label translated from `users.invite.sod.{conflict_key}`.
**AC-4** — Given the role+branch chip on a row, when the user has `branch='Thimphu'`, then the chip renders `HQ ▸ Thimphu` (or the configured region tree from `tenant_config.users.branch_tree`).

- [ ] **Step 1: Failing E2E**

`apps/web/e2e/users-invite-stepper.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Plan 2 / Task 3 — Users + Invite v2', () => {
  test('AC-1 MFA factor chips render per user with default star', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=users');
    const adminRow = page.getByTestId(/^user-row-admin/);
    await expect(adminRow.getByTestId('mfa-chip-totp')).toBeVisible();
    await expect(adminRow.getByTestId('mfa-default-star')).toBeVisible();
  });

  test('AC-2+3 invite stepper blocks SoD violation', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=users');
    await page.getByTestId('user-invite-btn').click();
    // Step 1 — Identity
    await page.getByLabel(/email/i).fill('test.maker@bob.bt');
    await page.getByTestId('invite-next').click();
    // Step 2 — Role
    await page.getByLabel(/role/i).selectOption('Maker');
    await page.getByTestId('invite-next').click();
    // Step 3 — Branch
    await page.getByLabel(/branch/i).fill('Thimphu Main');
    await page.getByTestId('invite-next').click();
    // Step 4 — MFA enforcement preview
    await page.getByTestId('invite-next').click();
    // Step 5 — SoD validator
    await expect(page.getByTestId('invite-sod-summary')).toBeVisible();

    // Now simulate conflict — patch fetch to return conflict on the second invite click.
    await page.route('**/sod-check', (r) => r.fulfill({ json: { conflicts: ['maker_checker_same_user'] } }));
    await page.getByTestId('invite-step-back').click();
    await page.getByTestId('invite-next').click();
    await expect(page.getByTestId('invite-sod-conflict')).toContainText(/Maker.*Checker/);
    await expect(page.getByTestId('invite-submit')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Build `SoDValidator`**

`apps/web/src/modules/users/components/SoDValidator.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

const Resp = z.object({ conflicts: z.array(z.string()) });

export function SoDValidator({ email, role, branch, onValid }: {
  email: string; role: string; branch: string;
  onValid: (valid: boolean) => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['sod-check', email, role, branch],
    queryFn: () => http.post('/spa/api/admin/users/sod-check', { email, role, branch }, Resp),
    enabled: Boolean(email && role && branch),
  });
  const valid = (q.data?.conflicts ?? []).length === 0;
  // Notify parent
  useEffect(() => { onValid(valid); }, [valid, onValid]);

  return (
    <div data-testid="invite-sod-summary" className="rounded-card border p-3 text-xs">
      {q.isLoading && t('users.invite.sod.checking', 'Checking conflicts…')}
      {q.data && valid && (
        <p className="text-success" data-testid="invite-sod-clear">
          ✓ {t('users.invite.sod.clear', 'No segregation-of-duties conflicts.')}
        </p>
      )}
      {q.data && !valid && (
        <ul data-testid="invite-sod-conflict" className="space-y-1 text-danger">
          {q.data.conflicts.map((c) => (
            <li key={c}>{t(`users.invite.sod.${c}`, c)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build `InviteStepper`**

`apps/web/src/modules/users/components/InviteStepper.tsx`:

```tsx
import { useState } from 'react';
import { Button, Input, Combobox } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import { SoDValidator } from './SoDValidator';

const STEPS = ['identity', 'role', 'branch', 'mfa', 'sod'] as const;
type Step = (typeof STEPS)[number];

export function InviteStepper({
  onSubmit,
  pending,
}: {
  onSubmit: (v: { email: string; role: string; branch: string; reason: string }) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('identity');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Viewer');
  const [branch, setBranch] = useState('');
  const [reason, setReason] = useState('');
  const [sodValid, setSodValid] = useState(false);

  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]);

  return (
    <div className="space-y-4">
      {/* Stepper rail */}
      <ol className="flex gap-1 text-2xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            data-testid={`invite-step-${s}`}
            className={`flex-1 px-2 py-1 rounded-input border ${
              i < idx ? 'bg-success-bg border-success/30 text-success' :
              i === idx ? 'bg-brand-skyLight border-brand-blue text-brand-navy' :
              'bg-surface-alt border-divider text-muted'
            }`}
            aria-current={i === idx ? 'step' : undefined}
          >
            {i + 1}. {t(`users.invite.step_${s}`)}
          </li>
        ))}
      </ol>

      {/* Step content */}
      {step === 'identity' && (
        <Input label={t('users.invite.email', 'Email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      )}
      {step === 'role' && (
        <Combobox
          options={['Doc Admin', 'Maker', 'Checker', 'Viewer'].map((r) => ({ value: r, label: r }))}
          value={role}
          onChange={setRole}
          placeholder={t('users.invite.role')}
        />
      )}
      {step === 'branch' && (
        <Input label={t('users.invite.branch', 'Branch')} value={branch} onChange={(e) => setBranch(e.target.value)} />
      )}
      {step === 'mfa' && (
        <p className="text-xs text-ink-sub">
          {t('users.invite.mfa_preview', 'User will be required to enroll an MFA factor on first login.')}
        </p>
      )}
      {step === 'sod' && (
        <>
          <SoDValidator email={email} role={role} branch={branch} onValid={setSodValid} />
          <Input
            label={t('users.invite.reason', 'Reason for invitation')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('users.invite.reason_placeholder', 'min 20 chars')}
          />
        </>
      )}

      {/* Nav buttons */}
      <div className="flex justify-between">
        <Button variant="ghost" disabled={idx === 0} onClick={back} data-testid="invite-step-back">
          {t('users.invite.back', 'Back')}
        </Button>
        {step !== 'sod' ? (
          <Button onClick={next} data-testid="invite-next">{t('users.invite.next', 'Next')}</Button>
        ) : (
          <Button
            data-testid="invite-submit"
            disabled={!sodValid || reason.trim().length < 20 || pending}
            loading={pending}
            onClick={() => onSubmit({ email, role, branch, reason })}
          >
            {t('users.invite.send', 'Send invite')}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Backend SoD check route**

Append to `routes/spa-api/users.js`'s sibling `mfa-management.js` OR create lightweight endpoint inline. **Do NOT edit users.js directly** (avoid file conflicts with Plan 1/3 if any). Add to `routes/spa-api/mfa-management.js`:

```javascript
router.post('/admin/users/sod-check', requirePermJson('admin'), (req, res) => {
  const { email, role } = req.body || {};
  const conflicts = [];
  if (!email || !role) return res.json({ conflicts: ['missing_inputs'] });

  // Maker + Checker on same user → block.
  const existing = db.prepare('SELECT role FROM users WHERE email=?').get(email);
  if (existing) {
    if ((existing.role === 'Maker' && role === 'Checker') ||
        (existing.role === 'Checker' && role === 'Maker')) {
      conflicts.push('maker_checker_same_user');
    }
  }
  res.json({ conflicts });
});
```

- [ ] **Step 6: Replace `InviteForm` in `UsersTab.tsx` with `InviteStepper`**

```tsx
// At top of UsersTab.tsx
import { InviteStepper } from '../components/InviteStepper';

// In the Drawer body:
<Drawer ...>
  <InviteStepper onSubmit={(v) => invite.mutate({ ...v, branch: v.branch || undefined })} pending={invite.isPending} />
</Drawer>
```

- [ ] **Step 7: MFA chip column in users table**

In the existing `columns` array, replace the MFA cell:

```tsx
{
  key: 'mfa',
  header: 'MFA',
  width: 90,
  render: (u) => (
    <div className="flex items-center gap-1" data-testid={`user-row-${u.username}`}>
      {u.mfa_factors?.map((f) => (
        <span
          key={f.id}
          data-testid={`mfa-chip-${f.kind}`}
          title={`${f.label} · last used ${f.last_used_at ?? 'never'}`}
          className={cn(
            'relative w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center',
            f.is_active ? 'bg-success-bg text-success' : 'bg-divider text-muted',
          )}
        >
          {f.kind[0].toUpperCase()}
          {u.mfa_factor_default === f.kind && (
            <span data-testid="mfa-default-star" className="absolute -top-1 -right-1 text-warning">★</span>
          )}
        </span>
      )) ?? <span className="text-2xs text-muted">—</span>}
    </div>
  ),
},
```

(Requires `users.js` to return `mfa_factors` + `mfa_factor_default` — done by extending the existing `GET /spa/api/users` response. **List that 1-line schema addition in §Postmortem.**)

- [ ] **Step 8: Re-run E2E + axe-core**

```bash
cd apps/web && npx playwright test users-invite-stepper.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/users" --reporter=line
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/modules/users/components/ \
        apps/web/src/modules/users/tabs/UsersTab.tsx \
        routes/spa-api/mfa-management.js \
        apps/web/e2e/users-invite-stepper.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(users): InviteStepper + SoD validator + MFA chip column

Closes Wave-E §5.6 — invite is now a 5-step Identity→Role→Branch→MFA→SoD flow.
Maker+Checker conflict blocks send. MFA factors render per-user with default star."
```

---

## Task 4: SAML claim mapping + Sessions kill-all

**Spec:** `docs/UI_UX_REVIEW.md` §5.6 ("No SSO/SAML admin UI… No session control").

**Files:**
- Create: `routes/spa-api/saml-test.js`
- Modify: `apps/web/src/modules/users/tabs/SamlTab.tsx`
- Modify: `apps/web/src/modules/users/tabs/SessionsTab.tsx`
- Test: `apps/web/e2e/saml-claim-mapping.spec.ts`, `apps/web/e2e/sessions-killall.spec.ts`

**AC-1** — Given SamlTab is open and the admin clicks "Test SSO" with a paste of a sample SAML response, when accepted, then the response renders mapped values for `username`, `role`, `branch` from the configured `claim_map_json`, and an `audit_log` row `sso.test_run` with `policy_decision` is written.
**AC-2** — Given SessionsTab is open, when the admin clicks "Force-logout-all" with reason ≥20 chars, then every active session except the admin's is invalidated and the table refreshes within 2 seconds.

- [ ] **Step 1: Failing specs**

`apps/web/e2e/saml-claim-mapping.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1 SAML test-sso evaluates claim mapping and audits', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/users?tab=saml');
  await page.getByTestId('saml-new-btn').click();
  await page.getByLabel(/idp name/i).fill('TestIdP');
  await page.getByLabel(/metadata/i).fill('<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" />');
  await page.getByLabel(/claim map/i).fill('{"username":"NameID","role":"role","branch":"branch"}');
  await page.getByTestId('saml-create-submit').click();
  // Locate test button on the new row
  await page.getByTestId(/saml-test-\d+/).first().click();
  await expect(page.getByTestId('saml-test-eval')).toContainText(/role/);

  const r = await request.get('/spa/api/audit?limit=1&action=sso.test_run');
  const b = await r.json();
  expect(b.rows[0]).toBeTruthy();
  expect(b.rows[0].policy_decision).toBeTruthy();
});
```

`apps/web/e2e/sessions-killall.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-2 force-logout-all invalidates non-admin sessions', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/users?tab=sessions');
  const before = await page.getByTestId('session-row').count();
  await page.getByTestId('sessions-killall-btn').click();
  await page.getByLabel(/reason/i).fill('Suspicious access pattern from IP 198.51.100.7');
  await page.getByTestId('killall-confirm').click();
  await expect(page.getByTestId('session-row').first()).toBeVisible();
  const after = await page.getByTestId('session-row').count();
  expect(after).toBeLessThan(before);
});
```

- [ ] **Step 2: Build `routes/spa-api/saml-test.js`**

```javascript
'use strict';
const express = require('express');
const db = require('../../db');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requireAuthJson, tenantScope } = require('./_shared');
const { requirePermJson } = require('../../services/rbac-helpers');

const router = express.Router();
router.use(requireAuthJson);

router.post('/admin/saml-idps/:id/test', requirePermJson('admin'), (req, res) => {
  const idp = db.prepare('SELECT * FROM saml_idps WHERE id=?').get(Number(req.params.id));
  if (!idp) return res.status(404).json({ error: 'idp_not_found' });

  let claimMap = {};
  try { claimMap = JSON.parse(idp.claim_map_json || '{}'); } catch (_) {}

  // Sample SAMLResponse — used for dry-run claim eval
  const sampleClaims = req.body?.sample_claims || {
    NameID: 'sample.user@bob.bt', role: 'Maker', branch: 'Thimphu',
  };
  const evaluated = Object.fromEntries(
    Object.entries(claimMap).map(([k, attr]) => [k, sampleClaims[attr] ?? null]),
  );

  writeAuditRow({
    userId: req.session.user.id, action: 'sso.test_run',
    entityType: 'saml_idp', entityId: String(idp.id),
    detail: { name: idp.name, evaluated },
    tenantId: tenantScope(req),
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({
    saml_request_xml: `<samlp:AuthnRequest IssueInstant="${new Date().toISOString()}" .../>`,
    claim_eval: evaluated,
  });
});

router.post('/admin/sessions/killall', requirePermJson('admin'), (req, res) => {
  const reason = String(req.body?.reason || '');
  if (reason.trim().length < 20) return res.status(400).json({ error: 'reason_too_short', min: 20 });
  const me = req.session.user.id;
  const result = db.prepare(`
    DELETE FROM user_sessions WHERE user_id != ? AND expires_at > datetime('now')
  `).run(me);
  writeAuditRow({
    userId: me, action: 'auth.killall',
    entityType: 'sessions', entityId: 'all',
    detail: { count: result.changes, reason },
    tenantId: tenantScope(req),
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });
  res.json({ ok: true, killed: result.changes });
});

module.exports = router;
```

- [ ] **Step 3: Extend `SamlTab.tsx`** — replace the existing `testResult` rendering with a structured panel showing `claim_eval`:

```tsx
{testResult !== null && (
  <div className="rounded-card border border-divider p-4">
    <h4 className="text-sm font-semibold">Claim mapping evaluation</h4>
    <dl data-testid="saml-test-eval" className="grid grid-cols-2 gap-2 text-xs mt-2">
      {Object.entries(testResult.claim_eval ?? {}).map(([k, v]) => (
        <div key={k}><dt className="text-muted">{k}</dt><dd className="font-mono">{String(v ?? '—')}</dd></div>
      ))}
    </dl>
    <details className="mt-2">
      <summary className="text-xs text-brand-blue cursor-pointer">Show SAMLRequest XML</summary>
      <pre className="text-2xs bg-surface-alt p-2 overflow-auto">{testResult.saml_request_xml}</pre>
    </details>
  </div>
)}
```

Add a "Claim map" textarea to `IdpForm` (likely already exists; ensure `claim_map_json` field is editable).

- [ ] **Step 4: Extend `SessionsTab.tsx`** — add killall affordance + reason dialog:

```tsx
<Button
  variant="danger"
  size="sm"
  data-testid="sessions-killall-btn"
  onClick={() => setKillAllOpen(true)}
>
  {t('users.sessions.kill_all', 'Force-logout-all')}
</Button>

{killAllOpen && (
  <ReasonDialog
    title={t('users.sessions.kill_all_title', 'Force-logout all users')}
    actionLabel={t('users.sessions.kill_all_confirm')}
    minChars={20}
    onConfirm={async (reason) => {
      await http.post('/spa/api/admin/sessions/killall', { reason }, z.object({ ok: z.literal(true), killed: z.number() }));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      setKillAllOpen(false);
    }}
    onCancel={() => setKillAllOpen(false)}
  />
)}
```

- [ ] **Step 5: Run specs + axe-core**

```bash
cd apps/web && npx playwright test saml-claim-mapping.spec.ts sessions-killall.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/users" --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add routes/spa-api/saml-test.js \
        apps/web/src/modules/users/tabs/SamlTab.tsx \
        apps/web/src/modules/users/tabs/SessionsTab.tsx \
        apps/web/e2e/saml-claim-mapping.spec.ts apps/web/e2e/sessions-killall.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(users): SAML claim-map eval on test-sso + sessions kill-all

Closes Wave-E §5.6 (SSO admin UI; session control).
Test-sso renders mapped values for username/role/branch.
Killall requires reason ≥20 chars; audit row written."
```

---

## Task 5: Indexing station polish — Tab cycle + bbox click-to-fill + Override audit

**Spec:** Mockup #7; UI/UX §5.3 / §10.13.

**Files:**
- Modify: `apps/web/src/modules/indexing/hooks/useIndexingKeyboard.ts` (add Tab handler outside text inputs)
- Modify: `apps/web/src/modules/indexing/components/PdfPane.tsx` (bbox onClick → fieldKey focus event)
- Modify: `apps/web/src/modules/indexing/components/FieldPane.tsx` (override emits `pii_mask`-style `indexing.override` audit event — see §Postmortem allow-list addition)
- Test: `apps/web/e2e/indexing-bbox-click.spec.ts`

**AC-1** — Given the indexing station is open, when the admin presses Tab while focus is on a field input, then focus moves to the next field input in the FIELD_DEFS order; pressing Shift+Tab goes back. Tab outside an input behaves the same.
**AC-2** — Given a PDF is rendered with bounding boxes, when the user clicks the box for `customer_cid`, then the corresponding input on the right rail receives focus.
**AC-3** — Given the user clicks "Override" on a confidence chip, when the input is focused, then a `policy_decision`-tagged audit row with action `indexing.override_applied` is written within 500ms.

- [ ] **Step 1: Failing E2E**

`apps/web/e2e/indexing-bbox-click.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1+2 Tab cycles fields; bbox click focuses field', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/indexing');
  await page.getByTestId('queue-row').first().click();
  await page.getByTestId('indexing-input-customer_cid').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('indexing-input-customer_name')).toBeFocused();

  await page.getByTestId('bbox-customer_cid').click();
  await expect(page.getByTestId('indexing-input-customer_cid')).toBeFocused();
});

test('AC-3 Override emits indexing.override_applied audit row', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/indexing');
  await page.getByTestId('queue-row').first().click();
  await page.getByTestId('field-row-customer_cid').getByTestId('ai-confidence-override').click();

  await expect.poll(async () => {
    const r = await request.get('/spa/api/audit?limit=1&action=indexing.override_applied');
    const b = await r.json();
    return b.rows[0]?.action || '';
  }).toBe('indexing.override_applied');
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend `useIndexingKeyboard.ts`** with Tab cycling:

```typescript
// Inside the existing handler, BEFORE the if (inInput) return; line:
if (e.key === 'Tab' && inInput) {
  // Let the browser handle Tab natively (focusable inputs are in DOM order).
  return;
}
if (e.key === 'Tab' && !inInput) {
  e.preventDefault();
  const dir = e.shiftKey ? -1 : 1;
  onNextField(dir);
  return;
}
```

- [ ] **Step 4: Extend `PdfPane.tsx`** — propagate bbox click via prop callback `onBboxClick(fieldKey)`. Wire up testid `bbox-${fieldKey}` on the rendered overlay:

```tsx
{boxes.map((b) => (
  <button
    key={b.fieldKey}
    data-testid={`bbox-${b.fieldKey}`}
    aria-label={t('indexing.bbox.aria', { field: b.fieldKey })}
    onClick={() => onBboxClick(b.fieldKey)}
    className="absolute border-2 border-brand-blue/40 hover:bg-brand-blue/10 focus-visible:ring-2 focus-visible:ring-brand-blue rounded-input"
    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
  />
))}
```

In `IndexingPage.tsx` (no edit per §Constraints if listed in the matrix? — re-check: matrix permits extending /indexing — fine):

```tsx
<PdfPane
  ...
  onBboxClick={(fieldKey) => {
    const idx = FIELD_DEFS.findIndex((f) => f.key === fieldKey);
    if (idx >= 0) {
      setFocusedFieldIndex(idx);
      fieldRefs[idx]?.current?.focus();
    }
  }}
/>
```

- [ ] **Step 5: Wire override audit** — extend `FieldPane.tsx`'s existing `onOverride` to emit:

```tsx
import { emitAuditEvent } from '@/lib/audit-events';
// In the AiConfidenceBadge onOverride handler:
onOverride={() => {
  fieldRefs[idx]?.current?.focus();
  void emitAuditEvent({
    action: 'indexing.override_applied',
    entity_type: 'indexing_row',
    entity_id: String(documentId),
    detail: { field: fieldKey, ai_value: aiField?.value, ai_confidence: aiField?.confidence },
  });
}}
```

(`indexing.override_applied` is added to the SPA allow-list — listed in §Postmortem.)

- [ ] **Step 6: Re-run + axe-core**

```bash
cd apps/web && npx playwright test indexing-bbox-click.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/indexing" --reporter=line
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/indexing/ apps/web/e2e/indexing-bbox-click.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(indexing): Tab cycle + bbox click-to-fill + override audit

Closes Wave-E §10.13. Override now emits indexing.override_applied (SPA-allow-listed).
Tab/Shift+Tab cycles inputs in FIELD_DEFS order."
```

---

## Task 6: AML Hit Decide v2 polish — prior verdict + diff legend + audit chain

**Spec:** Mockup #8 (lines 1684–1748); UI/UX §5.4.

**Files:**
- Modify: `apps/web/src/modules/aml-screening/components/HitDecideV2Modal.tsx` (already mostly built — fill gaps)
- Modify: `apps/web/src/modules/aml-screening/components/DecisionHistoryTab.tsx` (Apply prior verdict button)
- Test: `apps/web/e2e/aml-prior-verdict.spec.ts`

**AC-1** — Given the History tab lists prior decisions for the same subject×entry, when the user clicks "Apply prior verdict" on a row, then the Action panel's notes field is pre-populated with the prior reason and the matching action button is highlighted.
**AC-2** — Given a decision is submitted, when the audit row is queried, then `policy_decision.opa_allow=true` is present.

- [ ] **Step 1: Failing E2E**

`apps/web/e2e/aml-prior-verdict.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1 Apply prior verdict copies reason + flags action', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/aml');
  // Open hits queue
  await page.getByTestId('aml-tab-hits').click();
  await page.getByTestId('aml-hit-row').first().click();
  await page.getByTestId('aml-hit-decide-v2-modal').waitFor();
  await page.getByRole('tab', { name: /history/i }).click();
  // First "Apply prior verdict" button
  await page.getByTestId(/apply-prior-/).first().click();
  // Action tab now has notes pre-populated
  await page.getByRole('tab', { name: /action/i }).click();
  await expect(page.getByTestId('aml-v2-action-notes')).not.toHaveValue('');
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Lift state to `HitDecideV2Modal`**

In `HitDecideV2Modal.tsx`, add:

```tsx
const [presetNotes, setPresetNotes] = useState<string | null>(null);
const [presetDecision, setPresetDecision] = useState<'cleared'|'escalated'|null>(null);
```

Pass to both `DecisionHistoryTab` (so it can call back) and `ActionPanel` (so it can pre-fill):

```tsx
<DecisionHistoryTab
  hitId={hit.id}
  onApplyPrior={(d) => { setPresetNotes(d.notes); setPresetDecision(d.decision); }}
/>
...
<ActionPanel
  ...
  initialNotes={presetNotes ?? ''}
  highlightDecision={presetDecision}
/>
```

In `DecisionHistoryTab.tsx`, render an "Apply prior verdict" button per row:

```tsx
<Button
  size="sm"
  variant="ghost"
  data-testid={`apply-prior-${d.id}`}
  onClick={() => onApplyPrior(d)}
>
  {t('aml.decide.apply_prior', 'Apply prior verdict')}
</Button>
```

Update `ActionPanel` to seed `notes` state from `initialNotes` and add the highlight ring on the matching button via `highlightDecision`.

- [ ] **Step 4: Re-run + axe-core**

```bash
cd apps/web && npx playwright test aml-prior-verdict.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/admin/aml" --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/aml-screening/components/ apps/web/e2e/aml-prior-verdict.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(aml): Hit Decide v2 'Apply prior verdict'

Closes Wave-E §5.4. Prior reason auto-fills Action notes; matching button highlighted."
```

---

## Task 7: Learn Wizard inline versioning + visual labeler styling

**Spec:** Mockup #9 (lines 1750–1901); UI/UX §5.5.

**Files:**
- Modify: `apps/web/src/modules/document-types/LearnWizard.tsx` (Versions tab inside Step 5/6)
- Modify: `apps/web/src/modules/document-types/components/BboxLabeler.tsx` (solid-green vs dashed-amber styling)
- Modify: `apps/web/src/modules/document-types/components/VersionsPanel.tsx` (A/B test scaffold)
- Modify: `apps/web/src/modules/document-types/components/AbTestPanel.tsx` (already exists — wire up to versions)
- Test: `apps/web/e2e/learn-wizard-versioning.spec.ts`

**AC-1** — Given the wizard reaches Step 5 (Test pass), when the user opens the "Versions" sub-tab inside the wizard, then the existing `VersionsPanel` renders the doctype's history.
**AC-2** — Given the wizard's bbox labeler displays AI-proposed boxes, when rendered, then they are dashed amber; user-confirmed boxes are solid green; clicking an amber box flips it to green and the field rail's ring count moves from "3/5" to "4/5".
**AC-3** — Given a published v2 exists and the user creates v3 draft, when the user clicks "Compare v2↔v3" in the Versions tab, then `diffVersions` is called and the diff renders with `+ added`, `- removed`, `~ modified` markers.

- [ ] **Step 1: Failing E2E** — `apps/web/e2e/learn-wizard-versioning.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1 versions tab visible at step 5', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/document-types');
  await page.getByTestId('doctype-learn-btn').first().click();
  // Skip to step 5
  for (let i = 0; i < 4; i++) await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-tab-versions').click();
  await expect(page.getByTestId('versions-list')).toBeVisible();
});

test('AC-2 bbox amber→green flip', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/document-types');
  await page.getByTestId('doctype-learn-btn').first().click();
  // Step 4 — visual labeler
  for (let i = 0; i < 3; i++) await page.getByTestId('wizard-next').click();
  const amber = page.getByTestId(/bbox-ai-/).first();
  await expect(amber).toHaveCSS('border-style', 'dashed');
  await amber.click();
  await expect(amber).toHaveCSS('border-style', 'solid');
});
```

- [ ] **Step 2: Embed Versions tab in wizard Step 5**

In `LearnWizard.tsx`, when `step === 5`, render a tabs strip:

```tsx
{step === 5 && (
  <Tabs defaultValue="test">
    <TabList>
      <Tab value="test" data-testid="wizard-tab-test">Test pass</Tab>
      <Tab value="versions" data-testid="wizard-tab-versions">Versions</Tab>
      <Tab value="ab" data-testid="wizard-tab-ab">A/B</Tab>
    </TabList>
    <TabPanel value="test"><TestPassPanel ... /></TabPanel>
    <TabPanel value="versions"><VersionsPanel doctype={doctype} /></TabPanel>
    <TabPanel value="ab"><AbTestPanel doctype={doctype} /></TabPanel>
  </Tabs>
)}
```

- [ ] **Step 3: Update `BboxLabeler.tsx` styling**

```tsx
className={cn(
  'absolute rounded-input transition-colors',
  bbox.source === 'confirmed'
    ? 'border-2 border-success bg-success/10'
    : 'border-2 border-dashed border-warning bg-warning/8 animate-pulse',
)}
data-testid={`bbox-${bbox.source === 'confirmed' ? 'confirmed' : 'ai'}-${bbox.field_name}`}
```

On click, mutate `source: 'confirmed'` and patch the bbox via existing `updateBbox` route.

- [ ] **Step 4: Wire `VersionsPanel` A/B**

`VersionsPanel.tsx` — add a "Compare v{a} ↔ v{b}" button row that calls `diffVersions(va, vb)` (already exported). Render the diff with three groups (added / removed / modified).

- [ ] **Step 5: Re-run + axe-core**

```bash
cd apps/web && npx playwright test learn-wizard-versioning.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/admin/document-types" --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/document-types/ apps/web/e2e/learn-wizard-versioning.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(doctypes): inline versioning + dashed-amber AI bboxes in Learn Wizard

Closes Wave-E §5.5 — schema versions visible at Step 5, A/B scaffold wired,
solid-green confirmed vs dashed-amber AI-proposed bboxes."
```

---

## Task 8: Customer-360 polish + `/customers/:cid` page

**Spec:** Mockup #10 (lines 1903–2013); UI/UX §5.8.

**Files:**
- Create: `apps/web/src/modules/customer-360/CustomerDetailPage.tsx`
- Modify: `apps/web/src/modules/customer-360/components/DocumentsTab.tsx`
- Modify: `apps/web/src/modules/customer-360/components/ActivityTab.tsx`
- Modify: `apps/web/src/modules/customer-360/components/WorkflowsTab.tsx`
- Test: `apps/web/e2e/customer-360-page.spec.ts`

**Note:** `/customers/:cid` route addition is **listed in §Postmortem** for the lead to add to App.tsx. This task ships the page component; the route line is a one-liner.

**AC-1** — Given a CID is known, when the user navigates to `/customers/CID-001234`, then the page renders the same six-tab layout as the drawer (Master / Accounts / Documents / Transactions / Workflows / Activity).
**AC-2** — Given the Documents tab is open, when documents render, then each card shows a version pill (`v1`, `v2`) AND a status badge (Valid / In review / Expires N days).
**AC-3** — Given the Activity tab is open, when the admin types a query in the filter input, then the visible audit rows reduce in real-time (300ms debounce, client-side filter for now).
**AC-4** — Given the Workflows tab is open, when a workflow row is clicked, then the user navigates to `/workflows?id={instance_id}`.

- [ ] **Step 1: Failing E2E**

`apps/web/e2e/customer-360-page.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1 page route renders all 6 tabs', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/customers/CID-001');
  await expect(page.getByRole('tab', { name: /master/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /documents/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /activity/i })).toBeVisible();
});

test('AC-2 doc cards show version + status', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/customers/CID-001');
  await page.getByRole('tab', { name: /documents/i }).click();
  const card = page.getByTestId('cust-doc-card').first();
  await expect(card.getByTestId('cust-doc-version')).toBeVisible();
  await expect(card.getByTestId('cust-doc-status')).toBeVisible();
});
```

- [ ] **Step 2: Build `CustomerDetailPage.tsx`**

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { Customer360Drawer } from './Customer360Drawer';

export function CustomerDetailPage() {
  const { cid } = useParams<{ cid: string }>();
  const navigate = useNavigate();
  if (!cid) return null;
  return (
    <Customer360Drawer
      cid={cid}
      onClose={() => navigate(-1)}
    />
  );
}
```

- [ ] **Step 3: Extend `DocumentsTab.tsx` doc cards**

```tsx
<div data-testid="cust-doc-card" className="border border-divider rounded-card p-3 hover:border-brand-blue/40">
  ...
  <p className="text-xs font-medium truncate">{doc.original_name}</p>
  <div className="flex items-center justify-between mt-1 text-2xs">
    <span data-testid="cust-doc-version" className="text-muted">v{doc.version}</span>
    <span
      data-testid="cust-doc-status"
      className={cn('px-1.5 py-0.5 rounded-full font-semibold', statusTone(doc.status))}
    >
      {t(`customer360.doc_status.${doc.status}`)}
    </span>
  </div>
</div>
```

- [ ] **Step 4: Extend `ActivityTab.tsx`** — add filter input with 300ms debounce filtering on `action` and `created_at` strings (client-side until backend supports facet filters). Save the input to URL `?q=…` for shareability.

- [ ] **Step 5: Extend `WorkflowsTab.tsx`** — wrap each row in a `<Link to={\`/workflows?id=\${instance_id}\`}>`.

- [ ] **Step 6: Re-run + axe-core**

```bash
cd apps/web && npx playwright test customer-360-page.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/customers" --reporter=line
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/customer-360/ apps/web/e2e/customer-360-page.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(customer-360): /customers/:cid page + doc-card status + activity filter

Closes Wave-E §5.8 — Customer-360 is now a routable page, not just a drawer.
Doc cards expose version + status; Activity tab filters live."
```

---

## Task 9: BoB business calendar — tenant_calendars + SLA wiring

**Spec:** Mockup #11; UI/UX §5.5; allocation matrix migration **0044**.

**Files:**
- Modify: `db/schema.sql` + `db/index.js` (migration 0044)
- Modify: `db/seed.js` (seed BoB monastery-day calendar for tenant `bob`)
- Create: `routes/spa-api/calendars.js`
- Create: `services/sla.js`
- Modify: `apps/web/src/modules/workflow-templates/components/CalendarEditor.tsx`
- Modify: `apps/web/src/modules/workflow-templates/DesignerPage.tsx` (calendar dropdown sources tenant_calendars)
- Test: `apps/web/e2e/calendar-bob.spec.ts`

**AC-1** — Given a fresh clone with `db/seed.js` run, when querying `tenant_calendars` for `tenant_id='bob'`, then 14 BoB monastery-day rows are present, including `'Zhabdrung Kuchoe'` and `'King's Birthday'`.
**AC-2** — Given a workflow template references `calendar_id` of a tenant_calendar, when an instance is created on a holiday, then the SLA `due_at` falls on the next business day.
**AC-3** — Given the Designer's CalendarEditor renders, when the admin clicks "Use BoB monastery calendar", then the holiday list populates from `tenant_calendars` (not the hard-coded `BOB_DEFAULT_HOLIDAYS`).

- [ ] **Step 1: Migration 0044 in `db/index.js`**

```javascript
// Migration 0044 — Plan 2: tenant-scoped per-day calendar.
// Coexists with business_calendars (which carries hours+holidays as JSON);
// tenant_calendars is per-day for cleaner editing and per-tenant override.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_calendars (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    TEXT    NOT NULL,
      holiday_date TEXT    NOT NULL,                  -- ISO date YYYY-MM-DD
      label        TEXT    NOT NULL,
      kind         TEXT    NOT NULL DEFAULT 'national'
                     CHECK(kind IN ('national','monastery','royal','regulatory','custom')),
      created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by   INTEGER,
      UNIQUE (tenant_id, holiday_date),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tcal_tenant ON tenant_calendars(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tcal_date   ON tenant_calendars(tenant_id, holiday_date);
  `);
  console.log('[db] migration 0044: tenant_calendars ready.');
} catch (err) {
  console.error('[db] migration 0044 skipped:', err.message);
}
```

Append the same DDL block to `db/schema.sql`.

- [ ] **Step 2: Seed BoB monastery days**

In `db/seed.js`, add:

```javascript
// Plan 2 / AC-1 — BoB monastery + royal + national days for tenant_id='bob'.
const BOB_TENANT_HOLIDAYS = [
  { date: '2026-01-02', label: 'Nyilo (Winter Solstice)',                kind: 'national' },
  { date: '2026-02-21', label: "King's Birthday (5th Druk Gyalpo)",       kind: 'royal' },
  { date: '2026-02-25', label: 'Losar (Bhutanese New Year)',              kind: 'national' },
  { date: '2026-04-15', label: 'Zhabdrung Kuchoe',                        kind: 'monastery' },
  { date: '2026-05-02', label: 'Birth anniversary of the Third Druk Gyalpo', kind: 'royal' },
  { date: '2026-06-02', label: 'Birth anniversary of the Fourth Druk Gyalpo', kind: 'royal' },
  { date: '2026-09-22', label: 'Blessed Rainy Day (Thrue Bab)',           kind: 'monastery' },
  { date: '2026-10-13', label: 'Royal Wedding Anniversary',               kind: 'royal' },
  { date: '2026-10-15', label: 'Dashain (first day)',                     kind: 'national' },
  { date: '2026-10-16', label: 'Dashain (Dussehra)',                      kind: 'national' },
  { date: '2026-10-24', label: 'Thimphu Drubchen',                        kind: 'monastery' },
  { date: '2026-10-25', label: 'Thimphu Tsechu (day 1)',                  kind: 'monastery' },
  { date: '2026-10-26', label: 'Thimphu Tsechu (day 2)',                  kind: 'monastery' },
  { date: '2026-10-27', label: 'Thimphu Tsechu (day 3)',                  kind: 'monastery' },
  { date: '2026-12-17', label: 'National Day (Unification of Bhutan)',    kind: 'national' },
];
const stmt = db.prepare(
  `INSERT OR IGNORE INTO tenant_calendars (tenant_id, holiday_date, label, kind) VALUES ('bob', ?, ?, ?)`,
);
for (const h of BOB_TENANT_HOLIDAYS) stmt.run(h.date, h.label, h.kind);
```

- [ ] **Step 3: Failing E2E**

`apps/web/e2e/calendar-bob.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-1 BoB tenant has 15 holidays seeded', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  const r = await request.get('/spa/api/calendars?tenant_id=bob');
  const b = await r.json();
  expect(b.holidays.length).toBeGreaterThanOrEqual(14);
  const labels = b.holidays.map((h: any) => h.label);
  expect(labels).toContain('Zhabdrung Kuchoe');
  expect(labels.some((l: string) => /King.*Birthday/.test(l))).toBe(true);
});

test('AC-3 CalendarEditor populates from tenant_calendars', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/workflows/templates/1/design');
  await page.getByTestId('calendar-tab').click();
  await page.getByTestId('use-bob-monastery-cal').click();
  await expect(page.getByText(/Zhabdrung Kuchoe/)).toBeVisible();
});
```

- [ ] **Step 4: Build `routes/spa-api/calendars.js`**

```javascript
'use strict';
const express = require('express');
const db = require('../../db');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requireAuthJson, tenantScope } = require('./_shared');
const { requirePermJson } = require('../../services/rbac-helpers');

const router = express.Router();
router.use(requireAuthJson);

router.get('/calendars', (req, res) => {
  const tenant = String(req.query.tenant_id || tenantScope(req));
  const rows = db.prepare(
    `SELECT id, holiday_date, label, kind FROM tenant_calendars WHERE tenant_id=? ORDER BY holiday_date`,
  ).all(tenant);
  res.json({ tenant_id: tenant, holidays: rows });
});

router.post('/calendars', requirePermJson('admin'), (req, res) => {
  const { tenant_id, holiday_date, label, kind = 'custom' } = req.body || {};
  if (!tenant_id || !holiday_date || !label) return res.status(400).json({ error: 'invalid_body' });
  const ins = db.prepare(
    `INSERT INTO tenant_calendars (tenant_id, holiday_date, label, kind, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tenant_id, holiday_date, label, kind, req.session.user.id);

  writeAuditRow({
    userId: req.session.user.id, action: 'calendar.holiday_add',
    entityType: 'tenant_calendar', entityId: String(ins.lastInsertRowid),
    detail: { tenant_id, holiday_date, label, kind },
    tenantId: tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true, id: ins.lastInsertRowid });
});

router.delete('/calendars/:id', requirePermJson('admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM tenant_calendars WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM tenant_calendars WHERE id=?').run(id);
  writeAuditRow({
    userId: req.session.user.id, action: 'calendar.holiday_remove',
    entityType: 'tenant_calendar', entityId: String(id),
    detail: { tenant_id: row.tenant_id, holiday_date: row.holiday_date, label: row.label },
    tenantId: row.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 5: Build `services/sla.js`**

```javascript
'use strict';
const db = require('../db');

function isHoliday(tenantId, isoDate) {
  const row = db.prepare(
    `SELECT 1 FROM tenant_calendars WHERE tenant_id=? AND holiday_date=?`,
  ).get(tenantId, isoDate);
  return Boolean(row);
}

function nextBusinessDay(tenantId, fromDate, businessDays = [1, 2, 3, 4, 5]) {
  const d = new Date(fromDate);
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay() || 7;          // 1..7 (Mon..Sun)
    const iso = d.toISOString().slice(0, 10);
    if (!businessDays.includes(dow)) continue;
    if (isHoliday(tenantId, iso)) continue;
    return iso;
  }
  throw new Error('no_business_day_within_30');
}

module.exports = { isHoliday, nextBusinessDay };
```

(Wire-up to `services/sla-job.js` listed in §Postmortem; that file currently uses `business_calendars`. The lead inserts the call.)

- [ ] **Step 6: Extend `CalendarEditor.tsx`** to render `tenant_calendars` rows above the local `holidays` state, and the "Use BoB monastery calendar" preset button:

```tsx
const tcalQ = useQuery({
  queryKey: ['tenant-calendars', 'bob'],
  queryFn: () => http.get('/spa/api/calendars?tenant_id=bob', z.object({ holidays: z.array(z.object({ id: z.number(), holiday_date: z.string(), label: z.string(), kind: z.string() })) })),
});

// Preset button
<Button
  size="sm"
  variant="ghost"
  data-testid="use-bob-monastery-cal"
  type="button"
  onClick={() => onChangeHolidays((tcalQ.data?.holidays ?? []).map((h) => h.holiday_date))}
>
  {t('calendar.bob.use_preset', 'Use BoB monastery calendar')}
</Button>

// Render labels under date strings
{holidays.map((iso) => {
  const meta = tcalQ.data?.holidays.find((h) => h.holiday_date === iso);
  return (
    <li key={iso} ...>
      <span>{iso}</span>
      {meta && <span className="text-2xs text-muted ml-2">{meta.label} ({meta.kind})</span>}
      ...
    </li>
  );
})}
```

- [ ] **Step 7: Re-run + axe-core**

```bash
node db/seed.js
cd apps/web && npx playwright test calendar-bob.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "workflows/templates" --reporter=line
```

- [ ] **Step 8: Commit**

```bash
git add db/schema.sql db/index.js db/seed.js routes/spa-api/calendars.js services/sla.js \
        apps/web/src/modules/workflow-templates/ apps/web/e2e/calendar-bob.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(calendars): tenant_calendars + BoB monastery seed + SLA next-business-day

Closes Wave-E §5.5 (Templates designer with BoB calendar) + matrix migration 0044.
14 monastery/royal/national days seeded for tenant 'bob'.
services/sla.js#nextBusinessDay reads tenant_calendars first."
```

---

## Task 10: Mobile fluid PDF + bottom-sheet AI panel + 44px touch targets

**Spec:** Mockup #12; UI/UX §5.9 (Mobile 2/10 → 7/10 — finish the lift).

**Files:**
- Create: `apps/web/src/modules/viewer/components/MobileBottomSheet.tsx`
- Modify: `apps/web/src/modules/viewer/ViewerPage.tsx` (mobile branch — replace iframe fallback w/ PDF.js fluid + sheet)
- Modify: `apps/web/src/modules/viewer/components/Toolbar.tsx` (44px touch targets)
- Test: `apps/web/e2e/mobile-viewer.spec.ts`, `apps/web/e2e/mobile-login.spec.ts`

**AC-1** — Given `useIsMobile()=true`, when the viewer renders, then PDF.js fluid renderer is mounted (not iframe); document scrolls with single-finger pan; pinch-zoom is enabled.
**AC-2** — Given the AI tab is invoked on mobile, when activated, then a bottom sheet slides up from the bottom (not the right rail), respects `safe-area-inset-bottom`, and dismisses on swipe-down.
**AC-3** — Given the toolbar is rendered, when measured, then every button has `min-height: 44px` and `min-width: 44px`.
**AC-4** — Given the LoginPage is rendered on Pixel-7 (412×915), when measured, then no element overflows the viewport horizontally and the submit button is reachable above the keyboard.

- [ ] **Step 1: Failing specs**

`apps/web/e2e/mobile-viewer.spec.ts`:

```typescript
import { test, expect, devices } from '@playwright/test';
import { login } from './helpers';

test.use({ ...devices['Pixel 7'] });
test('AC-1+2+3 mobile viewer is fluid + bottom-sheet + 44px', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/viewer/1');
  await expect(page.locator('iframe[data-pdf-fallback]')).toHaveCount(0);
  await expect(page.getByTestId('mobile-bottom-sheet-handle')).toBeVisible();

  await page.getByTestId('mobile-rail-toggle').click();
  await expect(page.getByTestId('mobile-bottom-sheet')).toHaveAttribute('data-state', 'open');

  // 44px enforcement
  const buttons = page.locator('[data-testid^="toolbar-btn-"]');
  for (const b of await buttons.all()) {
    const box = await b.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});
```

`apps/web/e2e/mobile-login.spec.ts`:

```typescript
import { test, expect, devices } from '@playwright/test';
test.use({ ...devices['Pixel 7'] });
test('AC-4 login works on Pixel 7 viewport', async ({ page }) => {
  await page.goto('/login');
  // Nothing overflows horizontally
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  // Submit visible without scroll
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();
  const box = await submit.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 2: Build `MobileBottomSheet.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function MobileBottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} aria-hidden />}
      <div
        ref={ref}
        data-testid="mobile-bottom-sheet"
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'fixed left-0 right-0 bottom-0 z-50 bg-surface border-t border-divider rounded-t-card',
          'transition-transform duration-200',
          'pb-[env(safe-area-inset-bottom)]',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{ transform: open ? `translateY(${drag}px)` : undefined, maxHeight: '80vh' }}
        onTouchStart={(e) => { (ref.current as any)._sy = e.touches[0].clientY; }}
        onTouchMove={(e) => {
          const sy = (ref.current as any)?._sy;
          if (sy != null) setDrag(Math.max(0, e.touches[0].clientY - sy));
        }}
        onTouchEnd={() => { if (drag > 80) onClose(); setDrag(0); }}
        role="dialog"
        aria-modal="true"
      >
        <div data-testid="mobile-bottom-sheet-handle" className="w-10 h-1 bg-border rounded-full mx-auto my-2" />
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Mobile branch in `ViewerPage.tsx`**

Find the existing `isMobile` branch (already present); replace its right-rail JSX with the bottom sheet:

```tsx
{isMobile ? (
  <>
    <button
      data-testid="mobile-rail-toggle"
      className="fixed bottom-4 right-4 z-50 min-w-[44px] min-h-[44px] rounded-full bg-brand-blue text-white shadow-lg"
      onClick={() => setMobileRailOpen(true)}
    >
      <Sparkles size={18} />
    </button>
    <MobileBottomSheet open={mobileRailOpen} onClose={() => setMobileRailOpen(false)}>
      {/* same Tabs as desktop right rail */}
      <Tabs ...>
        {/* fields/annotations/versions/audit */}
      </Tabs>
    </MobileBottomSheet>
  </>
) : (
  /* existing desktop right rail */
)}
```

Ensure the PDF body uses `<PdfCanvas>` (already PDF.js) on mobile too — drop any `<iframe>` fallback if present. Confirm with grep.

- [ ] **Step 4: Toolbar 44px**

In `Toolbar.tsx`, change every `<Button>` and `<button>` to `min-h-[44px] min-w-[44px]`. Use `data-testid="toolbar-btn-{action}"` for assertion.

- [ ] **Step 5: LoginPage Pixel-7 fix**

In `LoginPage.tsx`, add `min-h-[44px]` to `<Button type="submit">` (Plan 0 already mostly OK; verify on actual viewport). Wrap the right column in `overflow-x-hidden` and ensure the `lg:w-1/2` becomes `w-full` < lg. **No new code needed if existing breakpoints hold** — just verify with the failing AC-4 test.

- [ ] **Step 6: Re-run E2E + axe-core**

```bash
cd apps/web && npx playwright test --project=mobile mobile-viewer.spec.ts mobile-login.spec.ts --reporter=line
cd apps/web && npx playwright test wcag-foundation.spec.ts --grep "/viewer\|/login" --reporter=line
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/viewer/ apps/web/src/modules/auth/LoginPage.tsx \
        apps/web/e2e/mobile-viewer.spec.ts apps/web/e2e/mobile-login.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "feat(mobile): bottom-sheet AI panel + 44px touch targets + Pixel-7 login

Closes Wave-E §5.9 — finishes Wave D's 7/10 lift.
PDF.js fluid renderer on mobile (no iframe fallback);
bottom sheet respects safe-area-inset-bottom; toolbar buttons ≥44×44."
```

---

## Task 11: i18n strings — en.json + dz.json

**Files:**
- Modify: `apps/web/src/i18n/en.json` and `apps/web/src/i18n/dz.json`

**Namespaces (per matrix § 4):** `auth.sso.*, auth.mfa.*, users.invite.*, indexing.kbd.*, aml.decide.*, doctypes.versioning.*, calendar.bob.*, mobile.*`.

- [ ] **Step 1: Collect every t() key introduced by Tasks 1–10**

```bash
git diff --unified=0 apps/web/src/ | grep -oE "t\(['\"]([^'\"]+)['\"]" | sort -u > /tmp/plan2-keys.txt
cat /tmp/plan2-keys.txt | wc -l
```

Expected: ~80 new keys.

- [ ] **Step 2: Add to `en.json`** with the English fallback shown in each t() call. Validate JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/en.json','utf8'))"
```

- [ ] **Step 3: Add to `dz.json`** — `[DZ-PENDING] <english>` for any string without a vetted translation. Where a vetted Tibetan/Dzongkha rendering exists from Wave D's namespace, copy the convention.

- [ ] **Step 4: Run parity gate**

```bash
cd apps/web && npm run i18n:check
```

Expected: exit 0. **If non-zero, fix BEFORE commit.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "i18n: en/dz strings for Plan 2 — auth.sso, auth.mfa, users.invite, indexing.kbd, aml.decide, doctypes.versioning, calendar.bob, mobile

[DZ-PENDING] tags applied to ~80 strings; linguist follow-up tracked."
```

---

## Task 12: Plan 2 postmortem (docs-architect) — Wave-E DoD verification

**Files:**
- Create: `docs/postmortems/2026-05-XX-plan2-admin-onboarding.md`
- Modify: `docs/README.md` (changelog row)

- [ ] **Step 1: Run the full Wave-E DoD verification block**

```bash
echo "=== Migrations ==="
sqlite3 db/nbe-dms.db "PRAGMA table_info(mfa_factors);" | head -3
sqlite3 db/nbe-dms.db "PRAGMA table_info(tenant_calendars);" | head -3
sqlite3 db/nbe-dms.db "PRAGMA table_info(users);" | grep mfa_factor_default

echo "=== Orphan-table grep ==="
grep -rn "mfa_factors\|tenant_calendars" routes/ services/ apps/web/src/

echo "=== Audit emission ==="
grep -rn "writeAuditRow.*action: 'mfa\\.\\|writeAuditRow.*action: 'sso\\.\\|writeAuditRow.*action: 'calendar\\." routes/spa-api/

echo "=== i18n parity ==="
cd apps/web && npm run i18n:check

echo "=== Playwright sweep ==="
npx playwright test login-v2 mfa-enroll-reset users-invite-stepper saml-claim-mapping sessions-killall indexing-bbox-click aml-prior-verdict learn-wizard-versioning customer-360-page calendar-bob mobile-login mobile-viewer --reporter=line

echo "=== axe-core sweep on touched routes ==="
npx playwright test wcag-foundation.spec.ts --grep "/login\|/users\|/indexing\|/admin/aml\|/admin/document-types\|/customers\|/workflows/templates\|/viewer" --reporter=line
```

All must pass before postmortem is allowed to claim ✅.

- [ ] **Step 2: Write the postmortem (8-section CLAUDE.md format)**

Sections:
1. Summary (1 paragraph + score deltas)
2. What shipped (file:line per task)
3. What didn't (deferred items / TODOs)
4. Wave-E failure-mode rollcall (rate each of the 8 — UI without backend / backend without UI / orphan table / decorative AI / dz.json placebo / WCAG / audit gaps / mobile theatre)
5. Demo-day disaster simulation — was the "single most embarrassing" sentence closed? Evidence with file:line.
6. Score deltas — i18n target, IAM target, Mobile target.
7. **Lead application checklist** — reproduce the §Postmortem checklist below verbatim so the lead can paste it into the merge PR.
8. Lessons → propose CLAUDE.md updates.

- [ ] **Step 3: Append changelog row**

```markdown
| 2026-05-XX | Plan 2 — admin & onboarding | Login v2 (SSO+MFA), mfa_factors (mig 0043), tenant_calendars (mig 0044), Users InviteStepper + SoD, SAML claim-mapping test-sso, sessions kill-all, Indexing bbox-click + Tab cycle, AML prior verdict, Learn Wizard inline versioning, Customer-360 /customers/:cid page, BoB monastery calendar, Mobile bottom-sheet + 44px |
```

- [ ] **Step 4: Commit**

```bash
git add docs/postmortems/ docs/README.md
git commit -m "docs: Plan 2 postmortem + Wave-E DoD verification block green"
```

---

## §Postmortem — additions for the lead to apply at merge time

Per the matrix §7, this plan does **not** edit the following shared files. The list below is the canonical record of every line the lead must add to those files when merging Plan 2 into main.

### A. `services/rbac.js` — RBAC keys to add

Add to **every role's** PERMS array as appropriate:

| Permission | Doc Admin | Maker | Checker | Viewer | auditor | compliance |
|---|---|---|---|---|---|---|
| `mfa:enroll` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `mfa:reset` | ✓ | — | — | — | — | — |
| `sod:override` | ✓ | — | — | — | — | — |
| `calendar:edit` | ✓ | — | — | — | — | — |
| `sso:test` | ✓ | — | — | — | — | — |
| `users:invite_send` | ✓ | — | — | — | — | — |

Concrete edit (add into the existing arrays):

```javascript
'Doc Admin': [..., 'mfa:enroll','mfa:reset','sod:override','calendar:edit','sso:test','users:invite_send'],
'Maker':     [..., 'mfa:enroll'],
'Checker':   [..., 'mfa:enroll'],
'Viewer':    [..., 'mfa:enroll'],
'compliance':[..., 'mfa:enroll'],
```

### B. `python-service/app/services/auth.py` — RBAC parity

```python
PERMISSIONS = {
    ...
    "mfa:enroll":      {"viewer", "maker", "checker", "doc_admin", "compliance"},
    "mfa:reset":       {"doc_admin"},
    "sod:override":    {"doc_admin"},
    "calendar:edit":   {"doc_admin"},
    "sso:test":        {"doc_admin"},
    "users:invite_send": {"doc_admin"},
}
```

### C. `routes/spa-api.js` — router mounts to add

```javascript
router.use(require('./spa-api/auth-saml-discover'));
router.use(require('./spa-api/mfa-management'));
router.use(require('./spa-api/saml-test'));
router.use(require('./spa-api/calendars'));
```

(Insert **after** `router.use(require('./spa-api/users'));` to keep admin routes grouped.)

### D. `routes/spa-api/audit-events.js` — `SPA_AUDIT_ACTIONS` additions

```javascript
const SPA_AUDIT_ACTIONS = new Set([
  // existing entries…
  'indexing.override_applied',   // Plan 2 / Task 5
]);
```

(Server-side audit actions — `mfa.enroll_start`, `mfa.enroll_finish`, `mfa.reset`, `sod.violation_override`, `sso.test_run`, `calendar.holiday_add`, `calendar.holiday_remove`, `auth.killall` — are written **server-side** by the new routers and do NOT need allow-list entries. Only `indexing.override_applied` is SPA-emitted.)

### E. `apps/web/src/App.tsx` — route additions

```tsx
import { CustomerDetailPage } from '@/modules/customer-360/CustomerDetailPage';
// inside the <RequireAuth>-wrapped <Route> group:
<Route path="/customers/:cid" element={<CustomerDetailPage />} />
```

### F. `apps/web/src/components/layout/nav.ts` — sidebar nav

```typescript
// Add to navItems (or relevant section):
{
  path: '/customers',
  label: 'Customers',
  i18nKey: 'nav.customers',
  icon: 'Users2',
  // routes /customers/:cid — landing page can be a search/list page or simply the search form
},
```

(If the lead prefers no top-level entry, omit; the deep-link `/customers/CID-…` still works via Cmd-K + workflow row links.)

### G. `routes/spa-api/users.js` — schema response addition

`GET /spa/api/users` must include `mfa_factors` (LEFT JOIN against `mfa_factors WHERE is_active=1`) and `mfa_factor_default`. One-liner SQL extension:

```sql
SELECT u.*, u.mfa_factor_default,
       (SELECT json_group_array(json_object('id', f.id, 'kind', f.kind, 'label', f.label,
                                            'is_active', f.is_active, 'last_used_at', f.last_used_at))
          FROM mfa_factors f WHERE f.user_id = u.id AND f.is_active = 1) AS mfa_factors_json
  FROM users u
```

(Plan 2's `UsersTab.tsx` parses `mfa_factors_json` to populate the chip column. List as a 1-liner schema PR addition for the lead — this file is shared.)

### H. `services/sla-job.js` — call `nextBusinessDay` from `services/sla.js`

Where the existing job computes `due_at`, replace the literal `+48h` with:

```javascript
const { nextBusinessDay } = require('./sla');
const due = nextBusinessDay(tenantId, startDate);
```

(One-line swap; tests already exist for SLA job.)

---

## Self-review

**1. Spec coverage** — every Wave-E item from the matrix Plan-2 column maps to a task:
- ✅ Login v2 SSO + MFA + legal banner + last-login → Task 1
- ✅ Users + Invite v2 (5-step stepper, MFA chips, SoD) → Task 3
- ✅ MFA factor management (enroll / reset / default) → Task 2 (backend) + Task 3 (UI integration)
- ✅ SAML admin + claim mapping + test-sso audit → Task 4
- ✅ Kill-session / force-logout-all → Task 4
- ✅ Indexing J/K/Tab + bbox click-to-fill + Override → Task 5
- ✅ AML Hit Decide v2 prior verdict + diff legend → Task 6
- ✅ Learn Wizard inline versioning + bbox styling → Task 7
- ✅ Customer-360 polish + `/customers/:cid` route → Task 8
- ✅ BoB business calendar → Task 9
- ✅ Mobile fluid PDF + bottom-sheet AI + 44px touch → Task 10
- ✅ i18n parity → Task 11
- ✅ Postmortem with Wave-E DoD evidence → Task 12

**2. Migration claims** — 0043 (mfa_factors + users.mfa_factor_default), 0044 (tenant_calendars). Both within Plan 2's matrix-allotted range. No collision with Plan 1 (0045/0046) or Plan 3 (0041/0042).

**3. Shared files** — `services/rbac.js`, `python-service/app/services/auth.py`, `routes/spa-api.js`, `routes/spa-api/audit-events.js`, `apps/web/src/App.tsx`, `apps/web/src/components/layout/nav.ts`, `routes/spa-api/users.js` (response shape), `services/sla-job.js` — all listed in §Postmortem. **Zero direct edits in this plan's worktree.**

**4. RBAC parity** — `mfa:enroll, mfa:reset, sod:override, calendar:edit, sso:test, users:invite_send` listed for both Node and Python files in §Postmortem.

**5. Audit action keys** — `mfa.enroll_start, mfa.enroll_finish, mfa.reset, sod.violation_override, sso.test_run, calendar.holiday_add, calendar.holiday_remove, auth.killall, indexing.override_applied` — server-side ones use `writeAuditRow + buildPolicyDecision` (Plan 0); SPA-emitted (`indexing.override_applied`) added to allow-list per §Postmortem.

**6. i18n namespaces** — only `auth.sso.*, auth.mfa.*, users.invite.*, indexing.kbd.*, aml.decide.*, doctypes.versioning.*, calendar.bob.*, mobile.*` touched (matrix § 4 owners).

**7. Type consistency** — `mfa_factor_default` (snake_case DB) maps to `mfa_factor_default` (camelCase TS via response contract; alias declared in `users/schemas.ts`). `tenant_calendars` reads as `holidays` array on the wire to match the existing `CalendarEditor` shape.

**8. Placeholder scan** — re-read every step. No "TBD," no "implement later," no "similar to Task N" without code. Every Step 1 (failing test) is concrete; every Step N (commit) names the exact files.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-05-10-plan2-admin-onboarding.md`.

**Estimated days:** 3 days (one per major slice — onboarding/IAM, configuration/operations, mobile+i18n+postmortem).

**Recommended execution:** **Subagent-Driven** via `superpowers:subagent-driven-development`, fresh subagent per task, two-stage review between tasks. Parallelizable across:
- `db-migrator` — Tasks 2 (Step 1–3), 9 (Step 1–2)
- `node-engineer` — Tasks 1 (Step 3), 2 (Step 5), 4 (Step 2), 9 (Steps 4–5)
- `spa-engineer` — Tasks 1 (Steps 4–5), 3, 4 (Steps 3–4), 5, 6, 7, 8, 10
- `qa-engineer` — every task's failing-test step + axe-core sweeps
- `docs-architect` — Tasks 11 + 12

**Sequencing constraints:**
1. Task 2 (DB migrations + MFA backend) ships first — Task 3 depends on the `mfa_factors` schema and `mfa_factor_default` column.
2. Task 9 (calendar backend) ships before Task 9-UI extensions.
3. Tasks 1, 5, 6, 7, 8, 10 are independent — can run in parallel after Task 2.
4. Task 11 (i18n) collects keys from all prior tasks — must run last before Task 12.
5. Task 12 (postmortem) gates merge to main; lead applies §Postmortem additions, then merges per matrix conflict-resolution priority (Plan 3 → **Plan 2** → Plan 1).

**After Plan 2 ships green**, the lead applies the seven shared-file additions enumerated in §Postmortem, runs the full Wave-E DoD verification block one more time on main, and Plan 1 rebases onto the new tip.
