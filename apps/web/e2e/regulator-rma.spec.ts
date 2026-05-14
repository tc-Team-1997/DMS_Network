/**
 * Plan 3 (Wave-E1) — Task #3: RMA Quarterly Compliance Report.
 *
 * Three specs against the live stack:
 *   1. BT RMA card appears in the library and detail page renders the
 *      period selector + control checklist.
 *   2. Export bundle emits a `regulator.report_export` audit row.
 *   3. Submit opens the confirm dialog.
 *
 * Migration 0046 seeds the BT RMA template row into `regulator_reports`
 * (tenant_id='bhu', regulator='RMA', name='RMA Quarterly Compliance Report').
 * Run `DB_PATH=db/nbe-dms.db node db/seed.js` before this spec to ensure the
 * row is present.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('RMA quarterly template appears in library and renders detail', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');

  const card = page.getByTestId('regulator-template-card-rma-quarterly-bt');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Bhutan|RMA/i);
  await expect(card).toContainText(/Quarterly/i);
  await expect(card).toContainText(/15 days/i);

  await card.click();
  await expect(page).toHaveURL(/\/regulator-reports\/rma\/\d+/);
  await expect(page.getByTestId('rma-period-selector')).toBeVisible();
  await expect(page.getByTestId('rma-control-checklist')).toBeVisible();
});

test('RMA export emits regulator.report_export audit event', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');
  await page.getByTestId('regulator-template-card-rma-quarterly-bt').click();

  // Complete all 5 control checkboxes to enable the Export button.
  const controls = page.getByTestId('rma-control-checklist').locator('button[role="checkbox"]');
  const n = await controls.count();
  for (let i = 0; i < n; i++) await controls.nth(i).click();

  await page.getByTestId('rma-export-bundle').click();
  await page.getByTestId('rma-export-confirm').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  // Audit row carries the canonical Plan 3 action key.
  const r = await request.get('/spa/api/audit?limit=1&action=regulator.report_export');
  const body = await r.json();
  const events = Array.isArray(body.events) ? body.events : (Array.isArray(body) ? body : []);
  expect(events[0]).toMatchObject({ action: 'regulator.report_export' });
});

test('RMA submit opens the confirm dialog', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/regulator-reports');
  await page.getByTestId('regulator-template-card-rma-quarterly-bt').click();

  // Export first so the Submit button enables.
  const controls = page.getByTestId('rma-control-checklist').locator('button[role="checkbox"]');
  const n = await controls.count();
  for (let i = 0; i < n; i++) await controls.nth(i).click();
  await page.getByTestId('rma-export-bundle').click();
  await page.getByTestId('rma-export-confirm').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  await page.getByTestId('rma-submit').click();
  await expect(page.getByTestId('rma-submit-confirm-dialog')).toBeVisible();
});
