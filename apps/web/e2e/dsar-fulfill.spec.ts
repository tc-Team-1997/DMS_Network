import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('DSAR full lifecycle — open, lookup, 5-panel inventory, SLA countdown, Article 15 export', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/dsar');

  // Open new DSAR for seed customer
  await page.getByTestId('dsar-new-request').click();
  await page.getByTestId('dsar-axis-cid').click();
  await page.getByTestId('dsar-search-input').fill('CID-001234');
  await page.getByTestId('dsar-submit').click();
  await expect(page.getByTestId('dsar-subject-card')).toContainText('CID-001234');

  // Navigate to subject row to view inventory
  await page.getByTestId('dsar-subject-row-CID-001234').click();

  // 5-panel inventory must render with all testids visible
  await expect(page.getByTestId('dsar-panel-documents')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-ai-traces')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-audit-events')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-workflows')).toBeVisible();
  await expect(page.getByTestId('dsar-panel-cbs-records')).toBeVisible();

  // SLA countdown bar visible with remaining days
  await expect(page.getByTestId('dsar-sla-countdown')).toContainText(/\d+\s*d/);

  // Run Article 15 export
  await page.getByTestId('dsar-fulfill-article15').click();
  await page.getByTestId('dsar-fulfill-confirm').click();
  await expect(page.getByTestId('toast-success')).toContainText(/exported|bundle/i);

  // Verify audit row written with policy_decision populated
  const auditResp = await request.get('/spa/api/audit?limit=1&action=dsar.fulfill');
  const auditBody = await auditResp.json() as any;
  expect(auditBody.events).toBeDefined();
  expect(auditBody.events.length).toBeGreaterThan(0);
  expect(auditBody.events[0].policy_decision).toBeTruthy();
  const decision = JSON.parse(auditBody.events[0].policy_decision as string);
  expect(decision.role).toBeTruthy();
});

test('DSAR Article 17 cryptoshred — double-confirm with DESTROY token', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/dsar');

  // Open new DSAR for seed customer
  await page.getByTestId('dsar-new-request').click();
  await page.getByTestId('dsar-axis-cid').click();
  await page.getByTestId('dsar-search-input').fill('CID-001234');
  await page.getByTestId('dsar-submit').click();
  await expect(page.getByTestId('dsar-subject-card')).toContainText('CID-001234');

  // Navigate to subject row
  await page.getByTestId('dsar-subject-row-CID-001234').click();
  await expect(page.getByTestId('dsar-panel-documents')).toBeVisible();

  // Click Article 17 fulfillment action
  await page.getByTestId('dsar-fulfill-article17').click();

  // First confirmation step visible
  await expect(page.getByTestId('dsar-cryptoshred-confirm-1')).toBeVisible();
  await page.getByTestId('dsar-cryptoshred-confirm-1-button').click();

  // Second confirmation step visible with text input
  await expect(page.getByTestId('dsar-cryptoshred-confirm-2')).toBeVisible();
  await page.getByLabel(/type "DESTROY" to confirm/i).fill('DESTROY');
  await page.getByTestId('dsar-cryptoshred-confirm-2-button').click();

  // Success toast confirms cryptoshred completion
  await expect(page.getByTestId('toast-success')).toContainText(/cryptoshred|destroyed|permanently/i);
});

test('DSAR mobile layout — 5-panel inventory collapses to single column', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only test');

  await login(page, 'admin', 'admin123');
  await page.goto('/admin/dsar');

  // Open new DSAR for seed customer
  await page.getByTestId('dsar-new-request').click();
  await page.getByTestId('dsar-axis-cid').click();
  await page.getByTestId('dsar-search-input').fill('CID-001234');
  await page.getByTestId('dsar-submit').click();
  await expect(page.getByTestId('dsar-subject-card')).toContainText('CID-001234');

  // Navigate to subject row
  await page.getByTestId('dsar-subject-row-CID-001234').click();
  await expect(page.getByTestId('dsar-panel-documents')).toBeVisible();

  // Verify grid layout switches to 1 column on mobile
  const grid = page.getByTestId('dsar-inventory-grid');
  await expect(grid).toBeVisible();
  // On mobile (< sm breakpoint), grid should have only 1 column
  const styles = await grid.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return computed.gridTemplateColumns;
  });
  // Single column will be a single dimension, not multiple space-separated values
  expect(/^[^,\s]+$|^1fr$|^[a-z0-9%]+$/.test(styles)).toBe(true);
});
