import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Cmd-K palette shows operator-token hints', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');

  // isCmdK() in keyboard.ts accepts metaKey (Mac) or ctrlKey (Linux/Windows).
  // Playwright requires lowercase 'k' to match key === 'k' in the listener.
  await page.keyboard.press('Meta+k');

  await expect(page.getByTestId('cmdk-hints')).toBeVisible();
  await expect(page.getByTestId('cmdk-hints')).toContainText('cid:');
  await expect(page.getByTestId('cmdk-hints')).toContainText('expiry:');
  await expect(page.getByTestId('cmdk-hints')).toContainText('type:');
});
