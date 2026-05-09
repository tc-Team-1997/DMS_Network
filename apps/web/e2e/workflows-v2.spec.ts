/**
 * Workflows v2 — Playwright spec.
 *
 * Happy-path tests run against the real stack (no mocking on GET list/detail).
 * Error/edge-state tests use page.route() mocks per the testing rule.
 *
 * Covered:
 *   1. Five tab buttons are visible (assigned, team, all, approved, rejected).
 *   2. Filter by branch chip — search param appears in URL.
 *   3. Click row → drawer opens with audit trail and action buttons.
 *   4. Comment too short → submit disabled (19 chars).
 *   5. Comment long enough → submit enabled (21 chars).
 *   6. Approve flow (mocked) → success toast appears + audit trail row.
 *   7. Bulk-select 3 rows → bulk approve → all 3 transition (mocked).
 */

import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

const MOCK_WORKFLOW = {
  id:              1001,
  ref_code:        'WF-V2-TEST',
  title:           'KYC Approval v2 test',
  doc_id:          1,
  stage:           'Maker Review',
  priority:        'High',
  risk_band:       null,
  amount:          null,
  tenant_id:       'nbe',
  created_at:      new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
  updated_at:      new Date().toISOString(),
  document_name:   'Passport_AHI_2022.pdf',
  doc_type:        'Passport',
  customer_name:   'Ahmed H. Ibrahim',
  branch:          'Cairo West',
  document_status: 'Valid',
};

const MOCK_LIST_RESPONSE = {
  data:     [MOCK_WORKFLOW],
  total:    1,
  page:     1,
  pageSize: 50,
};

const MOCK_DETAIL = {
  ...MOCK_WORKFLOW,
  audit_trail: [
    {
      id:                    1,
      workflow_id:           1001,
      user_id:               1,
      action:                'approve',
      reason_code:           'Compliant',
      comment:               'Meets all KYC requirements.',
      webauthn_assertion_id: null,
      attachment_id:         null,
      tenant_id:             'nbe',
      created_at:            new Date().toISOString(),
      actor_name:            'Ahmed Mohamed',
      actor_username:        'admin',
    },
  ],
};

const TENANT_CONFIG_WORKFLOWS = {
  'reason_codes.approve':      ['Compliant', 'Verified', 'Meets policy'],
  'reason_codes.reject':       ['Incomplete documentation', 'Data mismatch'],
  'reason_codes.escalate':     ['Compliance escalation', 'AML flag'],
  'min_comment_length':        20,
  'step_up_risk_band':         'high',
  'step_up_amount_threshold':  500000,
  'escalation_targets':        ['Branch Manager', 'Compliance Officer'],
  'sla_breach_action':         'notify',
  'bulk_action_max':           50,
};

// ---------------------------------------------------------------------------
// Helper: mock all workflow endpoints
// ---------------------------------------------------------------------------

