/**
 * i18n-dz.spec.ts — Playwright spec for Dzongkha i18n pack (Wave D).
 *
 * Verifies:
 *  1. Locale switcher in Topbar switches to DZ and sets <html lang="dz">.
 *  2. A Tibetan-script heading is visible after switching to DZ.
 *  3. Switching back to EN resets <html lang="en"> and shows an English heading.
 *  4. The i18n admin Settings panel renders for Doc Admin.
 *
 * All tests run against the live stack (no API mocking on the happy path).
 * The Tibetan regex U+0F00–U+0FFF matches any Dzongkha character in the page.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

async function switchLocale(page: import('@playwright/test').Page, locale: 'EN' | 'DZ') {
  const btn = page.getByTestId(`locale-btn-${locale.toLowerCase()}`);
  await btn.waitFor({ state: 'visible', timeout: 5_000 });
  await btn.click();
  // Give i18next a moment to re-render
  await page.waitForTimeout(300);
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

test.describe('Dzongkha i18n pack', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Always reset to English so tests are independent
    await switchLocale(page, 'EN');
  });

  test('1 · switching to DZ sets <html lang="dz">', async ({ page }) => {
    await page.goto('/');
    await switchLocale(page, 'DZ');

    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('dz');
  });

  test('2 · Tibetan-script text appears after switching to DZ', async ({ page }) => {
    await page.goto('/');
    await switchLocale(page, 'DZ');

    // Tibetan Unicode block: U+0F00–U+0FFF
    // The dashboard heading "ལས་ཁུངས་གཙོ།" falls in this range.
    // We look for any visible heading/text containing a Tibetan character.
    const tibetanRegex = /[ༀ-࿿]/;

    // Wait for at least one element with Tibetan text to appear.
    await expect(page.locator('body')).toContainText(tibetanRegex);
  });

  test('3 · switching back to EN resets <html lang="en"> and shows English UI', async ({ page }) => {
    await page.goto('/');

    // First go to DZ
    await switchLocale(page, 'DZ');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('dz');

    // Then back to EN
    await switchLocale(page, 'EN');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    // The dashboard title should be in English
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('4 · i18n admin Settings panel renders for Doc Admin', async ({ page }) => {
    await page.goto('/admin/settings/i18n');

    // The panel heading should be visible
    await expect(page.getByRole('heading', { name: /language/i })).toBeVisible();
  });
});

// -------------------------------------------------------------------
// Error / edge cases (mocked)
// -------------------------------------------------------------------

test.describe('Dzongkha i18n — locale persistence', () => {
  test('locale preference persists across page reloads', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');

    // Switch to DZ
    await page.getByTestId('locale-btn-dz').click();
    await page.waitForTimeout(300);

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be DZ
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('dz');

    // Clean up: reset to EN
    await page.getByTestId('locale-btn-en').click();
  });
});
