/**
 * E2E tests for the Dedup Settings admin page.
 *
 * As of migration 0036, dedup thresholds are stored in tenant_config
 * namespace "capture" (keys: dedup.fuzzy_min_ratio, dedup.phash_max_distance).
 * The page reads via GET /spa/api/admin/config/capture and writes via
 * PUT /spa/api/admin/config/capture.
 *
 * All tests mock the API — no live backend required.
 *
 * Run with: npx playwright test dedup-settings.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const CONFIG_URL    = '**/spa/api/admin/config/capture';
const DECISIONS_URL = '**/spa/api/admin/dedup-decisions';

// tenant_config stores fraction 0–1; UI shows 0–100%
const MOCK_CONFIG = {
  'dedup.fuzzy_min_ratio': 0.8,
  'dedup.phash_max_distance': 10,
};

const MOCK_CONFIG_RESPONSE = {
  tenant_id: 'nbe',
  namespace: 'capture',
  key: 'dedup.fuzzy_min_ratio',
  value: 0.65,
  hash: 'a'.repeat(64),
  changed_at: '2026-04-18T10:00:00Z',
};

const MOCK_DECISIONS = [
  {
    id: 1,
    doc_id: 42,
    matched_doc_id: 37,
    score: 0.93,
    decision: 'duplicate',
    created_at: '2026-04-10T12:00:00Z',
  },
  {
    id: 2,
    doc_id: 55,
    matched_doc_id: 51,
    score: 0.72,
    decision: 'similar',
    created_at: '2026-04-11T08:30:00Z',
  },
];

test.describe('Dedup Settings page — mocked', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('renders sliders seeded from tenant_config capture namespace', async ({ page }) => {
    await page.route(CONFIG_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CONFIG),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    // 0.8 fraction → 80 %
    const fuzzySlider = page.getByTestId('dedup-fuzzy-threshold');
    await expect(fuzzySlider).toBeVisible();
    await expect(fuzzySlider).toHaveValue('80');

    const phashSlider = page.getByTestId('dedup-phash-distance');
    await expect(phashSlider).toBeVisible();
    await expect(phashSlider).toHaveValue('10');

    await expect(page.getByTestId('dedup-fuzzy-threshold-number')).toHaveValue('80');
    await expect(page.getByTestId('dedup-phash-distance-number')).toHaveValue('10');
  });

  test('Save button requires reason ≥ 20 chars before calling PUT', async ({ page }) => {
    await page.route(CONFIG_URL, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_CONFIG),
        });
      }
      return route.continue();
    });
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    // Try to save without a reason
    await page.getByTestId('dedup-save').click();
    // Reason error should appear; success banner should NOT appear
    await expect(page.getByText(/Reason must be at least 20/i)).toBeVisible();
    await expect(page.getByTestId('dedup-save-ok')).not.toBeVisible();
  });

  test('Save fires PUT for both keys and shows success on valid reason', async ({ page }) => {
    const putRequests: string[] = [];

    await page.route(CONFIG_URL, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_CONFIG),
        });
      }
      if (route.request().method() === 'PUT') {
        const body = route.request().postData() ?? '';
        putRequests.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_CONFIG_RESPONSE),
        });
      }
      return route.continue();
    });
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    // Change fuzzy threshold via number input
    await page.getByTestId('dedup-fuzzy-threshold-number').fill('65');
    await page.getByTestId('dedup-fuzzy-threshold-number').press('Tab');

    // Fill a valid reason
    await page.getByTestId('dedup-reason').fill('Tuning thresholds after Q1 duplicate review audit');

    // Save
    await page.getByTestId('dedup-save').click();
    await expect(page.getByTestId('dedup-save-ok')).toBeVisible({ timeout: 5000 });

    // Two PUT calls (one for each key)
    expect(putRequests.length).toBe(2);
    const firstBody = JSON.parse(putRequests[0] ?? '{}') as Record<string, unknown>;
    expect(firstBody['key']).toBe('dedup.fuzzy_min_ratio');
    // 65% → 0.65 fraction
    expect(Number(firstBody['value'])).toBeCloseTo(0.65, 2);
  });

  test('Reset to defaults restores sliders to 80 % / 10 bits', async ({ page }) => {
    await page.route(CONFIG_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          'dedup.fuzzy_min_ratio': 0.55,
          'dedup.phash_max_distance': 20,
        }),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');
    await expect(page.getByTestId('dedup-fuzzy-threshold')).toHaveValue('55');

    await page.getByTestId('dedup-reset').click();

    await expect(page.getByTestId('dedup-fuzzy-threshold')).toHaveValue('80');
    await expect(page.getByTestId('dedup-phash-distance')).toHaveValue('10');
  });

  test('decisions table shows when endpoint returns 200', async ({ page }) => {
    await page.route(CONFIG_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CONFIG),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DECISIONS),
      }),
    );

    await page.goto('/admin/dedup-settings');

    const table = page.getByTestId('dedup-decisions-table');
    await expect(table).toBeVisible();
    await expect(table.getByText('#42')).toBeVisible();
    await expect(table.getByText('duplicate')).toBeVisible();
  });

  test('decisions table hidden when endpoint returns 404', async ({ page }) => {
    await page.route(CONFIG_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CONFIG),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    await expect(page.getByTestId('dedup-decisions-table')).not.toBeVisible();
  });

  test('shows 404 banner when config namespace is missing', async ({ page }) => {
    await page.route(CONFIG_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'namespace not found' }) }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    await expect(page.getByTestId('dedup-settings-404')).toBeVisible();
  });
});
