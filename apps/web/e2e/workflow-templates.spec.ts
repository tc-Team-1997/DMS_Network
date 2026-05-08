import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Workflow Templates', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/workflows/templates');
  });

  test('lists the seeded templates', async ({ page }) => {
    await expect(page.getByText('KYC Standard')).toBeVisible();
    await expect(page.getByText('Loan Fast-track')).toBeVisible();
  });

  test('clicking a template opens the editor with its stages', async ({ page }) => {
    await page.getByText('KYC Standard').click();
    await expect(page.getByTestId('template-name')).toHaveValue('KYC Standard');
    // KYC Standard seed has 6 stages.
    await expect(page.getByTestId('template-stage-0-name')).toBeVisible();
    await expect(page.getByTestId('template-stage-5-name')).toBeVisible();
  });

  test('New opens a blank editor', async ({ page }) => {
    await page.getByTestId('template-new').click();
    await expect(page.getByTestId('template-name')).toHaveValue('');
    await expect(page.getByTestId('template-stage-0-name')).toBeVisible();
  });

  test('mocked: create flow round-trips', async ({ page }) => {
    let postCalled = false;
    await page.route('**/spa/api/workflow-templates', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      if (route.request().method() === 'POST') {
        postCalled = true;
        const body = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 99,
            name: body.name,
            doc_type: body.doc_type ?? null,
            active: 1,
            steps: body.steps.map((s: { name: string; role: string }, i: number) => ({ id: i + 1, name: s.name, role: s.role })),
            created_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/workflows/templates');
    await page.getByTestId('template-new').click();
    await page.getByTestId('template-name').fill('Test Template');
    await page.getByTestId('template-stage-0-name').fill('Capture');
    await page.getByTestId('template-save').click();
    await expect.poll(() => postCalled).toBe(true);
  });
});
