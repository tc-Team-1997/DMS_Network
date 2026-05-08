import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Document Types admin', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/document-types');
  });

  test('lists the seeded default types', async ({ page }) => {
    // Seed creates 8 defaults on a fresh DB.
    await expect(page.getByText('Passport', { exact: true })).toBeVisible();
    await expect(page.getByText('National ID', { exact: true })).toBeVisible();
    await expect(page.getByText('Utility Bill', { exact: true })).toBeVisible();
    await expect(page.getByText('Loan Application', { exact: true })).toBeVisible();
  });

  test('clicking a type opens its field editor', async ({ page }) => {
    await page.getByText('Passport', { exact: true }).click();
    await expect(page.getByTestId('doctype-name')).toHaveValue('Passport');
    await expect(page.getByTestId('doctype-field-0')).toBeVisible();
    // First Passport field is customer_name.
    await expect(page.getByTestId('doctype-field-0-key')).toHaveValue('customer_name');
  });

  test('New opens a blank editor with one starter field', async ({ page }) => {
    await page.getByTestId('doctype-new').click();
    await expect(page.getByTestId('doctype-name')).toHaveValue('');
    await expect(page.getByTestId('doctype-field-0')).toBeVisible();
  });

  test('mocked: create new type round-trips', async ({ page }) => {
    let created = false;
    await page.route('**/spa/api/document-types', async (route) => {
      if (route.request().method() === 'POST') {
        created = true;
        const body = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 999,
            name: body.name,
            description: body.description ?? null,
            fields: body.fields,
            active: body.active === false ? 0 : 1,
            tenant_id: 'nbe',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
        return;
      }
      return route.continue();
    });

    await page.goto('/admin/document-types');
    await page.getByTestId('doctype-new').click();
    await page.getByTestId('doctype-name').fill('Test Type');
    await page.getByTestId('doctype-field-0-key').fill('my_field');
    await page.getByTestId('doctype-field-0-label').fill('My field');
    await page.getByTestId('doctype-field-0-required').check();
    await page.getByTestId('doctype-save').click();
    await expect.poll(() => created).toBe(true);
  });

  test('adding and removing fields updates the list', async ({ page }) => {
    await page.getByTestId('doctype-new').click();
    await page.getByTestId('doctype-add-field').click();
    await expect(page.getByTestId('doctype-field-0')).toBeVisible();
    await expect(page.getByTestId('doctype-field-1')).toBeVisible();
    await page.getByTestId('doctype-field-1-delete').click();
    await expect(page.getByTestId('doctype-field-1')).toHaveCount(0);
  });
});
