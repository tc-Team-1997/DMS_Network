/**
 * E2E tests for the confidence threshold surfaces on document types.
 *
 * Covers:
 *   1. LearnWizard step 3 — confidence thresholds collapsible panel with
 *      AI auto-fill floor and high-confidence sliders.
 *   2. DocumentTypesPage — "Edit thresholds" modal on an existing doc-type
 *      row PATCHes the correct payload.
 *
 * All tests gated on BACKEND_READY=1 since they require login.
 * Run with: npx playwright test doctype-thresholds.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.beforeEach(({ }, testInfo) => {
  if (process.env['BACKEND_READY'] !== '1') {
    testInfo.skip(true, 'BACKEND_READY is not set — skipping until backend is available');
  }
});

// ── LearnWizard step 3 — threshold sliders ────────────────────────────────────

test.describe('LearnWizard — confidence thresholds', () => {
  const MOCK_INFER_RESPONSE = {
    name: 'Test Document',
    description: 'Inferred from test samples.',
    confidence: 0.82,
    total_samples: 3,
    fields: [
      {
        key: 'customer_name',
        label: 'Customer Name',
        type: 'text',
        required: true,
        ai_extract_from: 'customer_name',
        seen_in_samples: 3,
      },
    ],
    per_sample: [
      {
        filename: 'sample1.pdf',
        ocr_preview: 'Sample OCR text',
        extracted_fields: { customer_name: 'Test User' },
        ocr_backend: 'tesseract',
        confidence: 0.82,
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');

    // Stub infer endpoint so the wizard advances to step 3 without real files
    await page.route('**/spa/api/docbrain/doctypes/infer', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_INFER_RESPONSE),
      }),
    );

    // Stub document types list
    await page.route('**/spa/api/document-types*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      return route.continue();
    });

    await page.goto('/admin/document-types');
    await page.getByTestId('doctype-learn-btn').click();
    await expect(page.getByTestId('learn-wizard-close')).toBeVisible();
  });

  test('step 3 shows confidence thresholds collapsible', async ({ page }) => {
    // We need to get to step 3 — create a DataTransfer with 3 mock files and drop them
    // Since we can't easily drop real files in Playwright, we use the file input directly
    const fileInput = page.getByTestId('learn-wizard-file-input');

    // Create 3 minimal PDF buffers
    const buf = Buffer.from('%PDF-1.4 minimal');
    await fileInput.setInputFiles([
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: buf },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: buf },
      { name: 'c.pdf', mimeType: 'application/pdf', buffer: buf },
    ]);

    await page.getByTestId('learn-wizard-next-1').click();

    // Wait for step 3 (schema card)
    await expect(page.getByTestId('learn-wizard-step3')).toBeVisible({ timeout: 10_000 });

    // Thresholds collapsible should exist but be collapsed
    const thresholdsSection = page.getByTestId('learn-wizard-thresholds');
    await expect(thresholdsSection).toBeVisible();

    // Click to expand
    await page.getByTestId('learn-wizard-thresholds-toggle').click();

    // Both sliders should now be visible
    const autofillSlider = page.getByTestId('learn-wizard-autofill-floor');
    const highConfSlider = page.getByTestId('learn-wizard-high-confidence');
    await expect(autofillSlider).toBeVisible();
    await expect(highConfSlider).toBeVisible();

    // Default values: 40% for autofill floor, 70% for high confidence
    await expect(autofillSlider).toHaveValue('40');
    await expect(highConfSlider).toHaveValue('70');
  });

  test('threshold values round-trip through commit payload', async ({ page }) => {
    let capturedCommitBlob: Record<string, unknown> | null = null;

    await page.route('**/spa/api/docbrain/doctypes/commit', async (route) => {
      const formData = route.request().postData();
      if (formData) {
        // multipart/form-data — extract the 'blob' part body (JSON) between headers and next boundary.
        const m = /name="blob"\r?\n\r?\n([\s\S]*?)\r?\n-{2,}/.exec(formData);
        if (m?.[1]) {
          capturedCommitBlob = JSON.parse(m[1]) as Record<string, unknown>;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schema_id: 99, samples_saved: 3, vectors_indexed: 5 }),
      });
    });

    const fileInput = page.getByTestId('learn-wizard-file-input');
    const buf = Buffer.from('%PDF-1.4 minimal');
    await fileInput.setInputFiles([
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: buf },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: buf },
      { name: 'c.pdf', mimeType: 'application/pdf', buffer: buf },
    ]);
    await page.getByTestId('learn-wizard-next-1').click();
    await expect(page.getByTestId('learn-wizard-step3')).toBeVisible({ timeout: 10_000 });

    // Expand thresholds
    await page.getByTestId('learn-wizard-thresholds-toggle').click();

    // Change autofill floor to 55%
    await page.getByTestId('learn-wizard-autofill-floor').fill('55');

    // Change high confidence to 80%
    await page.getByTestId('learn-wizard-high-confidence').fill('80');

    // Commit as draft
    await page.getByTestId('learn-wizard-save-draft').click();

    // Check step 4 confirmation
    await expect(page.getByTestId('learn-wizard-step4')).toBeVisible({ timeout: 5_000 });

    // Verify the payload had the right threshold values (stored as 0–1)
    expect(capturedCommitBlob?.['autofill_floor']).toBeCloseTo(0.55, 2);
    expect(capturedCommitBlob?.['high_confidence']).toBeCloseTo(0.80, 2);
  });
});

