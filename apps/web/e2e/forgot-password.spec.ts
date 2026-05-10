import { test, expect } from '@playwright/test';

test('forgot-password → reset-password full flow', async ({ page }) => {
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

  // 6. RESTORE the seed password so subsequent tests still pass.
  // Issue a new forgot-password request and reset back to admin123.
  await page.request.post('/spa/api/auth/forgot-password', { data: { username: 'admin' } });
  const restore2 = await page.request.get('/spa/api/auth/_test_last_reset_token?username=admin');
  const { token: restoreTok } = await restore2.json() as { token: string };
  await page.request.post('/spa/api/auth/reset-password', {
    data: { token: restoreTok, password: 'admin123' },
  });
});