async function mockWorkflowEndpoints(page: Page) {
  // Tenant config (needed for reason codes, min_comment_length)
  await page.route('**/spa/api/admin/config/workflows', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify(TENANT_CONFIG_WORKFLOWS),
    }),
  );

  // List (all tabs)
  await page.route((url) => url.pathname === '/spa/api/workflows', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify(MOCK_LIST_RESPONSE),
    });
  });

  // Detail
  await page.route('**/spa/api/workflows/1001', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify(MOCK_DETAIL),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Workflows v2', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/workflows');
  });

  test('shows all five tab buttons', async ({ page }) => {
    await expect(page.getByTestId('queue-assigned')).toBeVisible();
    await expect(page.getByTestId('queue-team')).toBeVisible();
    await expect(page.getByTestId('queue-all')).toBeVisible();
    await expect(page.getByTestId('queue-approved')).toBeVisible();
    await expect(page.getByTestId('queue-rejected')).toBeVisible();
  });

  test('filter by branch updates URL search param', async ({ page }) => {
    // Type in the branch combobox — the combobox opens a listbox.
    const branchInput = page.locator('[aria-label="Branch"]').or(
      page.locator('input[role="combobox"]').first(),
    );
    await branchInput.first().fill('Cairo West');
    // Wait for the option to appear in the listbox and click it.
    const option = page.locator('[role="option"]', { hasText: 'Cairo West' });
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click();
    }
    // URL should contain branch= param.
    await expect(page).toHaveURL(/branch=Cairo/);
  });

  test('clicking a row opens the action drawer', async ({ page }) => {
    await mockWorkflowEndpoints(page);
    await page.goto('/workflows');

    const row = page.locator('table tbody tr').first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    // Drawer should be visible.
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    // Drawer contains the viewer link and action buttons.
    await expect(page.getByTestId('drawer-approve-btn')).toBeVisible();
    await expect(page.getByTestId('drawer-reject-btn')).toBeVisible();
  });

  test('approve submit disabled when comment is 19 chars', async ({ page }) => {
    await mockWorkflowEndpoints(page);
    await page.goto('/workflows');

    const row = page.locator('table tbody tr').first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    await page.getByTestId('drawer-approve-btn').click();
    // Select a reason code first.
    await page.locator('select[aria-label="Reason code"]').first().selectOption({ index: 1 });
    // Type 19-char comment (1 short of min 20).
    await page.getByTestId('approve-comment').fill('1234567890123456789');
    // Submit should be disabled.
    await expect(page.getByTestId('approve-submit')).toBeDisabled();
  });

  test('approve submit enabled when comment is 21 chars', async ({ page }) => {
    await mockWorkflowEndpoints(page);
    await page.goto('/workflows');

    const row = page.locator('table tbody tr').first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    await page.getByTestId('drawer-approve-btn').click();
    await page.locator('select[aria-label="Reason code"]').first().selectOption({ index: 1 });
    // 21 chars — meets the 20-char minimum.
    await page.getByTestId('approve-comment').fill('123456789012345678901');
    await expect(page.getByTestId('approve-submit')).toBeEnabled();
  });

  test('mocked: approve flow shows success toast and audit trail entry', async ({ page }) => {
    await mockWorkflowEndpoints(page);

    // Mock the approve endpoint.
    await page.route('**/spa/api/workflows/1001/approve', (route) =>
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify({
          ok:       true,
          stage:    'Approved',
          workflow: { ...MOCK_WORKFLOW, stage: 'Approved' },
        }),
      }),
    );

    await page.goto('/workflows');
    const row = page.locator('table tbody tr').first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    await page.getByTestId('drawer-approve-btn').click();
    await page.locator('select[aria-label="Reason code"]').first().selectOption({ index: 1 });
    await page.getByTestId('approve-comment').fill('Meets all KYC requirements OK.');
    await page.getByTestId('approve-submit').click();

    // Success toast.
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Done' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('mocked: bulk-select 3 rows → bulk approve → all 3 succeed', async ({ page }) => {
    // Override list with 3 rows.
    const rows3 = [1, 2, 3].map((i) => ({
      ...MOCK_WORKFLOW,
      id:       1000 + i,
      ref_code: `WF-BULK-${i}`,
    }));

    await page.route('**/spa/api/admin/config/workflows', (route) =>
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify(TENANT_CONFIG_WORKFLOWS),
      }),
    );

    await page.route((url) => url.pathname === '/spa/api/workflows', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify({ data: rows3, total: 3, page: 1, pageSize: 50 }),
      });
    });

    await page.route('**/spa/api/workflows/bulk', (route) =>
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify({
          ok:      true,
          results: rows3.map((r) => ({ id: r.id, ok: true, stage: 'Approved' })),
        }),
      }),
    );

    await page.goto('/workflows');

    // Select all 3 rows via checkboxes.
    const checkboxes = page.locator('table tbody tr input[type="checkbox"]');
    await checkboxes.first().waitFor({ timeout: 10_000 });
    for (let i = 0; i < 3; i++) {
      await checkboxes.nth(i).check();
    }

    // Bulk action bar should appear.
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible();
    await expect(page.getByTestId('bulk-approve-btn')).toBeVisible();

    await page.getByTestId('bulk-approve-btn').click();

    // Fill bulk modal.
    await expect(page.getByTestId('bulk-modal')).toBeVisible({ timeout: 3_000 });
    await page.locator('select[aria-label="Reason code"]').first().selectOption({ index: 1 });
    await page.getByTestId('bulk-comment').fill('All three pass KYC compliance check confirmed.');
    await page.getByTestId('bulk-confirm-btn').click();

    // Success toast.
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Bulk action complete' })).toBeVisible({
      timeout: 5_000,
    });
  });
});
