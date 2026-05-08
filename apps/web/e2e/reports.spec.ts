import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Reports & BI', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/reports');
  });

  test('shows the KPI cards', async ({ page }) => {
    await expect(page.getByText('Total documents')).toBeVisible();
    await expect(page.getByText('Valid').first()).toBeVisible();
    await expect(page.getByText('Expiring').first()).toBeVisible();
    await expect(page.getByText('Expired').first()).toBeVisible();
  });

  test('shows the three chart panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Uploads \(last 6 months\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Documents by branch' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Documents by type' })).toBeVisible();
  });

  test('export CSV link points at the right endpoint', async ({ page }) => {
    const link = page.getByTestId('reports-export');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/spa/api/reports/export.csv');
    await expect(link).toHaveAttribute('download', '');
  });

  test('expiry pipeline and workflow throughput panels render', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Expiry pipeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflow throughput' })).toBeVisible();
    await expect(page.getByText('Next 30 days')).toBeVisible();
    await expect(page.getByText('61–90 days')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
    await expect(page.getByText('Approved')).toBeVisible();
    await expect(page.getByText('Rejected')).toBeVisible();
  });
});
