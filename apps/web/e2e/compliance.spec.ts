import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Compliance module', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/compliance');
  });

  test('shows the expiry pipeline KPI row', async ({ page }) => {
    await expect(page.getByText('Overdue expiry')).toBeVisible();
    await expect(page.getByText('Next 30 days')).toBeVisible();
    await expect(page.getByText('31–60 days')).toBeVisible();
    await expect(page.getByText('61–90 days')).toBeVisible();
  });

  test('shows workflow SLA panel', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Workflow SLA' })).toBeVisible();
    await expect(page.getByText('Late (>3d)')).toBeVisible();
    await expect(page.getByText('On track')).toBeVisible();
  });

  test('shows retention and audit panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Retention policies' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent audit activity' })).toBeVisible();
  });
});
