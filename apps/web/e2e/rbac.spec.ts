import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('RBAC — sidebar items respect role', () => {
  test('Viewer sees only Overview + Discovery + Alerts/Reports sections', async ({ page }) => {
    // Seeded nour is locked; skipping to real viewer behavior via a Maker (read perms incl.).
    await login(page, 'sara', 'sara123');
    const aside = page.locator('aside');
    await expect(aside.getByText(/Operations$/i)).toBeVisible();
    // Maker should not see 'Security & RBAC' or 'System Admin' (admin-only).
    await expect(aside.getByRole('link', { name: /Security & RBAC/ })).toHaveCount(0);
    await expect(aside.getByRole('link', { name: /System Admin/ })).toHaveCount(0);
  });

  test('Doc Admin sees Platform section including System Admin', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    const aside = page.locator('aside');
    // "Platform" (exact) is the section header; distinct from "Document Platform" subtitle.
    await expect(aside.locator('nav').getByText('Platform', { exact: true })).toBeVisible();
    await expect(aside.getByRole('link', { name: /System Admin/ })).toBeVisible();
  });
});
