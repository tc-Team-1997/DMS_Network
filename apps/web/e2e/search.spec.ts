import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Search — FTS5 backed', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/search');
  });

  test('finds a seeded passport document', async ({ page }) => {
    await page.getByPlaceholder(/Search by name/).fill('Passport');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: /Passport_AHI_2022/ }).first()).toBeVisible();
  });

  test('no results state for nonsense query', async ({ page }) => {
    await page.getByPlaceholder(/Search by name/).fill('zzxyz-nonexistent-term');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(/No matches/i)).toBeVisible();
  });
});
