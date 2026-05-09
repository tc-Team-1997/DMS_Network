import { test, expect } from '@playwright/test';

/**
 * CC5 — No demo content on login page.
 *
 * These assertions are intentionally run against the real stack (happy-path
 * rule: no mocking). They verify that demo credentials and demo environment
 * markers are absent from the rendered HTML before any user interaction.
 */
test.describe('No demo content on login page', () => {
  test('demo passwords are absent from rendered HTML', async ({ page }) => {
    await page.goto('/login');
    // Wait for the form to be in the DOM before inspecting content.
    await expect(page.getByLabel('Username')).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('admin123');
    expect(html).not.toContain('sara123');
    expect(html).not.toContain('mohamed123');
    expect(html).not.toContain('nour123');
  });

  test('DEMO ENVIRONMENT marker is absent from rendered HTML', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('DEMO ENVIRONMENT');
    expect(html).not.toContain('demo environment');
  });

  test('login form has username input, password input, and submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
