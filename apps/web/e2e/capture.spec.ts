import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Stable schema for the Capture form so specs don't depend on seeded types.
// Mirrors the Passport defaults but relaxes the required set to what each
// test actually fills in.
const MOCK_TYPES = [
  {
    id: 100,
    name: 'Passport',
    description: 'Test passport schema',
    fields: [
      { key: 'customer_name',     label: 'Customer name',     type: 'text', required: false, ai_extract_from: 'customer_name' },
      { key: 'customer_cid',      label: 'Customer CID',      type: 'text', required: false, ai_extract_from: 'customer_cid' },
      { key: 'doc_number',        label: 'Passport number',   type: 'text', required: false, ai_extract_from: 'doc_number' },
      { key: 'dob',               label: 'Date of birth',     type: 'date', required: false, ai_extract_from: 'dob' },
      { key: 'issue_date',        label: 'Issue date',        type: 'date', required: false, ai_extract_from: 'issue_date' },
      { key: 'expiry_date',       label: 'Expiry date',       type: 'date', required: false, ai_extract_from: 'expiry_date' },
      { key: 'issuing_authority', label: 'Issuing authority', type: 'text', required: false, ai_extract_from: 'issuing_authority' },
    ],
    active: 1,
    tenant_id: 'nbe',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 101,
    name: 'National ID',
    description: '',
    fields: [
      { key: 'customer_name', label: 'Customer name', type: 'text', required: false, ai_extract_from: 'customer_name' },
      { key: 'customer_cid',  label: 'Customer CID',  type: 'text', required: false, ai_extract_from: 'customer_cid' },
      { key: 'doc_number',    label: 'Card number',   type: 'text', required: false, ai_extract_from: 'doc_number' },
    ],
    active: 1,
    tenant_id: 'nbe',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

test.describe('Capture with AI auto-fill', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Pin a predictable document-type schema for every capture spec.
    await page.route('**/spa/api/document-types**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_TYPES),
        });
        return;
      }
      return route.continue();
    });
    await page.goto('/capture');
  });

  test('dropzone and form render', async ({ page }) => {
    await expect(page.getByTestId('capture-dropzone')).toBeVisible();
    await expect(page.getByTestId('capture-field-doc_type')).toBeVisible();
    await expect(page.getByTestId('capture-field-customer_name')).toBeVisible();
    await expect(page.getByTestId('capture-submit')).toBeDisabled();
  });

  test('mocked preview auto-fills the form with confidence badges', async ({ page }) => {
    // Intercept the preview endpoint with a realistic response.
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: {
            doc_class: 'Passport',
            confidence: 0.92,
            reasoning: 'MRZ line + passport number format',
            alternative: null,
          },
          extraction: {
            customer_cid:      { value: 'EGY-2024-99999', confidence: 0.88 },
            customer_name:     { value: 'Test Person', confidence: 0.91 },
            doc_number:        { value: 'X1234567', confidence: 0.85 },
            dob:               { value: '1990-05-12', confidence: 0.80 },
            issue_date:        { value: '2022-01-01', confidence: 0.78 },
            expiry_date:       { value: '2032-01-01', confidence: 0.82 },
            issuing_authority: { value: 'Egyptian Passport Authority', confidence: 0.74 },
            address:           { value: '5 Test St, Cairo', confidence: 0.65 },
          },
          ocr: { pages: 2, mean_confidence: 96.4, languages: ['eng'] },
          prefill: {
            doc_type: 'Passport',
            customer_cid: 'EGY-2024-99999',
            customer_name: 'Test Person',
            doc_number: 'X1234567',
            dob: '1990-05-12',
            issue_date: '2022-01-01',
            expiry_date: '2032-01-01',
            issuing_authority: 'Egyptian Passport Authority',
          },
        }),
      });
    });

    // Drop a tiny PDF-typed payload into the file input. The content doesn't
    // matter — the preview response is mocked.
    const fileInput = page.getByTestId('capture-file-input');
    await fileInput.setInputFiles({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });

    // Preview banner shows "done" state with the classification.
    await expect(page.getByTestId('capture-preview-done')).toBeVisible();
    await expect(page.getByTestId('capture-preview-done')).toContainText('Passport');

    // High-confidence fields got auto-filled. doc_type select's value is
    // the schema row id — mock Passport = 100.
    await expect(page.getByTestId('capture-field-doc_type')).toHaveValue('100');
    await expect(page.getByTestId('capture-field-customer_cid')).toHaveValue('EGY-2024-99999');
    await expect(page.getByTestId('capture-field-customer_name')).toHaveValue('Test Person');
    await expect(page.getByTestId('capture-field-doc_number')).toHaveValue('X1234567');
    await expect(page.getByTestId('capture-field-expiry_date')).toHaveValue('2032-01-01');

    // Confidence badge appears next to an AI-filled field.
    await expect(page.getByText(/AI · 91%/).first()).toBeVisible();

    // Submit is enabled once a file is chosen.
    await expect(page.getByTestId('capture-submit')).toBeEnabled();
  });

  test('user edits clear the AI confidence badge for that field', async ({ page }) => {
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: { doc_class: 'Passport', confidence: 0.9, reasoning: '', alternative: null },
          extraction: {
            customer_cid:      { value: 'EGY-2024-11111', confidence: 0.85 },
            customer_name:     { value: null, confidence: 0 },
            doc_number:        { value: null, confidence: 0 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: null, confidence: 0 },
            expiry_date:       { value: null, confidence: 0 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr: { pages: 1, mean_confidence: 95, languages: ['eng'] },
          prefill: { doc_type: 'Passport', customer_cid: 'EGY-2024-11111' },
        }),
      });
    });

    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    await expect(page.getByTestId('capture-field-customer_cid')).toHaveValue('EGY-2024-11111');
    // Badge exists for customer_cid before the edit.
    await expect(page.getByText(/AI · 85%/)).toBeVisible();
    // Edit the field — badge should disappear.
    await page.getByTestId('capture-field-customer_cid').fill('manual-override');
    await expect(page.getByText(/AI · 85%/)).toHaveCount(0);
  });

  test('low-confidence extractions still populate with amber "verify" badges', async ({ page }) => {
    // Small local models rarely hit 0.7 on real documents. Anything the AI
    // extracts with ≥0.4 confidence should still land in the form; the badge
    // tells the maker to verify rather than leaving them to retype.
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: { doc_class: 'National ID', confidence: 0.55, reasoning: '', alternative: null },
          extraction: {
            customer_cid:      { value: 'EGY-2024-44444', confidence: 0.50 },
            customer_name:     { value: 'Amir Hamed',    confidence: 0.48 },
            doc_number:        { value: 'N999111',       confidence: 0.42 },
            dob:               { value: '1985-07-03',    confidence: 0.45 },
            issue_date:        { value: null,            confidence: 0.0  },
            expiry_date:       { value: null,            confidence: 0.0  },
            issuing_authority: { value: null,            confidence: 0.0  },
            address:           { value: null,            confidence: 0.0  },
          },
          ocr: { pages: 1, mean_confidence: 85, languages: ['eng'] },
          prefill: {},
        }),
      });
    });
    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'id.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    await expect(page.getByTestId('capture-field-customer_cid')).toHaveValue('EGY-2024-44444');
    await expect(page.getByTestId('capture-field-customer_name')).toHaveValue('Amir Hamed');
    await expect(page.getByTestId('capture-field-doc_number')).toHaveValue('N999111');
    // National ID schema in the mock only has three fields — no dob.
    await expect(page.getByTestId('capture-field-doc_type')).toHaveValue('101');
    // Amber verify badge appears on a medium-confidence field.
    await expect(page.getByText(/AI · 50% · verify/)).toBeVisible();
  });

  test('upload button is disabled while the AI preview is running', async ({ page }) => {
    // Hold the preview open for a beat so the "running" state is observable.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: { doc_class: 'Other', confidence: 0.5, reasoning: '', alternative: null },
          extraction: {
            customer_cid:      { value: null, confidence: 0 },
            customer_name:     { value: null, confidence: 0 },
            doc_number:        { value: null, confidence: 0 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: null, confidence: 0 },
            expiry_date:       { value: null, confidence: 0 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr: { pages: 1, mean_confidence: 80, languages: ['eng'] },
          prefill: {},
        }),
      });
    });

    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    // Button shows "Analysing…" and is disabled.
    await expect(page.getByTestId('capture-submit')).toBeDisabled();
    await expect(page.getByTestId('capture-submit')).toHaveText(/Analysing/);
    // Release the preview — button becomes enabled and reverts to "Upload".
    release?.();
    await expect(page.getByTestId('capture-submit')).toBeEnabled();
    await expect(page.getByTestId('capture-submit')).toHaveText(/Upload/);
  });

  test('right-hand summary renders classification + extracted fields', async ({ page }) => {
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: {
            doc_class: 'Passport',
            confidence: 0.92,
            reasoning: 'MRZ line detected; machine-readable zone matches ICAO 9303.',
            alternative: 'National ID',
          },
          extraction: {
            customer_cid:      { value: 'EGY-2024-77777', confidence: 0.88 },
            customer_name:     { value: 'Summary Person', confidence: 0.81 },
            doc_number:        { value: 'P7654321', confidence: 0.9 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: '2020-03-01', confidence: 0.55 },
            expiry_date:       { value: '2030-03-01', confidence: 0.55 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr: { pages: 3, mean_confidence: 96, languages: ['eng', 'ara'] },
          prefill: {
            doc_type: 'Passport',
            customer_cid: 'EGY-2024-77777',
            customer_name: 'Summary Person',
            doc_number: 'P7654321',
          },
        }),
      });
    });

    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'summary.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });

    // Summary panel is present. Scope all assertions to it so they don't
    // collide with the small PreviewStatus banner in the form column.
    const summary = page.getByTestId('capture-summary-done');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/MRZ line detected/);
    await expect(summary).toContainText(/Alternative considered: National ID/);
    await expect(summary).toContainText(/3 pages/);
    await expect(summary).toContainText(/96% text clarity/);
    await expect(summary).toContainText(/eng, ara/);
    await expect(summary).toContainText(/Extracted fields \(5 \/ 8\)/);
    await expect(summary).toContainText('EGY-2024-77777');
    await expect(summary).toContainText('Summary Person');
    await expect(summary).toContainText('P7654321');
    await expect(summary).toContainText(/not detected/);
  });

  test('file preview renders inline for PDF / image / falls back for others', async ({ page }) => {
    // Neutral preview mock so the test focuses on the file preview panel.
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: { doc_class: 'Other', confidence: 0.3, reasoning: '', alternative: null },
          extraction: {
            customer_cid:      { value: null, confidence: 0 },
            customer_name:     { value: null, confidence: 0 },
            doc_number:        { value: null, confidence: 0 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: null, confidence: 0 },
            expiry_date:       { value: null, confidence: 0 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr: { pages: 1, mean_confidence: 80, languages: ['eng'] },
          prefill: {},
        }),
      });
    });

    // PDF → iframe
    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    await expect(page.getByTestId('capture-file-preview-pdf')).toBeVisible();

    // Swap to an image → <img>
    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'a.png',
      mimeType: 'image/png',
      // 1-pixel PNG
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByTestId('capture-file-preview-image')).toBeVisible();

    // Swap to a plain text file → fallback
    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
    });
    await expect(page.getByTestId('capture-file-preview-unavailable')).toBeVisible();
  });

  test('Upload opens a confirmation dialog before posting', async ({ page }) => {
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: { doc_class: 'Passport', confidence: 0.9, reasoning: '', alternative: null },
          extraction: {
            customer_cid:      { value: 'EGY-2024-22222', confidence: 0.85 },
            customer_name:     { value: 'Confirm Person',  confidence: 0.9 },
            doc_number:        { value: 'P5555', confidence: 0.8 },
            dob:               { value: null,    confidence: 0 },
            issue_date:        { value: null,    confidence: 0 },
            expiry_date:       { value: null,    confidence: 0 },
            issuing_authority: { value: null,    confidence: 0 },
            address:           { value: null,    confidence: 0 },
          },
          ocr: { pages: 1, mean_confidence: 96, languages: ['eng'] },
          prefill: {
            doc_type: 'Passport',
            customer_cid: 'EGY-2024-22222',
            customer_name: 'Confirm Person',
            doc_number: 'P5555',
          },
        }),
      });
    });

    let uploadCalls = 0;
    await page.route('**/spa/api/documents', async (route) => {
      if (route.request().method() === 'POST') {
        uploadCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 501 }),
        });
        return;
      }
      return route.continue();
    });

    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'confirm.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    await expect(page.getByTestId('capture-field-customer_name')).toHaveValue('Confirm Person');

    await page.getByTestId('capture-submit').click();
    // Dialog opens; upload has NOT fired yet.
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    expect(uploadCalls).toBe(0);

    // The rows shown reflect the current form state. doc_type is rendered
    // in the File section header, not as a confirm-row.
    await expect(dialog).toContainText('Passport');
    await expect(page.getByTestId('confirm-row-customer_name')).toContainText('Confirm Person');
    await expect(page.getByTestId('confirm-row-customer_cid')).toContainText('EGY-2024-22222');
    await expect(page.getByTestId('confirm-row-doc_number')).toContainText('P5555');

    // Cancel → dialog closes, still no upload.
    await page.getByTestId('confirm-cancel').click();
    await expect(dialog).not.toBeVisible();
    expect(uploadCalls).toBe(0);

    // Reopen and confirm → upload fires once.
    await page.getByTestId('capture-submit').click();
    await page.getByTestId('confirm-upload').click();
    await expect.poll(() => uploadCalls).toBe(1);
    // Success banner appears.
    await expect(page.getByTestId('capture-success')).toBeVisible();
  });

  test('preview failure surfaces an inline error with retry', async ({ page }) => {
    await page.route('**/spa/api/docbrain/preview', async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'preview_failed', detail: 'ollama down' }),
      });
    });
    await page.getByTestId('capture-file-input').setInputFiles({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mocked'),
    });
    await expect(page.getByTestId('capture-preview-error')).toBeVisible();
  });
});