// ── DocumentTypesPage — Edit thresholds modal ─────────────────────────────────

test.describe('DocumentTypesPage — Edit thresholds modal', () => {
  const MOCK_TYPES = [
    {
      id: 1,
      name: 'Passport',
      description: 'Passport document',
      fields: [{ key: 'customer_name', label: 'Customer Name', type: 'text', required: true }],
      active: 1,
      tenant_id: 'nbe',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      inference_status: 'manual',
      autofill_floor: 0.4,
      high_confidence: 0.7,
    },
  ];

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');

    await page.route('**/spa/api/document-types*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_TYPES),
        });
      }
      return route.continue();
    });

    await page.goto('/admin/document-types');
  });

  test('Thresholds button opens modal with current values', async ({ page }) => {
    const btn = page.getByTestId('doctype-thresholds-btn-1');
    await expect(btn).toBeVisible();
    await btn.click();

    // Modal should appear
    await expect(page.getByTestId('thresholds-autofill-slider')).toBeVisible();
    await expect(page.getByTestId('thresholds-high-slider')).toBeVisible();

    // Values seeded from MOCK_TYPES: 40% and 70%
    await expect(page.getByTestId('thresholds-autofill-slider')).toHaveValue('40');
    await expect(page.getByTestId('thresholds-high-slider')).toHaveValue('70');
  });

  test('Save in modal fires PATCH with updated threshold values', async ({ page }) => {
    let patchBody: unknown = null;

    await page.route('**/spa/api/document-types/1', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_TYPES[0], autofill_floor: 0.5, high_confidence: 0.8 }),
        });
      }
      return route.continue();
    });

    await page.getByTestId('doctype-thresholds-btn-1').click();

    // Change autofill floor slider to 50
    const autofillSlider = page.getByTestId('thresholds-autofill-slider');
    await autofillSlider.fill('50');

    // Change high confidence slider to 80
    const highSlider = page.getByTestId('thresholds-high-slider');
    await highSlider.fill('80');

    await page.getByTestId('thresholds-save').click();

    // Modal should close (save button triggers patch + close)
    await expect(page.getByTestId('thresholds-autofill-slider')).not.toBeVisible();

    // PATCH should have been called with fractional values
    expect(patchBody).toMatchObject({
      autofill_floor: 0.5,
      high_confidence: 0.8,
    });
  });
});
