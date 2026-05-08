import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Indexing / QA queue', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/indexing');
  });

  test('shows the four triage metrics', async ({ page }) => {
    // Use exact match — "Low OCR confidence" also appears inside the
    // "Only low OCR confidence" filter checkbox label.
    await expect(page.getByText('Low OCR confidence', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing doc type', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing owner', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing doc number', { exact: true })).toBeVisible();
  });

  test('only-low-confidence filter toggles', async ({ page }) => {
    const cb = page.getByTestId('only-low-conf');
    await cb.check();
    await expect(cb).toBeChecked();
    await cb.uncheck();
    await expect(cb).not.toBeChecked();
  });

  test('mocked: edit then save updates the row', async ({ page }) => {
    await page.route('**/spa/api/indexing/stats', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ low_confidence: 1, missing_type: 1, missing_owner: 0, missing_number: 0 }),
      }),
    );
    await page.route('**/spa/api/indexing?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 42,
            filename: 'test.pdf',
            original_name: 'Passport scan.pdf',
            doc_type: null,
            customer_cid: null,
            customer_name: null,
            doc_number: null,
            dob: null,
            issue_date: null,
            expiry_date: null,
            issuing_authority: null,
            branch: 'Cairo',
            status: 'Pending',
            ocr_confidence: 55.2,
            uploaded_at: new Date().toISOString(),
            notes: null,
          },
        ]),
      }),
    );
    await page.route('**/spa/api/indexing/42', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto('/indexing');
    await expect(page.getByText('Passport scan.pdf')).toBeVisible();
    await page.getByTestId('indexing-42-edit').click();
    await page.getByTestId('indexing-input-doc_type').fill('Passport');
    await page.getByTestId('indexing-input-customer_name').fill('Jane Doe');
    await page.getByTestId('indexing-42-save').click();
    // On success, the edit form collapses back to the read-only view.
    await expect(page.getByTestId('indexing-42-edit')).toBeVisible();
  });
});
