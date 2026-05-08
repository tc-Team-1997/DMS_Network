import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/workflows');
  });

  test('shows all four queue tabs', async ({ page }) => {
    await expect(page.getByTestId('queue-all')).toBeVisible();
    await expect(page.getByTestId('queue-pending')).toBeVisible();
    await expect(page.getByTestId('queue-approved')).toBeVisible();
    await expect(page.getByTestId('queue-rejected')).toBeVisible();
  });

  test('switching to All queue shows at least one row', async ({ page }) => {
    await page.getByTestId('queue-all').click();
    // DataTable renders a table element; expect at least one body row.
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('admin sees approve / reject / escalate buttons on pending rows', async ({ page }) => {
    await page.getByTestId('queue-pending').click();
    // If there's a pending row, the action buttons are visible.
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) test.skip(true, 'no pending workflows seeded');
    await expect(page.locator('[data-testid$="-approve"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-reject"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-escalate"]').first()).toBeVisible();
  });

  test('mocked: approve moves a workflow and shows success banner', async ({ page }) => {
    await page.route('**/spa/api/workflows**', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 999,
              ref_code: 'WF-TEST',
              title: 'Test workflow',
              doc_id: 1,
              stage: 'Maker Review',
              priority: 'Medium',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]),
        });
      }
      return route.continue();
    });
    await page.route('**/spa/api/workflows/999/actions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, stage: 'Approved' }),
      }),
    );

    await page.goto('/workflows');
    await expect(page.getByText('WF-TEST')).toBeVisible();
    await page.getByTestId('workflow-999-approve').click();
    await expect(page.getByTestId('workflow-success')).toBeVisible();
    await expect(page.getByTestId('workflow-success')).toContainText('Approved');
  });
});
