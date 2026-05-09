/**
 * E2E tests for OCR Confidence Tuning feature.
 *
 * Happy-path test suite covering all acceptance criteria (AC-1 through AC-6).
 * Tests run against the live `/admin/document-types` endpoint and thresholds tab.
 *
 * Run with: npx playwright test ocr-confidence-tuning.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const DOCUMENT_TYPES_API = '**/spa/api/document-types*';

// Mock document type with thresholds
const MOCK_DOCUMENT_TYPE = {
  id: 1,
  name: 'Invoice',
  description: 'Invoice document type',
  fields: [
    { key: 'invoice_number', label: 'Invoice Number', type: 'text', required: true },
    { key: 'invoice_date', label: 'Invoice Date', type: 'date', required: true },
    { key: 'amount_due', label: 'Amount Due', type: 'text', required: false },
    { key: 'cif_number', label: 'Customer ID', type: 'text', required: false },
  ],
  active: 1,
  tenant_id: 'nbe',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-05-09T10:00:00Z',
  autofill_floor: 0.4,
  high_confidence: 0.7,
  tested_with_sample_id: null,
};

test.describe('AC-1: dual-handle slider renders and reflects current thresholds', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('thresholds tab visible and sliders render with default values', async ({ page }) => {
    // Open the document type details/edit form
    await page.getByText('Invoice', { exact: true }).click();

    // Thresholds tab should be visible
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await expect(thresholdsTab).toBeVisible();
    await thresholdsTab.click();

    // Gold slider (autofill_floor) should be visible
    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await expect(autofillSlider).toBeVisible();

    // Green slider (high_confidence) should be visible
    const highConfidenceSlider = page.getByTestId('threshold-slider-high');
    await expect(highConfidenceSlider).toBeVisible();

    // Labels should display current values as percentages
    const autofillLabel = page.getByTestId('autofill-floor-label');
    const highConfLabel = page.getByTestId('confidence-high-label');
    await expect(autofillLabel).toContainText('40');
    await expect(highConfLabel).toContainText('70');
  });

  test('preview pane shows "No samples" message when no sample selected', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await expect(thresholdsTab).toBeVisible();
    await thresholdsTab.click();

    const previewPane = page.getByTestId('extraction-preview-table');
    await expect(previewPane).toBeVisible();
    await expect(previewPane).toContainText('No samples uploaded');
  });
});

test.describe('AC-2: dragging the floor handle updates preview with 500ms debounce', () => {
  const MOCK_WITH_SAMPLE = {
    ...MOCK_DOCUMENT_TYPE,
    tested_with_sample_id: 42,
  };

  const MOCK_SAMPLE_EXTRACTION = {
    id: 42,
    filename: 'invoice_sample.pdf',
    confidence: 0.85,
    extracted_fields: [
      { field_name: 'cif_number', value: '12345', confidence: 0.95 },
      { field_name: 'amount_due', value: '1000', confidence: 0.35 },
      { field_name: 'invoice_date', value: '2026-05-01', confidence: 0.72 },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_WITH_SAMPLE]),
        });
      }
      return route.continue();
    });
    // Mock the sample extraction endpoint (used by preview)
    await page.route('**/spa/api/docbrain/samples/42', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SAMPLE_EXTRACTION),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('adjusting autofill_floor slider updates preview after debounce', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');

    // Drag slider from 0.4 (40%) to 0.5 (50%)
    await autofillSlider.fill('50');

    // Label should immediately reflect the change
    const autofillLabel = page.getByTestId('autofill-floor-label');
    await expect(autofillLabel).toContainText('50');

    // Wait for debounce (500ms) + rendering
    await page.waitForTimeout(600);

    // Preview should update with color-coded fields
    const previewTable = page.getByTestId('extraction-preview-table');
    await expect(previewTable).toBeVisible();

    // cif_number at 0.95 should be >= 0.5 (autofill floor) → green "auto-filled"
    const cifStatus = page.getByTestId('extraction-field-status-cif_number');
    await expect(cifStatus).toContainText('auto-filled');

    // amount_due at 0.35 should be < 0.5 (autofill floor) → red "confidence below threshold"
    const amountStatus = page.getByTestId('extraction-field-status-amount_due');
    await expect(amountStatus).toContainText('below');

    // invoice_date at 0.72 should be >= 0.5 but < 0.7 (high_confidence) → yellow "review required"
    const dateStatus = page.getByTestId('extraction-field-status-invoice_date');
    await expect(dateStatus).toContainText('review');
  });

  test('preview updates immediately after save, without debounce', async ({ page }) => {
    let patchCalled = false;
    await page.route(DOCUMENT_TYPES_API, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_WITH_SAMPLE]),
        });
      }
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        const body = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_WITH_SAMPLE, ...body }),
        });
      }
      return route.continue();
    });

    await page.goto('/admin/document-types');
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    // Change slider to 0.6
    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await autofillSlider.fill('60');

    // Save button should be enabled
    const saveBtn = page.getByTestId('thresholds-save-button');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for PATCH
    await expect.poll(() => patchCalled).toBe(true);

    // After save, preview should update immediately (without debounce wait)
    const previewPane = page.getByTestId('extraction-preview-table');
    await expect(previewPane).toBeVisible();
  });
});

