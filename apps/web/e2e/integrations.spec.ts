import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Integration marketplace', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/integration');
  });

  test('shows the marketplace header and CBS category', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Integration marketplace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CBS' })).toBeVisible();
  });

  test('lists at least the Temenos adapter', async ({ page }) => {
    await expect(page.getByText('Temenos T24')).toBeVisible();
    await expect(page.getByText('temenos_t24')).toBeVisible();
  });

  test('shows status badges for CBS adapters', async ({ page }) => {
    // Temenos ships as 'mock' today; others are 'planned'.
    await expect(page.getByText('Mock').first()).toBeVisible();
    await expect(page.getByText('Planned').first()).toBeVisible();
  });
});
