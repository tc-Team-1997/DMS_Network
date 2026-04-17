import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation between modules', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('sidebar navigates to Capture', async ({ page }) => {
    await page.locator('aside').getByRole('link', { name: /Capture/ }).click();
    await expect(page.getByRole('heading', { name: 'Upload document' })).toBeVisible();
  });

  test('sidebar navigates to Repository and shows folder list', async ({ page }) => {
    await page.locator('aside').getByRole('link', { name: /Repository/ }).click();
    await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
    await expect(page.getByText('All documents')).toBeVisible();
  });

  test('sidebar navigates to Search', async ({ page }) => {
    await page.locator('aside').getByRole('link', { name: /Search/ }).click();
    await expect(page.getByRole('heading', { name: 'Enterprise search' })).toBeVisible();
  });

  test('sidebar navigates to Alerts', async ({ page }) => {
    await page.locator('aside').getByRole('link', { name: /Alerts/ }).click();
    await expect(page.locator('h2').filter({ hasText: /alerts$/ })).toBeVisible();
  });

  test('coming-soon route shows placeholder', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.getByText(/coming soon|next milestone/i)).toBeVisible();
  });
});