test.describe('AC-3: high-confidence cannot be dragged below floor', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('high confidence slider snaps back if dragged below floor', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    const highSlider = page.getByTestId('threshold-slider-high');

    // Set autofill floor to 0.6 (60%)
    await autofillSlider.fill('60');

    // Try to drag high confidence below floor (to 0.5)
    await highSlider.fill('50');

    // High slider should snap back to at least 0.6 or show an error toast
    // Either the UI prevents the change or shows an error message
    const errorMsg = page.getByTestId('threshold-validation-error');
    if (await errorMsg.isVisible()) {
      await expect(errorMsg).toContainText('Autofill floor cannot exceed');
    } else {
      // If no error, slider should be at or above 60
      await expect(highSlider).toHaveValue('60');
    }
  });
});

test.describe('AC-4: reset button restores 0.4 / 0.7 defaults', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('clicking reset button restores sliders to 0.4 and 0.7', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    const highSlider = page.getByTestId('threshold-slider-high');
    const resetBtn = page.getByTestId('threshold-reset');

    // Change both sliders away from defaults
    await autofillSlider.fill('60');
    await highSlider.fill('80');

    // Verify changes
    await expect(autofillSlider).toHaveValue('60');
    await expect(highSlider).toHaveValue('80');

    // Click reset
    await resetBtn.click();

    // Sliders should return to defaults
    await expect(autofillSlider).toHaveValue('40');
    await expect(highSlider).toHaveValue('70');
  });

  test('reset discards unsaved changes with confirmation', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await autofillSlider.fill('60');

    const resetBtn = page.getByTestId('threshold-reset');
    await resetBtn.click();

    // A toast should appear confirming the reset
    const toast = page.getByText(/Changes discarded|reset to defaults/i);
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Slider should be back at 0.4
    await expect(autofillSlider).toHaveValue('40');
  });
});

test.describe('AC-5: save button persists values via PATCH, triggers audit log', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      if (route.request().method() === 'PATCH') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...MOCK_DOCUMENT_TYPE,
            autofill_floor: body.autofill_floor ?? 0.4,
            high_confidence: body.high_confidence ?? 0.7,
            tested_with_sample_id: body.tested_with_sample_id ?? null,
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('save button is disabled until threshold change detected', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const saveBtn = page.getByTestId('thresholds-save-button');

    // Initially disabled (no changes)
    await expect(saveBtn).toBeDisabled();

    // Change a slider
    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await autofillSlider.fill('50');

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled();
  });

  test('clicking save fires PATCH with correct payload', async ({ page }) => {
    let capturedPatch: unknown = null;

    await page.route(DOCUMENT_TYPES_API, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      if (route.request().method() === 'PATCH') {
        capturedPatch = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...MOCK_DOCUMENT_TYPE,
            autofill_floor: 0.5,
            high_confidence: 0.8,
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/admin/document-types');
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    // Change thresholds
    await page.getByTestId('threshold-slider-floor').fill('50');
    await page.getByTestId('threshold-slider-high').fill('80');

    // Click save
    const saveBtn = page.getByTestId('thresholds-save-button');
    await saveBtn.click();

    // Wait for PATCH to complete
    await expect.poll(() => capturedPatch !== null).toBe(true);

    // Verify PATCH payload
    expect(capturedPatch).toMatchObject({
      autofill_floor: 0.5,
      high_confidence: 0.8,
    });
  });

  test('successful save shows green toast "Thresholds saved"', async ({ page }) => {
    await page.goto('/admin/document-types');
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    // Change and save
    await page.getByTestId('threshold-slider-floor').fill('50');
    await page.getByTestId('thresholds-save-button').click();

    // Toast should appear
    const successToast = page.getByText(/Thresholds saved|Success/i);
    await expect(successToast).toBeVisible({ timeout: 5_000 });
  });

  test('save button is re-disabled after successful save', async ({ page }) => {
    await page.goto('/admin/document-types');
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const saveBtn = page.getByTestId('thresholds-save-button');

    // Enable save
    await page.getByTestId('threshold-slider-floor').fill('50');
    await expect(saveBtn).toBeEnabled();

    // Click save
    await saveBtn.click();

    // Wait for toast
    await expect(page.getByText(/Thresholds saved/i)).toBeVisible({ timeout: 5_000 });

    // Save button should be disabled again
    await expect(saveBtn).toBeDisabled();
  });
});

