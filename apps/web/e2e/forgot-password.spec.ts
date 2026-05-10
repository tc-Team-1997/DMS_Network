import { test, expect } from '@playwright/test';

test('forgot-password → reset-password full flow', async ({ page }) => {
  let originalPasswordRestored = false;
  try {
    // 1. Open login → click forgot password.
    await page.goto('/login');
    await page.getByTestId('forgot-password-link').click();
    await expect(page).toHaveURL(/\/forgot-password/);

    // 2. Submit username — admin is the seeded account.
    await page.getByLabel(/username|email/i).fill('admin');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-success')).toBeVisible();

    // 3. Pull the token from the test inbox endpoint.
    const inbox = await page.request.get('/spa/api/auth/_test_last_reset_token?username=admin');
    expect(inbox.ok()).toBe(true);
    const { token } = await inbox.json() as { token: string };
    expect(token).toBeTruthy();

    // 4. Use the token to set a new password.
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel(/new password/i).fill('newpass1234');
    await page.getByLabel(/confirm/i).fill('newpass1234');
    await page.getByTestId('reset-submit').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // 5. Confirm new password works.
    await page.getByLabel(/username/i).fill('admin');
    await page.getByLabel(/password/i).fill('newpass1234');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/^(?!.*login)/, { timeout: 10000 });
  } finally {
    // Always restore admin/admin123 so subsequent specs aren't broken.
    // Runs even if any expect() above throws — prevents cascade failures
    // across the entire E2E suite.
    try {
      await page.request.post('/spa/api/auth/forgot-password', { data: { username: 'admin' } });
      const r = await page.request.get('/spa/api/auth/_test_last_reset_token?username=admin');
      const { token } = await r.json() as { token: string };
      if (token) {
        await page.request.post('/spa/api/auth/reset-password', {
          data: { token, password: 'admin123' },
        });
        originalPasswordRestored = true;
      }
    } catch (e) {
      console.error(
        '[forgot-password.spec] FAILED to restore admin/admin123 — manual DB reset required:',
        e,
      );
    }
  }

  if (!originalPasswordRestored) {
    console.warn('[forgot-password.spec] admin password may need manual reset to admin123');
  }
});
