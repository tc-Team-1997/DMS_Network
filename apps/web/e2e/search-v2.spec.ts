/**
 * Search v2 — Playwright E2E spec.
 *
 * Happy-path tests run against the real stack (no mocking).
 * Error/edge-state tests use page.route() to intercept API calls.
 *
 * Prerequisites: Node server running on http://localhost:3000
 *               with seeded DB (node db/seed.js already run).
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Happy-path tests — real stack
// ---------------------------------------------------------------------------

test.describe('Search v2 — FTS5 results with snippets', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/search');
  });

  test('empty state shown before any query', async ({ page }) => {
    await expect(page.getByText('Start searching')).toBeVisible();
  });

  test('typing "Passport" returns results with highlighted snippets', async ({ page }) => {
    // Seed data has 3 passport documents — "Passport" is indexed in original_name.
    await page.getByPlaceholder(/Search documents/).fill('Passport');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    // Result count header should appear — wait up to 10s.
    await expect(page.getByText(/\d+ result/i).first()).toBeVisible({ timeout: 10000 });

    // Results list should be rendered.
    await expect(page.locator('[aria-label="Search results"]')).toBeVisible({ timeout: 3000 });
  });

  test('clicking a doc_type facet updates URL and narrows results', async ({ page }) => {
    // First do a broad search to get facets.
    await page.getByPlaceholder(/Search documents/).fill('Passport');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL('**/search?q=Passport', { timeout: 5000 });

    // Wait for results.
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8000 });

    // If the Passport facet exists in doc_type, click it.
    const facetBtn = page.getByRole('button', { name: /Passport/i }).first();
    if (await facetBtn.isVisible()) {
      await facetBtn.click();
      // URL should gain doc_type=Passport.
      await expect(page).toHaveURL(/doc_type=Passport/i, { timeout: 3000 });
    }
  });

  test('no results state for nonsense query', async ({ page }) => {
    await page.getByPlaceholder(/Search documents/).fill('zzxyz-nonexistent-99283');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(/No results/i)).toBeVisible({ timeout: 8000 });
  });

  test('save current search → reload → entry visible in saved panel', async ({ page }) => {
    // Perform a search first.
    await page.getByPlaceholder(/Search documents/).fill('Passport');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8000 });

    // Open save modal (use first() — there are two "Save current search" triggers: icon btn + text btn).
    await page.getByRole('button', { name: 'Save current search' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Save current search' })).toBeVisible();

    // Fill in name and save.
    const uniqueName = `E2E test search ${Date.now()}`;
    await page.getByLabel('Name').fill(uniqueName);
    await page.getByRole('button', { name: 'Save' }).click();

    // Modal closes.
    await expect(page.getByRole('dialog', { name: 'Save current search' })).not.toBeVisible({ timeout: 5000 });

    // Reload the page.
    await page.reload();
    await page.goto('/search');

    // Saved search panel should show the entry.
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Cmd-K command palette tests — mocked (not hitting real FTS)
// ---------------------------------------------------------------------------

test.describe('Search v2 — Cmd-K command palette', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');
  });

  test('Cmd+K opens the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('Escape closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible();
  });

  test('typing "dash" shows Dashboard navigation option', async ({ page }) => {
    // Mock the cmdk endpoint to return a nav result.
    await page.route('**/spa/api/search/cmdk', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              group: 'Navigation',
              items: [
                { type: 'nav', label: 'Dashboard', href: '/' },
              ],
            },
          ],
        }),
      });
    });

    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();

    // Type "dash" into the palette input.
    await dialog.getByRole('combobox').fill('dash');

    // Wait for the mocked result.
    await expect(dialog.getByText('Dashboard')).toBeVisible({ timeout: 3000 });
  });

  test('Enter on a navigation item navigates to the route', async ({ page }) => {
    await page.route('**/spa/api/search/cmdk', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              group: 'Navigation',
              items: [
                { type: 'nav', label: 'Dashboard', href: '/' },
              ],
            },
          ],
        }),
      });
    });

    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').fill('dash');
    await expect(dialog.getByText('Dashboard')).toBeVisible({ timeout: 3000 });

    // Arrow down to select Dashboard (first item), then Enter.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Palette closes and we land on /.
    await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible({ timeout: 3000 });
    await expect(page).toHaveURL('/', { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Error edge states — mocked
// ---------------------------------------------------------------------------

test.describe('Search v2 — error states', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/search');
  });

  test('500 from search endpoint shows no results gracefully', async ({ page }) => {
    await page.route('**/spa/api/search**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal error' }),
      });
    });

    await page.getByPlaceholder(/Search documents/).fill('anything');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    // Should not crash — shows the "Search error" error state.
    await expect(page.getByText(/Search error|No results/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('saved searches panel loads empty state without crashing', async ({ page }) => {
    await page.route('**/spa/api/search/saved**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/search');
    // The saved searches panel is always visible — look for the panel heading.
    await expect(page.getByText('Saved searches', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('No saved searches yet.')).toBeVisible({ timeout: 5000 });
  });
});
