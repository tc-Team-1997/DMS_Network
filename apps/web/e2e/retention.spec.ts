/**
 * E2E tests for Retention + WORM Admin (Wave B F#30-31).
 *
 * Happy-path test: runs against real stack (no page.route mocking).
 * Error/edge-state tests: use page.route to mock API responses.
 *
 * Run:
 *   npx playwright test retention.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ── Shared mock data ────────────────────────────────────────────────────────

const CONFIG_URL = '**/spa/api/admin/config/retention';
const RULES_URL  = '**/spa/api/admin/retention/rules';
const SWEEP_URL  = '**/spa/api/admin/retention/sweep-status';
const PURGE_URL  = '**/spa/api/admin/retention/purge-log';
const HOLDS_URL  = '**/spa/api/admin/legal-holds';
const WORM_LOCKED_URL = '**/spa/api/admin/worm/locked';

const MOCK_SWEEP = {
  last_sweep_at: '2026-05-01T03:00:00Z',
  purged_today: 2,
  purged_week: 12,
  purged_month: 47,
  blocked_by_hold: 3,
  next_sweep_at: null,
};

const MOCK_RULES = {
  rules: [
    {
      doctype: 'passport',
      retention_period_days: 3650,
      worm_lock_period_days: 1825,
      legal_hold_eligible: true,
      delete_policy: 'archive',
    },
    {
      doctype: 'bank_statement',
      retention_period_days: 2555,
      worm_lock_period_days: null,
      legal_hold_eligible: false,
      delete_policy: 'soft_delete',
    },
  ],
};

const MOCK_PURGE_LOG = {
  rows: [
    {
      id: 1,
      action: 'RETENTION_PURGE',
      entity: 'document',
      entity_id: 101,
      details: 'Purged after 3650-day retention',
      created_at: '2026-05-01T03:05:00Z',
      username: 'system',
    },
    {
      id: 2,
      action: 'LEGAL_HOLD_APPLIED',
      entity: 'document',
      entity_id: 202,
      details: 'AML investigation hold',
      created_at: '2026-04-28T10:10:00Z',
      username: 'admin',
    },
  ],
};

const MOCK_HOLDS = {
  legal_holds: [
    {
      id: 1,
      doc_id: 202,
      applied_by: 'admin',
      applied_at: '2026-04-28T10:10:00Z',
      released_by: null,
      released_at: null,
      reason: 'AML investigation — pending resolution of case #AML-2026-04',
      tenant_id: 'nbe',
      original_name: 'Statement_Apr_2026.pdf',
      doc_type: 'bank_statement',
    },
  ],
};

const MOCK_WORM = {
  locked_documents: [
    {
      id: 55,
      original_name: 'KYC_Passport_Scan.pdf',
      doc_type: 'passport',
      worm_locked_at: '2025-01-15T00:00:00Z',
      worm_unlock_after: '2030-01-15T00:00:00Z',
      days_remaining: 1711,
      sha256_prefix: 'a1b2c3d4…',
    },
  ],
};

// ── Happy-path (real stack) ──────────────────────────────────────────────────

test.describe('Retention page — happy path (real stack)', () => {
  test('Doc Admin can navigate to /admin/retention and see the tab layout', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');

    // Header
    await expect(page.getByRole('heading', { name: /Retention.*WORM/i })).toBeVisible();

    // Tabs
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Legal Holds' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'WORM Admin' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Purge Log' })).toBeVisible();

    // "Run sweep now" button visible
    await expect(page.getByTestId('retention-trigger')).toBeVisible();
  });
});

// ── Mocked tests ─────────────────────────────────────────────────────────────

test.describe('Retention page — Overview tab (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SWEEP),
      }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');
  });

  test('shows scheduler health tile with purge counts', async ({ page }) => {
    const panel = page.getByTestId('sweep-status-panel');
    await expect(panel).toBeVisible();
    // KPI numbers from mock
    await expect(panel.getByText('2')).toBeVisible();   // purged_today
    await expect(panel.getByText('12')).toBeVisible();  // purged_week
    await expect(panel.getByText('47')).toBeVisible();  // purged_month
    await expect(panel.getByText('3')).toBeVisible();   // blocked_by_hold
  });
});

