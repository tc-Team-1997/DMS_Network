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
  // After login the SPA navigates to "/"; wait for any post-login chrome to render.
  // Don't depend on a specific page heading — module headings change across waves.
  await page.waitForURL('**/');
  await page.waitForLoadState('networkidle');
}
