/**
 * E2E tests for DSAR Console — Wave C.
 *
 * Happy-path spec: runs against the real Node + Python stack.
 * Error-state specs: use page.route() to mock specific failure responses.
 *
 * Run with: npx playwright test dsar.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Helper — mock all DSAR endpoints so tests never need a live stack
// ---------------------------------------------------------------------------

async function mockDsarApis(page: Parameters<typeof login>[0]) {
  await page.route('**/spa/api/dsar/requests', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0 }),
    });
  });

  await page.route('**/spa/api/dsar/lookup*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ matches: [], count: 0 }),
    });
  });
}

// ---------------------------------------------------------------------------
// Happy-path group
// ---------------------------------------------------------------------------

test.describe('DSAR Console — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await mockDsarApis(page);
  });

  test('navigates to DSAR Console page and renders heading', async ({ page }) => {
    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('DSAR Console').first()).toBeVisible();
    await expect(page.getByTestId('dsar-search-input')).toBeVisible();
  });

  test('search input accepts text and Search button is clickable', async ({ page }) => {
    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('dsar-search-input').fill('CID-001');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForLoadState('networkidle');
    // With mocked empty response, should show "No matching subjects".
    await expect(page.getByText('No matching subjects')).toBeVisible();
  });

  test('request list shows empty state when API returns zero items', async ({ page }) => {
    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('No DSAR requests yet for this tenant.')).toBeVisible();
  });

  test('DSAR settings panel is accessible at /admin/settings/dsar', async ({ page }) => {
    await page.goto('/admin/settings/dsar');
    await page.waitForLoadState('networkidle');
    // ConfigPanel renders the namespace title.
    await expect(page.getByText('DSAR Console').first()).toBeVisible();
  });

  test('DSAR nav entry appears in settings left rail under Compliance & Privacy', async ({ page }) => {
    await page.goto('/admin/settings/branding');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Compliance & Privacy')).toBeVisible();
    await expect(page.getByRole('link', { name: 'DSAR' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Error-state specs — all mocked
// ---------------------------------------------------------------------------

test.describe('DSAR Console — error states', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('fulfillment button is not visible without a subject selected', async ({ page }) => {
    await mockDsarApis(page);
    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');
    // No subject selected — the Fulfillment action button must not be in the DOM.
    await expect(page.getByTestId('dsar-open-fulfill')).not.toBeVisible();
  });

  test('SLA countdown shows overdue badge for past-due requests', async ({ page }) => {
    await page.route('**/spa/api/dsar/requests', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'req-overdue-1',
            tenant_id: 'nbe',
            customer_cid: 'CID-OVERDUE',
            action: 'article15_export',
            status: 'OVERDUE',
            requested_by: 'admin',
            requested_at: '2026-04-01T00:00:00Z',
            sla_due_at: '2026-04-30T00:00:00Z',
            days_remaining: -10,
            completed_at: null,
            regulator: 'GDPR',
            fulfillment_artifact_path: null,
            signed_receipt: null,
          }],
          count: 1,
        }),
      });
    });
    await page.route('**/spa/api/dsar/lookup*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ matches: [], count: 0 }) });
    });

    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('10d overdue')).toBeVisible();
    // Use exact match + role to avoid strict-mode violation (CID cell also contains OVERDUE).
    await expect(page.getByText('OVERDUE', { exact: true }).first()).toBeVisible();
  });

  test('inventory shows artifact counts after subject is selected', async ({ page }) => {
    const cid = 'CID-E2E-INVENTORY';

    await page.route('**/spa/api/dsar/lookup*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          matches: [{
            cid, name: 'Test Subject', tenant_id: 'nbe',
            cbs_source: null, match_axis: 'cid',
          }],
          count: 1,
        }),
      });
    });

    await page.route(`**/spa/api/dsar/subjects/${cid}/inventory`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          customer_cid: cid,
          panels: {
            documents: 12, ai_traces: 487, audit_events: 2184, workflows: 8, cbs_records: 427,
          },
        }),
      });
    });

    await page.route('**/spa/api/dsar/requests', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ items: [], count: 0 }) });
    });

    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');

    // Search.
    await page.getByTestId('dsar-search-input').fill(cid);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForLoadState('networkidle');

    // Click the matched subject.
    await page.getByText('Subject matched').waitFor({ state: 'visible' });
    await page.getByText(cid).first().click();
    await page.waitForLoadState('networkidle');

    // Panel counts should render.
    await expect(page.getByText('12')).toBeVisible();
    await expect(page.getByText('487')).toBeVisible();
    await expect(page.getByText('2,184')).toBeVisible();

    // Fulfillment button now visible.
    await expect(page.getByTestId('dsar-open-fulfill')).toBeVisible();
  });

  test('FulfillModal opens when Fulfillment action button is clicked', async ({ page }) => {
    const cid = 'CID-MODAL-TEST';

    await page.route('**/spa/api/dsar/lookup*', (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          matches: [{ cid, name: null, tenant_id: 'nbe', cbs_source: null, match_axis: 'cid' }],
          count: 1,
        }),
      });
    });
    await page.route(`**/spa/api/dsar/subjects/${cid}/inventory`, (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          customer_cid: cid,
          panels: { documents: 0, ai_traces: 0, audit_events: 0, workflows: 0, cbs_records: 0 },
        }),
      });
    });
    await page.route('**/spa/api/dsar/requests', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ items: [], count: 0 }) });
    });

    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('dsar-search-input').fill(cid);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForLoadState('networkidle');

    await page.getByText('Subject matched').waitFor({ state: 'visible' });
    await page.getByText(cid).first().click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('dsar-open-fulfill').click();
    // Modal heading (h2) should be visible — use getByRole to avoid strict-mode violation.
    await expect(page.getByRole('heading', { name: 'Fulfillment Action' })).toBeVisible();
    await expect(page.getByText('Article 15 — Data Export')).toBeVisible();
    await expect(page.getByText('Article 17 — Cryptoshred')).toBeVisible();
  });

  test('cryptoshred action requires confirmation text', async ({ page }) => {
    const cid = 'CID-SHRED-TEST';

    await page.route('**/spa/api/dsar/lookup*', (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          matches: [{ cid, name: null, tenant_id: 'nbe', cbs_source: null, match_axis: 'cid' }],
          count: 1,
        }),
      });
    });
    await page.route(`**/spa/api/dsar/subjects/${cid}/inventory`, (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          customer_cid: cid,
          panels: { documents: 5, ai_traces: 10, audit_events: 20, workflows: 2, cbs_records: 1 },
        }),
      });
    });
    await page.route('**/spa/api/dsar/requests', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ items: [], count: 0 }) });
    });

    await page.goto('/admin/dsar');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('dsar-search-input').fill(cid);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByText('Subject matched').waitFor({ state: 'visible' });
    await page.getByText(cid).first().click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('dsar-open-fulfill').click();
    await page.getByText('Article 17 — Cryptoshred').click();

    // The danger confirmation input must appear.
    await expect(page.getByPlaceholder('cryptoshred')).toBeVisible();

    // Without the confirmation text, the Confirm Cryptoshred button is disabled.
    const submitBtn = page.getByRole('button', { name: 'Confirm Cryptoshred' });
    await expect(submitBtn).toBeDisabled();

    // Type the confirmation — button should become enabled.
    await page.getByPlaceholder('cryptoshred').fill('cryptoshred');
    await expect(submitBtn).toBeEnabled();
  });
});
