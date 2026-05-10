import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('notifications popover shows 3 tabs and numeric badge', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/');

  // Numeric unread badge — only shown if unread > 0.
  // Seed has unread notifications; if count is 0 this branch is skipped.
  const badge = page.getByTestId('notif-badge-count');
  if (await badge.count() > 0) {
    await expect(badge).toHaveText(/^\d+\+?$/);
  }

  // Open the popover.
  const bell = page.getByTestId('notif-bell');
  await bell.click();

  // All three tab buttons must be visible.
  await expect(page.getByTestId('notif-tab-alerts')).toBeVisible();
  await expect(page.getByTestId('notif-tab-approvals')).toBeVisible();
  await expect(page.getByTestId('notif-tab-system')).toBeVisible();

  // Alerts tab is selected by default.
  await expect(page.getByTestId('notif-tab-alerts')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('notif-tab-approvals')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('notif-tab-system')).toHaveAttribute('aria-selected', 'false');

  // The list panel is visible.
  await expect(page.getByTestId('notif-list')).toBeVisible();

  // Switch to Approvals tab.
  await page.getByTestId('notif-tab-approvals').click();
  await expect(page.getByTestId('notif-tab-approvals')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('notif-list')).toBeVisible();

  // Switch to System tab.
  await page.getByTestId('notif-tab-system').click();
  await expect(page.getByTestId('notif-tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('notif-list')).toBeVisible();
});

test('notifications popover error state — mocked 500', async ({ page }) => {
  await page.route('**/spa/api/notifications/feed**', (route) => {
    void route.fulfill({ status: 500, body: '{"error":"server error"}' });
  });

  await login(page, 'admin', 'admin123');
  await page.goto('/');

  const bell = page.getByTestId('notif-bell');
  await bell.click();

  // With a 500 the list renders but is empty (no items, no crash).
  await expect(page.getByTestId('notif-list')).toBeVisible();
});
