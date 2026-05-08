/**
 * E2E tests for the Dedup Settings admin page.
 *
 * Mocked tests run unconditionally.
 * Happy-path tests that require a live backend are gated on BACKEND_READY=1.
 *
 * Run with: npx playwright test dedup-settings.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const SETTINGS_URL = '**/spa/api/admin/dedup-settings';
const DECISIONS_URL = '**/spa/api/admin/dedup-decisions';

const MOCK_SETTINGS = {
  fuzzy_threshold: 80,
  phash_distance: 10,
  updated_at: '2026-04-01T10:00:00Z',
  updated_by: 'admin',
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

test.beforeEach(({ }, testInfo) => {
  if (process.env['BACKEND_READY'] !== '1') {
    testInfo.skip(true, 'BACKEND_READY is not set — skipping until backend is available');
  }
});

test.describe('Dedup Settings page — mocked', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('renders sliders at values returned by GET', async ({ page }) => {
    await page.route(SETTINGS_URL, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SETTINGS),
        });
      }
      return route.continue();
    });

    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DECISIONS),
      }),
    );

    await page.goto('/admin/dedup-settings');

    // Fuzzy threshold slider should reflect 80
    const fuzzySlider = page.getByTestId('dedup-fuzzy-threshold');
    await expect(fuzzySlider).toBeVisible();
    await expect(fuzzySlider).toHaveValue('80');

    // pHash distance slider should reflect 10
    const phashSlider = page.getByTestId('dedup-phash-distance');
    await expect(phashSlider).toBeVisible();
    await expect(phashSlider).toHaveValue('10');

    // Numeric inputs should also show correct values
    await expect(page.getByTestId('dedup-fuzzy-threshold-number')).toHaveValue('80');
    await expect(page.getByTestId('dedup-phash-distance-number')).toHaveValue('10');
  });

  test('Save button fires PUT with updated slider values', async ({ page }) => {
    let capturedBody: unknown = null;

    await page.route(SETTINGS_URL, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SETTINGS),
        });
      }
      if (route.request().method() === 'PUT') {
        capturedBody = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            fuzzy_threshold: 65,
            phash_distance: 8,
            updated_at: '2026-04-18T10:00:00Z',
            updated_by: 'admin',
          }),
        });
      }
      return route.continue();
    });

    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    // Change fuzzy threshold via number input
    const fuzzyNumber = page.getByTestId('dedup-fuzzy-threshold-number');
    await fuzzyNumber.fill('65');
    await fuzzyNumber.press('Tab');

    // Change phash distance via number input
    const phashNumber = page.getByTestId('dedup-phash-distance-number');
    await phashNumber.fill('8');
    await phashNumber.press('Tab');

    // Save
    await page.getByTestId('dedup-save').click();
    await expect(page.getByTestId('dedup-save-ok')).toBeVisible();

    // PUT body should carry the new values
    expect(capturedBody).toMatchObject({ fuzzy_threshold: 65, phash_distance: 8 });
  });

  test('Reset to defaults restores sliders to 80 / 10', async ({ page }) => {
    await page.route(SETTINGS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_SETTINGS, fuzzy_threshold: 55, phash_distance: 20 }),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    // Confirm current values
    await expect(page.getByTestId('dedup-fuzzy-threshold')).toHaveValue('55');

    // Reset
    await page.getByTestId('dedup-reset').click();

    await expect(page.getByTestId('dedup-fuzzy-threshold')).toHaveValue('80');
    await expect(page.getByTestId('dedup-phash-distance')).toHaveValue('10');
  });

  test('decisions table shows when endpoint returns 200', async ({ page }) => {
    await page.route(SETTINGS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SETTINGS),
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
    await page.route(SETTINGS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SETTINGS),
      }),
    );
    await page.route(DECISIONS_URL, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) }),
    );

    await page.goto('/admin/dedup-settings');

    await expect(page.getByTestId('dedup-decisions-table')).not.toBeVisible();
  });
});