test.describe('Retention page — Rules tab (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SWEEP) }),
    );
    await page.route(RULES_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RULES) }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');
  });

  test('Rules tab shows per-doctype table rows', async ({ page }) => {
    await page.getByRole('tab', { name: 'Rules' }).click();
    const panel = page.getByTestId('retention-rules-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('passport')).toBeVisible();
    await expect(panel.getByText('bank_statement')).toBeVisible();
    await expect(panel.getByText('3650')).toBeVisible();
  });

  test('clicking Edit on a rule row shows save/cancel controls', async ({ page }) => {
    await page.getByRole('tab', { name: 'Rules' }).click();
    // Click the first Edit button
    const editBtn = page.getByRole('button', { name: /Edit rule for passport/i });
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    // Inline editing controls appear
    await expect(page.getByRole('button', { name: /Save rule/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel edit/i })).toBeVisible();
  });
});

test.describe('Retention page — Legal Holds tab (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SWEEP) }),
    );
    await page.route(HOLDS_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_HOLDS) }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');
  });

  test('Legal Holds tab lists active holds', async ({ page }) => {
    await page.getByRole('tab', { name: 'Legal Holds' }).click();
    const panel = page.getByTestId('legal-holds-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Statement_Apr_2026.pdf')).toBeVisible();
    await expect(panel.getByText('admin')).toBeVisible();
  });

  test('Apply hold form renders with doc_id and reason fields', async ({ page }) => {
    await page.getByRole('tab', { name: 'Legal Holds' }).click();
    await expect(page.getByTestId('legal-hold-apply')).toBeVisible();
  });
});

test.describe('Retention page — WORM Admin tab (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SWEEP) }),
    );
    await page.route(WORM_LOCKED_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_WORM) }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');
  });

  test('WORM Admin tab lists locked documents with Extend button', async ({ page }) => {
    await page.getByRole('tab', { name: 'WORM Admin' }).click();
    const panel = page.getByTestId('worm-admin-panel');
    await expect(panel).toBeVisible();
    const row = page.getByTestId('worm-admin-row-55');
    await expect(row).toBeVisible();
    await expect(row.getByText('KYC_Passport_Scan.pdf')).toBeVisible();
    await expect(row.getByText('a1b2c3d4…')).toBeVisible();
    await expect(page.getByTestId('worm-extend-btn-55')).toBeVisible();
  });

  test('Extend button opens the extend lock dialog', async ({ page }) => {
    await page.getByRole('tab', { name: 'WORM Admin' }).click();
    await page.getByTestId('worm-extend-btn-55').click();
    const dialog = page.getByTestId('worm-extend-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('worm-extend-days')).toBeVisible();
    await expect(dialog.getByTestId('worm-extend-reason')).toBeVisible();
    await expect(dialog.getByTestId('worm-extend-submit')).toBeVisible();
  });
});

test.describe('Retention page — Purge Log tab (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SWEEP) }),
    );
    await page.route(PURGE_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PURGE_LOG) }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');
  });

  test('Purge Log tab renders audit rows with action badges', async ({ page }) => {
    await page.getByRole('tab', { name: 'Purge Log' }).click();
    const panel = page.getByTestId('purge-log-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('RETENTION_PURGE')).toBeVisible();
    await expect(panel.getByText('LEGAL_HOLD_APPLIED')).toBeVisible();
    await expect(panel.getByText('system')).toBeVisible();
  });
});

test.describe('Retention page — access control (mocked)', () => {
  test('non-Admin role sees AccessDenied instead of the retention page', async ({ page }) => {
    await login(page, 'sara', 'sara123');
    await page.goto('/admin/retention');
    // The AccessDenied component renders an alert or heading
    await expect(page.getByRole('heading', { name: /access denied/i })).toBeVisible();
  });
});

test.describe('Retention page — sweep trigger (mocked)', () => {
  test('clicking Run sweep now fires POST and shows success toast', async ({ page }) => {
    let sweepCalled = false;
    await page.route(SWEEP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SWEEP) }),
    );
    await page.route('**/spa/api/admin/retention/trigger', (route) => {
      sweepCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, policies: 5 }),
      });
    });

    await login(page, 'admin', 'admin123');
    await page.goto('/admin/retention');

    await page.getByTestId('retention-trigger').click();
    // The button becomes a loading spinner during the request; after success a toast appears
    await expect(page.getByText(/sweep triggered|5 policy/i)).toBeVisible({ timeout: 5000 });
    expect(sweepCalled).toBe(true);
  });
});

// ── Admin Settings panel link ─────────────────────────────────────────────────

test.describe('Admin Settings — Retention panel', () => {
  test('retention panel link navigates to /admin/retention', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/settings/retention');
    const link = page.getByTestId('retention-panel-link');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/admin\/retention$/);
  });
});
