import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Users admin module', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users');
  });

  test('lists the seeded users', async ({ page }) => {
    await expect(page.getByText('admin', { exact: true })).toBeVisible();
    await expect(page.getByText('sara', { exact: true })).toBeVisible();
    await expect(page.getByText('mohamed', { exact: true })).toBeVisible();
  });

  test('opens the new-user drawer', async ({ page }) => {
    await page.getByTestId('user-new').click();
    await expect(page.getByTestId('user-create-username')).toBeVisible();
    await expect(page.getByTestId('user-create-password')).toBeVisible();
    await expect(page.getByTestId('user-create-role')).toBeVisible();
  });

  test('mocked: create user round-trips', async ({ page }) => {
    let posted = false;
    await page.route('**/spa/api/users', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      if (route.request().method() === 'POST') {
        posted = true;
        const body = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 7,
            username: body.username,
            full_name: body.full_name ?? null,
            email: body.email ?? null,
            role: body.role,
            branch: body.branch ?? null,
            status: 'Active',
            mfa_enabled: 0,
            tenant_id: 'nbe',
            created_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/users');
    await page.getByTestId('user-new').click();
    await page.getByTestId('user-create-username').fill('testuser');
    await page.getByTestId('user-create-password').fill('secret123');
    await page.getByTestId('user-create-role').selectOption('Maker');
    await page.getByTestId('user-create-submit').click();
    await expect.poll(() => posted).toBe(true);
  });
});
