import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Topbar shows breadcrumb trail reflecting the current route', async ({ page }) => {
  await login(page, 'admin', 'admin123');

  await page.goto('/repository');
  await expect(page.getByTestId('breadcrumbs')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Repository/i);

  await page.goto('/workflows?tab=approved');
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Workflows/i);
  await expect(page.getByTestId('breadcrumbs')).toContainText(/Approved/i);
});

test('Topbar shows branch+role chip from session user', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');
  const chip = page.getByTestId('topbar-branch-role-chip');
  await expect(chip).toBeVisible();
  // The seed admin has role 'Doc Admin'.
  await expect(chip).toContainText(/Doc Admin/i);
});
