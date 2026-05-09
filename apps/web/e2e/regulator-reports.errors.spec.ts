/**
 * E2E error-state tests for Regulator Reports — Wave C.
 * All tests use page.route() to mock API responses.
 *
 * Run with: npx playwright test regulator-reports.errors.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Error: Template list API failure', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route('**/spa/api/reports/templates**', (route) => {
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'service unavailable' }) });
    });
  });

  test('library page shows error empty-state when API fails', async ({ page }) => {
    await page.goto('/regulator-reports');
    await page.waitForLoadState('networkidle');

    // Should show error state — heading still visible, templates list shows error
    await expect(page.getByText('Regulator Reports')).toBeVisible();
    await expect(page.getByText('Could not load templates')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Error: Template not found (404)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route('**/spa/api/reports/templates/99999', (route) => {
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'template not found' }) });
    });
  });

  test('detail page shows not-found state for missing template', async ({ page }) => {
    await page.goto('/regulator-reports/99999');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Template not found')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Error: Submission list API failure', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('submissions endpoint 500 shows error state on submissions tab', async ({ page }) => {
    // Get a real template id first
    const resp = await page.evaluate(async () => {
      const r = await fetch('/spa/api/reports/templates');
      return r.json();
    });
    const firstId: number = resp.templates[0]?.id ?? 1;

    // Mock the submissions endpoint to fail
    await page.route('**/spa/api/reports/submissions**', (route) => {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
    });

    await page.goto(`/regulator-reports/${firstId}`);
    await page.getByRole('tab', { name: 'Submission log' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Could not load submissions')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Error: Create template validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('POST with missing regulator returns 400', async ({ page }) => {
    const resp = await page.evaluate(async () => {
      const r = await fetch('/spa/api/reports/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No regulator', format: 'pdf', parameters_schema_json: '{}' }),
      });
      return { status: r.status };
    });
    expect(resp.status).toBe(400);
  });

  test('POST with invalid format returns 400', async ({ page }) => {
    const resp = await page.evaluate(async () => {
      const r = await fetch('/spa/api/reports/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regulator: 'TEST', name: 'Bad format test',
          format: 'xlsx',  // not allowed — xlsx absent
          parameters_schema_json: '{}',
        }),
      });
      return { status: r.status };
    });
    expect(resp.status).toBe(400);
  });
});

test.describe('Error: Unauthorised access (Viewer role)', () => {
  test.beforeEach(async ({ page }) => {
    // Viewer role cannot read regulator reports
    await login(page, 'nour', 'nour123');
  });

  test('viewer gets 403 on templates list', async ({ page }) => {
    const resp = await page.evaluate(async () => {
      const r = await fetch('/spa/api/reports/templates');
      return { status: r.status };
    });
    expect(resp.status).toBe(403);
  });

  test('viewer gets 403 on create template', async ({ page }) => {
    const resp = await page.evaluate(async () => {
      const r = await fetch('/spa/api/reports/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regulator: 'RMA', name: 'Test', format: 'pdf', parameters_schema_json: '{}' }),
      });
      return { status: r.status };
    });
    expect(resp.status).toBe(403);
  });
});
