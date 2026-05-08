import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Security & RBAC module', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/security');
  });

  test('shows the KPI row', async ({ page }) => {
    // Scope to main — "Users" also appears in the sidebar nav.
    const main = page.getByRole('main');
    await expect(main.getByText('Roles', { exact: true })).toBeVisible();
    await expect(main.getByText('Permissions', { exact: true })).toBeVisible();
    await expect(main.getByText('Users', { exact: true })).toBeVisible();
    await expect(main.getByText('Session log', { exact: true })).toBeVisible();
  });

  test('renders the role / permission matrix', async ({ page }) => {
    await expect(page.getByTestId('rbac-matrix')).toBeVisible();
    // Matrix header contains the 4 seeded roles.
    await expect(page.locator('[data-testid="rbac-matrix"] thead')).toContainText('Doc Admin');
    await expect(page.locator('[data-testid="rbac-matrix"] thead')).toContainText('Maker');
    await expect(page.locator('[data-testid="rbac-matrix"] thead')).toContainText('Checker');
    await expect(page.locator('[data-testid="rbac-matrix"] thead')).toContainText('Viewer');
  });

  test('shows the recent login activity table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Recent login activity' })).toBeVisible();
  });
});