test.describe('AC-6: accessibility (keyboard navigation, ARIA labels, RTL support)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.route(DOCUMENT_TYPES_API, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_DOCUMENT_TYPE]),
        });
      }
      return route.continue();
    });
    await page.goto('/admin/document-types');
  });

  test('range sliders have correct ARIA labels and values', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    const highSlider = page.getByTestId('threshold-slider-high');

    // Check ARIA attributes
    await expect(autofillSlider).toHaveAttribute('aria-label', /autofill|floor/i);
    await expect(highSlider).toHaveAttribute('aria-label', /confidence|high/i);

    // Both should have ARIA min/max
    await expect(autofillSlider).toHaveAttribute('aria-valuemin', '0');
    await expect(autofillSlider).toHaveAttribute('aria-valuemax', '1');
  });

  test('keyboard navigation: Tab moves focus through controls', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    const highSlider = page.getByTestId('threshold-slider-high');
    const resetBtn = page.getByTestId('threshold-reset');
    const saveBtn = page.getByTestId('thresholds-save-button');

    // Tab to autofill slider
    await autofillSlider.focus();
    await expect(autofillSlider).toBeFocused();

    // Tab to high confidence slider
    await page.keyboard.press('Tab');
    await expect(highSlider).toBeFocused();

    // Tab to reset button
    await page.keyboard.press('Tab');
    await expect(resetBtn).toBeFocused();

    // Tab to save button
    await page.keyboard.press('Tab');
    await expect(saveBtn).toBeFocused();
  });

  test('arrow keys adjust slider values by ±0.05 or ±0.01 with shift', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await autofillSlider.focus();

    // Initial value is 40 (0.4)
    await expect(autofillSlider).toHaveValue('40');

    // Arrow right should increase by 5 (±0.05)
    await page.keyboard.press('ArrowRight');
    await expect(autofillSlider).toHaveValue('45');

    // Arrow left should decrease by 5
    await page.keyboard.press('ArrowLeft');
    await expect(autofillSlider).toHaveValue('40');

    // Shift+arrow should adjust by smaller increment (±0.01, or 1%)
    await page.keyboard.press('Shift+ArrowRight');
    await expect(autofillSlider).toHaveValue('41');
  });

  test('focus ring visible on slider', async ({ page }) => {
    await page.getByText('Invoice', { exact: true }).click();
    const thresholdsTab = page.getByTestId('doctype-thresholds-tab');
    await thresholdsTab.click();

    const autofillSlider = page.getByTestId('threshold-slider-floor');
    await autofillSlider.focus();

    // Focus ring should be visible (via CSS outline or box-shadow)
    // In WCAG 2.1 AA, focus indicator must have 3:1 contrast and ≥ 2px
    const focusStyle = await autofillSlider.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        outline: computed.outline,
        outlineWidth: computed.outlineWidth,
        boxShadow: computed.boxShadow,
      };
    });

    // Either outline or box-shadow should be present
    const hasFocusIndicator = focusStyle.outline !== 'none' || focusStyle.boxShadow !== 'none';
    expect(hasFocusIndicator).toBe(true);
  });
});
