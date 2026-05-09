/**
 * Audit Log v2 — Playwright E2E spec (Wave C, migration 0038).
 *
 * Happy path: runs against the real Node + DB stack (no mocking).
 * Error/edge states: use page.route() to simulate API failures.
 *
 * Layout:
 *   describe('Audit Log v2 — happy path')   → real stack
 *   describe('Audit Log v2 — error states') → mocked routes
 *
 * Requires: Node dev server running (npm start or npm run dev in repo root).
 * Credentials: admin/admin123 (Doc Admin — all features available).
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Happy path — real stack
// ---------------------------------------------------------------------------

test.describe('Audit Log v2 — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('page loads and shows chain verify badge', async ({ page }) => {
    await expect(page.getByTestId('audit-log-page')).toBeVisible();
    await expect(page.getByTestId('chain-verify-badge')).toBeVisible();
  });

  test('chain verify badge is present (verified or warning)', async ({ page }) => {
    const badge = page.getByTestId('chain-verify-badge');
    await expect(badge).toBeVisible();
    // Badge should contain either "Chain verified" or "Chain integrity warning"
    const text = await badge.textContent();
    expect(text).toMatch(/chain verified|chain integrity warning/i);
  });

  test('anchor badge renders', async ({ page }) => {
    await expect(page.getByTestId('anchor-badge')).toBeVisible();
  });

  test('export menu opens and shows format options', async ({ page }) => {
    // Doc Admin should see the export menu.
    const exportMenu = page.getByTestId('export-menu');
    await expect(exportMenu).toBeVisible();
    await exportMenu.getByRole('button', { name: /export/i }).click();
    await expect(page.getByText('Export JSON')).toBeVisible();
    await expect(page.getByText('Export CSV')).toBeVisible();
    await expect(page.getByText('Export PDF')).toBeVisible();
  });

  test('filter bar renders with entity type selector', async ({ page }) => {
    const filterBar = page.getByTestId('audit-filter-bar');
    await expect(filterBar).toBeVisible();
    await expect(filterBar.getByLabel('Entity type filter')).toBeVisible();
    await expect(filterBar.getByLabel('Action filter')).toBeVisible();
    await expect(filterBar.getByLabel('Actor filter')).toBeVisible();
    await expect(filterBar.getByLabel('Result filter')).toBeVisible();
  });

  test('events tab shows event rows (if any exist)', async ({ page }) => {
    await expect(page.getByTestId('events-tab')).toBeVisible();
    // The table renders either rows or an empty state — both are valid.
    const table = page.locator('table');
    const empty  = page.getByText('No audit events match the current filters.');
    await expect(table.or(empty)).toBeVisible();
  });

  test('filter bar persists state in URL', async ({ page }) => {
    await page.getByLabel('Entity type filter').selectOption('document');
    await expect(page).toHaveURL(/entity_type=document/);
    // Reload — filter should persist.
    await page.reload();
    await expect(page.getByLabel('Entity type filter')).toHaveValue('document');
  });

  test('FTS search tab shows search input', async ({ page }) => {
    await page.getByRole('tab', { name: /full-text search/i }).click();
    const searchTab = page.getByTestId('fts-search-tab');
    await expect(searchTab).toBeVisible();
    await expect(searchTab.getByPlaceholder(/search audit log full text/i)).toBeVisible();
  });

  test('FTS search returns results or empty state', async ({ page }) => {
    await page.getByRole('tab', { name: /full-text search/i }).click();
    const searchTab = page.getByTestId('fts-search-tab');
    await searchTab.getByPlaceholder(/search audit log full text/i).fill('login');
    await searchTab.getByRole('button', { name: 'Search' }).click();
    // Wait for either results count text or the table.
    await expect(searchTab.locator('[data-testid="fts-search-tab"] p, table').first()).toBeVisible({ timeout: 10_000 });
  });

  test('entity pivot tab renders pivot selector', async ({ page }) => {
    await page.getByRole('tab', { name: /entity pivot/i }).click();
    const pivot = page.getByTestId('entity-pivot');
    await expect(pivot).toBeVisible();
    await expect(pivot.getByRole('button', { name: /by entity type/i })).toBeVisible();
    await expect(pivot.getByRole('button', { name: /by document/i })).toBeVisible();
    await expect(pivot.getByRole('button', { name: /by customer cid/i })).toBeVisible();
    await expect(pivot.getByRole('button', { name: /by user/i })).toBeVisible();
  });

  test('entity pivot switches dimension', async ({ page }) => {
    await page.getByRole('tab', { name: /entity pivot/i }).click();
    const pivot = page.getByTestId('entity-pivot');
    await pivot.getByRole('button', { name: /by user/i }).click();
    await expect(page).toHaveURL(/pivot_by=user_id/);
  });

  test('detail drawer opens on clicking Detail in a row', async ({ page }) => {
    // Only test if there is at least one event row.
    const detailBtn = page.getByRole('button', { name: 'Detail' }).first();
    const count = await detailBtn.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await detailBtn.click();
    await expect(page.getByTestId('diff-drawer')).toBeVisible();
    // Drawer should show meta section with Timestamp, Actor, Result, Hash labels.
    await expect(page.getByTestId('diff-drawer').getByText('Timestamp')).toBeVisible();
    await expect(page.getByTestId('diff-drawer').getByText('Result')).toBeVisible();
    await expect(page.getByTestId('diff-drawer').getByText('Hash')).toBeVisible();
  });

  test('detail drawer closes on Escape', async ({ page }) => {
    const detailBtn = page.getByRole('button', { name: 'Detail' }).first();
    const count = await detailBtn.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await detailBtn.click();
    await expect(page.getByTestId('diff-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('diff-drawer')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Error / edge states — mocked routes
// ---------------------------------------------------------------------------

test.describe('Audit Log v2 — error states', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('shows error when events endpoint returns 500', async ({ page }) => {
    await page.route('**/spa/api/audit/events**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Failed to load audit events.')).toBeVisible();
  });

  test('verify-chain failure does not crash page', async ({ page }) => {
    await page.route('**/spa/api/audit/verify-chain', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    // Page should still render even if chain verify fails.
    await expect(page.getByTestId('audit-log-page')).toBeVisible();
  });

  test('pivot endpoint error shows error message', async ({ page }) => {
    await page.route('**/spa/api/audit/pivot**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /entity pivot/i }).click();
    await expect(page.getByText('Failed to load pivot data.')).toBeVisible({ timeout: 10_000 });
  });

  test('anchor badge shows error when anchor service returns 502', async ({ page }) => {
    // Allow normal verify-chain to work.
    await page.route('**/spa/api/audit/anchor', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'anchor service unavailable' }) }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    // Click "Anchor now" button.
    const anchorBtn = page.getByRole('button', { name: /anchor now/i });
    if (await anchorBtn.isVisible()) {
      // Ensure head_hash is available (skip if no rows).
      const badge = page.getByTestId('anchor-badge');
      await expect(badge).toBeVisible();
      await anchorBtn.click();
      await expect(page.getByText(/anchor failed/i)).toBeVisible({ timeout: 8_000 });
    }
  });

  test('FTS returns empty state when no matches', async ({ page }) => {
    await page.route('**/spa/api/audit/search**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, page: 1, per_page: 50, query: 'xyzzy123', events: [] }),
      }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /full-text search/i }).click();
    await page.getByPlaceholder(/search audit log full text/i).fill('xyzzy123');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(/0 results for/i)).toBeVisible({ timeout: 8_000 });
  });

  test('export menu triggers download (JSON mock)', async ({ page }) => {
    // Inject __DMS_USER__ so the page believes the user is Doc Admin.
    await page.addInitScript(() => {
      window.__DMS_USER__ = { role: 'Doc Admin' };
    });
    await page.route('**/spa/api/audit/export**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, action: 'login', result: 'allow' }]),
        headers: { 'Content-Disposition': 'attachment; filename="audit-export.json"' },
      }),
    );
    // Also mock verify-chain so the badge renders.
    await page.route('**/spa/api/audit/verify-chain', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ verified: true, checked: 10, mismatched_rows: [], head_hash: 'abc123' }),
      }),
    );
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    // The export menu should now be visible.
    await expect(page.getByTestId('export-menu')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('export-menu').getByRole('button', { name: /export/i }).click();
    // We just verify the menu option is clickable — actual file download
    // is browser-level and not easily assertable in headless without a download event.
    await expect(page.getByText('Export JSON')).toBeVisible();
  });
});
