import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('shows four KPI cards', async ({ page }) => {
    await expect(page.getByText('Total documents')).toBeVisible();
    await expect(page.getByText('Valid').first()).toBeVisible();
    await expect(page.getByText('Expiring soon')).toBeVisible();
    await expect(page.getByText('Expired').first()).toBeVisible();
  });

  test('renders expiry distribution and doc-type panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Expiry distribution' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By document type' })).toBeVisible();
  });

  test('recent workflows and alerts panels are present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Recent workflows' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent alerts' })).toBeVisible();
  });

  test('topbar module label shows Overview for dashboard', async ({ page }) => {
    await expect(page.getByRole('banner').getByText('Overview')).toBeVisible();
  });
});
