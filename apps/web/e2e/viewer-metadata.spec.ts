import { test, expect } from '@playwright/test';
import { login } from './helpers';

// The viewer loads three SPA routes we need to mock so the specs are
// deterministic against the live DB state:
//   /spa/api/documents/:id       — the document row (metadata_json is what we're testing)
//   /spa/api/document-types      — the schema used to resolve field labels
//   /spa/api/docbrain/document/* — the AI sidecar (optional; 404 is fine)
const DOC_ID = 42;

function docRow(metadata: object) {
  return {
    id: DOC_ID,
    filename: 'sample.pdf',
    original_name: 'Sample passport.pdf',
    doc_type: 'Passport',
    customer_cid: '10742002885',
    customer_name: 'Phanaho',
    doc_number: '10742002885',
    expiry_date: '2031-12-31',
    branch: 'Thimphu',
    folder_id: null,
    status: 'Valid',
    version: 'v1.0',
    size: 8878,
    mime_type: 'application/pdf',
    ocr_confidence: 95,
    metadata_json: JSON.stringify(metadata),
    uploaded_at: new Date().toISOString(),
  };
}

function passportType() {
  return [
    {
      id: 100,
      name: 'Passport',
      description: '',
      fields: [
        { key: 'customer_name',     label: 'Customer name',     type: 'text', required: false },
        { key: 'customer_cid',      label: 'Customer CID',      type: 'text', required: false },
        { key: 'doc_number',        label: 'Passport number',   type: 'text', required: false },
        { key: 'dob',               label: 'Date of birth',     type: 'date', required: false },
        { key: 'expiry_date',       label: 'Expiry date',       type: 'date', required: false },
      ],
      active: 1,
      tenant_id: 'nbe',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
}

test.describe('Viewer — Captured Metadata panel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // No AI analysis row — keeps the test focused on the metadata panel.
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({ status: 404, body: '{}' }),
    );
    await page.route('**/spa/api/document-types**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(passportType()),
      }),
    );
  });

  test('renders schema fields, extras, and AI provenance', async ({ page }) => {
    const META = {
      customer_name: 'Phanaho',
      customer_cid: '10742002885',
      doc_number: '10742002885',
      dob: '2000-12-26',
      expiry_date: '2031-12-31',
      // Extra — not in the Passport schema, should fall under "Additional fields"
      issuing_authority: 'KINGDOM OF BHUTAN',
      place_of_birth: 'Bhutan',
      _ai: {
        classification: {
          doc_class: 'National ID',
          confidence: 0.9,
          reasoning: 'Contains a citizenship card with a unique ID number.',
          alternative: null,
        },
        ocr: {
          pages: 1,
          mean_confidence: 95,
          languages: ['eng'],
          backend: 'qwen2.5vl:7b',
        },
        chunks_indexed: 1,
        extracted_at: '2026-04-17T22:16:41.949Z',
      },
      _ai_fields: {
        customer_name: { value: 'Phuntsho Tashi', confidence: 1 },
        dob:           { value: '2000-12-26',     confidence: 1 },
      },
    };
    await page.route(`**/spa/api/documents/${DOC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(docRow(META)),
      }),
    );
    await page.goto(`/viewer/${DOC_ID}`);

    // Pretty view renders schema fields.
    await expect(page.getByRole('heading', { name: 'Captured metadata' })).toBeVisible();
    await expect(page.getByText('Passport fields')).toBeVisible();
    await expect(page.getByText('10742002885').first()).toBeVisible();
    // Extras live in their own sub-section.
    await expect(page.getByText('Additional fields')).toBeVisible();
    await expect(page.getByText('KINGDOM OF BHUTAN')).toBeVisible();
    // Provenance card shows classification + OCR backend.
    const ai = page.getByTestId('viewer-meta-ai');
    await expect(ai).toBeVisible();
    await expect(ai).toContainText(/National ID/);
    await expect(ai).toContainText(/qwen2.5vl:7b/);
    await expect(ai).toContainText(/citizenship card/);
    // Confidence badge next to a field the AI detected at 100%.
    await expect(page.getByText(/AI · 100%/).first()).toBeVisible();
  });

  test('raw JSON toggle shows the full payload with a copy button', async ({ page }) => {
    const META = { customer_name: 'X', _ai: { chunks_indexed: 0, classification: { doc_class: 'Other', confidence: 0 } } };
    await page.route(`**/spa/api/documents/${DOC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(docRow(META)),
      }),
    );
    await page.goto(`/viewer/${DOC_ID}`);
    await page.getByTestId('viewer-meta-raw').click();
    const pre = page.getByTestId('viewer-meta-json');
    await expect(pre).toBeVisible();
    await expect(pre).toContainText('"customer_name": "X"');
    await expect(pre).toContainText('"_ai"');
    await expect(page.getByTestId('viewer-meta-copy')).toBeVisible();
    // Switch back.
    await page.getByTestId('viewer-meta-pretty').click();
    await expect(pre).not.toBeVisible();
  });

  test('empty metadata shows the "run Analyse" prompt', async ({ page }) => {
    await page.route(`**/spa/api/documents/${DOC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...docRow({}), metadata_json: null }),
      }),
    );
    await page.goto(`/viewer/${DOC_ID}`);
    const heading = page.getByRole('heading', { name: 'Captured metadata' });
    await expect(heading).toBeVisible();
    await expect(page.getByText(/No metadata captured/)).toBeVisible();
  });
});
