import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('System Admin module', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin');
  });

  test('shows the health KPI row', async ({ page }) => {
    await expect(page.getByText('Node', { exact: true })).toBeVisible();
    await expect(page.getByText('Python service')).toBeVisible();
    await expect(page.getByText('Node memory')).toBeVisible();
    await expect(page.getByText('DB size')).toBeVisible();
  });

  test('shows entity counts and operations panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Entity counts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByTestId('admin-retention')).toBeVisible();
  });

  test('refresh button is clickable', async ({ page }) => {
    await page.getByTestId('admin-refresh').click();
    // No assertion beyond no error — refetch is async.
    await expect(page.getByTestId('admin-refresh')).toBeVisible();
  });
});
