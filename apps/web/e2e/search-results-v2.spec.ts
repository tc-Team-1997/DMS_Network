/**
 * Plan 3 (Wave-E1) — Task #7: Search Results v2 (mockup screen 17).
 *
 * Asserts the NEW /search/v2 page only (apps/web/src/modules/search/
 * SearchPageV2.tsx + routes/spa-api/search-v2.js). The legacy /search FTS
 * page is covered by the existing apps/web/e2e/search-v2.spec.ts — that
 * file's name is historical; this Plan-3 spec lives at a different path
 * to keep both sets of assertions independent.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Search v2 page renders empty-state shell with no query', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2');

  await expect(page.getByTestId('search-v2-page')).toBeVisible();
  await expect(page.getByText(/Enter a query to search the corpus/i)).toBeVisible();
});

test('Operator chips render from URL state', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport&type=passport&branch=cairo');

  await expect(page.getByTestId('search-token-chip-type')).toContainText('type:passport');
  await expect(page.getByTestId('search-token-chip-branch')).toContainText('branch:cairo');
});

test('Facets sidebar (desktop) exposes the three required groups', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop-only — mobile uses a collapsible drawer');
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport');

  // On desktop the sidebar renders twice (mobile-hidden + desktop-visible).
  // We assert against the first .visible match.
  const sidebar = page.getByTestId('search-facets-sidebar').first();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByTestId('search-facet-group-type')).toBeVisible();
  await expect(sidebar.getByTestId('search-facet-group-branch')).toBeVisible();
  await expect(sidebar.getByTestId('search-facet-group-status')).toBeVisible();
});

test('Removing a token chip drops the param from the URL', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport&type=passport');

  await page.getByTestId('search-token-chip-type').getByRole('button', { name: /remove/i }).click();
  await expect(page).toHaveURL(/q=passport/);
  await expect(page).not.toHaveURL(/type=/);
});

test('Mobile layout exposes the facets toggle', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only');
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport');

  await expect(page.getByTestId('search-facets-toggle')).toBeVisible();
  await page.getByTestId('search-facets-toggle').click();
  // Sidebar becomes visible after toggle.
  await expect(page.getByTestId('search-facets-sidebar').first()).toBeVisible();
});

test('Result row exposes the per-result action contract', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/search/v2?q=passport');

  const rowCount = await page.getByTestId('search-result-row').count();
  test.skip(rowCount === 0, 'no seeded results for "passport"; cannot assert action contract');

  const row = page.getByTestId('search-result-row').first();
  await expect(row.getByTestId('result-action-open').first()).toBeVisible();
  await expect(row.getByTestId('result-action-download')).toBeVisible();
  await expect(row.getByTestId('result-action-ask-docbrain')).toBeVisible();

  const cta = page.getByTestId('search-ask-docbrain-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toContainText(/Ask DocBrain about/i);
});
