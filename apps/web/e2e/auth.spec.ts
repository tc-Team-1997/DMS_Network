import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Authentication', () => {
  test('login page renders with DocManager branding and carousel', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/DocManager/);
    await expect(page.getByText('DocManager').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('rejects bad credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin can sign in and lands on dashboard', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // Sidebar shows DocManager + admin initials
    await expect(page.locator('aside').getByText('DocManager')).toBeVisible();
    await expect(page.locator('aside').getByText('Ahmed Mohamed')).toBeVisible();
  });

  test('logout returns to login', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('protected route redirects to login when unauthenticated', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/repository');
    await page.waitForURL(/\/login/, { timeout: 5_000 });
  });
});
