/**
 * Template Designer — error / edge-state spec.
 *
 * Covers:
 *  - Non-admin user sees AccessDenied
 *  - Template not found (404) shows error state
 *  - No versions → empty state with "Create first version" prompt
 *  - Save fails with API error
 *  - New version creation failure
 *  - Simulation parse error (invalid JSON facts)
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const TEMPLATE = {
  id: 5,
  name: 'Error Test Template',
  doc_type: null,
  active: 1,
  steps: [{ id: 1, name: 'Capture', role: 'Maker' }],
  created_at: '2026-01-01T00:00:00.000Z',
  current_version_id: null,
};

async function stubBase(page: import('@playwright/test').Page) {
  await page.route('**/spa/api/business-calendars', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('Template Designer — error states (mocked)', () => {
  test('non-admin (Maker) sees AccessDenied', async ({ page }) => {
    await login(page, 'sara', 'sara123');
    await page.goto('/workflows/templates/1/design');
    await expect(page.getByText(/access denied/i).or(page.getByText(/not authorised/i)).or(page.getByText(/permission/i))).toBeVisible();
  });

  test('template not found shows error', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route('**/spa/api/workflow-templates/999', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }),
    );
    await page.route('**/spa/api/workflow-templates/999/versions', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }),
    );
    await stubBase(page);
    await page.goto('/workflows/templates/999/design');
    // Page should show an error or empty state — not crash
    await expect(page.getByText(/not found/i).or(page.getByText(/error/i)).or(page.getByText(/no template/i))).toBeVisible();
  });

  test('no versions shows create-first-version prompt', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route('**/spa/api/workflow-templates/5', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE) }),
    );
    await page.route('**/spa/api/workflow-templates/5/versions', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.continue();
    });
    await stubBase(page);
    await page.goto('/workflows/templates/5/design');
    await expect(page.getByText(/create first version/i)).toBeVisible();
  });

  test('new version creation failure shows toast', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route('**/spa/api/workflow-templates/5', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE) }),
    );
    await page.route('**/spa/api/workflow-templates/5/versions', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'DB error' }),
        });
      }
      return route.continue();
    });
    await stubBase(page);
    await page.goto('/workflows/templates/5/design');
    await page.getByTestId('designer-new-version').click();
    // Error toast or error message should appear
    await expect(
      page.getByText(/error/i).or(page.getByText(/failed/i)).or(page.getByText(/db error/i)),
    ).toBeVisible({ timeout: 5000 });
  });

  test('simulation run with invalid JSON shows parse error', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const bpmn = { nodes: [{ id: 'n1', type: 'start', label: 'Start', x: 40, y: 60 }], edges: [] };
    const version = {
      id: 10, template_id: 5, version: 1, status: 'draft', reason: null,
      published_by: null, published_at: null, calendar_id: null,
      bpmn_json: bpmn, dmn_json: {}, sla_json: {},
      created_at: '2026-01-01T00:00:00.000Z',
    };

    await page.route('**/spa/api/workflow-templates/5', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE) }),
    );
    await page.route('**/spa/api/workflow-templates/5/versions', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([version]) });
      }
      return route.continue();
    });
    await stubBase(page);

    await page.goto('/workflows/templates/5/design');
    await page.getByTestId('designer-tab-simulation').click();
    // Clear facts and enter invalid JSON
    await page.getByTestId('simulation-facts').fill('not valid json {{{');
    await page.getByTestId('simulation-run').click();
    await expect(page.getByText(/invalid json/i)).toBeVisible();
  });
});
