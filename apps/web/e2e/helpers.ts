import type { Page } from '@playwright/test';

/** Log in through the SPA login form. Relies on the `/spa/api/login` endpoint. */
export async function login(
  page: Page,
  username = 'admin',
  password = 'admin123',
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // After login the SPA navigates to "/"; wait for the Dashboard topbar.
  await page.waitForURL('**/');
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 10_000 });
}
