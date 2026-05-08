import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('DocBrain — AI surfaces in Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('viewer renders AI panel with Analyse button when no analysis yet', async ({ page }) => {
    // The analysis endpoint returns 404 until an analysis exists; stub it so
    // this test stays fast and deterministic regardless of Ollama state.
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'not analysed yet' }) }),
    );
    await page.goto('/viewer/1');
    await expect(page.getByRole('heading', { name: 'DocBrain' })).toBeVisible();
    await expect(page.getByTestId('docbrain-analyze-btn')).toBeVisible();
    await expect(page.getByText(/not analysed yet/i)).toBeVisible();
  });

  test('viewer renders AI panel populated from stored analysis', async ({ page }) => {
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          document_id: 1,
          classification: {
            doc_class: 'Passport',
            confidence: 0.95,
            reasoning: 'Contains passport-typical fields: passport number, issue/expiry dates, issuing authority.',
            alternative: null,
          },
          extraction: {
            customer_cid:      { value: 'EGY-2024-00847',        confidence: 0.98 },
            customer_name:     { value: 'Ahmed Hassan IBRAHIM',  confidence: 0.97 },
            doc_number:        { value: 'A12345678',             confidence: 0.99 },
            dob:               { value: '1985-06-12',            confidence: 0.95 },
            issue_date:        { value: '2022-01-09',            confidence: 0.98 },
            expiry_date:       { value: '2032-01-09',            confidence: 0.98 },
            issuing_authority: { value: 'Ministry of Foreign Affairs', confidence: 0.9 },
            address:           { value: null, confidence: 0.0 },
          },
          ocr_language:   'eng',
          ocr_confidence: 97.2,
          chunks_indexed: 3,
          updated_at:     '2026-04-17T00:00:00Z',
        }),
      }),
    );
    await page.goto('/viewer/1');
    const panel = page.getByTestId('docbrain-analysis');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Passport', { exact: true })).toBeVisible();
    await expect(panel.getByText('EGY-2024-00847')).toBeVisible();
    await expect(panel.getByText('Ahmed Hassan IBRAHIM')).toBeVisible();
    await expect(panel.getByText('A12345678')).toBeVisible();
    await expect(panel.getByText(/Local · eng · OCR 97%/)).toBeVisible();
  });

  test('RAG chat sends question and renders grounded answer with citation', async ({ page }) => {
    // Supply a populated analysis so the chat input is un-gated.
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          document_id: 1,
          classification: { doc_class: 'Passport', confidence: 0.95, reasoning: 'mocked' },
          extraction: {
            customer_cid:      { value: 'EGY-2024-00847', confidence: 0.9 },
            customer_name:     { value: 'Ahmed H. Ibrahim', confidence: 0.9 },
            doc_number:        { value: 'A12345678', confidence: 0.9 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: null, confidence: 0 },
            expiry_date:       { value: '2032-01-09', confidence: 0.9 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr_language: 'eng',
          ocr_confidence: 97,
          chunks_indexed: 3,
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    await page.route('**/spa/api/docbrain/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'The passport expires on 2032-01-09[^1].',
          citations: [{
            document_id: 1, chunk_index: 0,
            snippet: 'Date of expiry: 2032-01-09',
          }],
          has_evidence: true,
        }),
      }),
    );
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('When does this passport expire?');
    await page.getByTestId('docbrain-chat-send').click();
    const log = page.getByTestId('docbrain-chat-log');
    await expect(log.getByText('When does this passport expire?')).toBeVisible();
    await expect(log.getByText(/expires on 2032-01-09/)).toBeVisible();
  });

  test('RAG refuses an answer without evidence and surfaces the warning', async ({ page }) => {
    // Supply a populated analysis so the chat input is un-gated.
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          document_id: 1,
          classification: { doc_class: 'Passport', confidence: 0.95, reasoning: 'mocked' },
          extraction: {
            customer_cid:      { value: 'EGY-2024-00847', confidence: 0.9 },
            customer_name:     { value: 'Ahmed H. Ibrahim', confidence: 0.9 },
            doc_number:        { value: 'A12345678', confidence: 0.9 },
            dob:               { value: null, confidence: 0 },
            issue_date:        { value: null, confidence: 0 },
            expiry_date:       { value: '2032-01-09', confidence: 0.9 },
            issuing_authority: { value: null, confidence: 0 },
            address:           { value: null, confidence: 0 },
          },
          ocr_language: 'eng',
          ocr_confidence: 97,
          chunks_indexed: 3,
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    await page.route('**/spa/api/docbrain/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'I could not find supporting passages.',
          citations: [],
          has_evidence: false,
        }),
      }),
    );
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('What colour is the customer\'s tie?');
    await page.getByTestId('docbrain-chat-send').click();
    await expect(page.getByText(/No grounded evidence/i)).toBeVisible();
  });

  test('needs_verification: answer rendered with amber verify banner + retrieved passages', async ({ page }) => {
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          document_id: 1,
          classification: { doc_class: 'Passport', confidence: 0.95, reasoning: 'mocked' },
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
          ocr_language: 'eng',
          ocr_confidence: 50,
          chunks_indexed: 2,
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    await page.route('**/spa/api/docbrain/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'The passport expires in 2032.',
          citations: [
            { document_id: 1, chunk_index: 0, snippet: 'Date of expiry: 2032-01-09' },
            { document_id: 1, chunk_index: 1, snippet: 'Issuing authority: Egyptian Passport Authority' },
          ],
          has_evidence: true,
          needs_verification: true,
        }),
      }),
    );
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('When does it expire?');
    await page.getByTestId('docbrain-chat-send').click();
    const verify = page.getByTestId('docbrain-chat-verify');
    await expect(verify).toBeVisible();
    await expect(verify).toContainText(/Model did not cite passages/);
    await expect(verify).toContainText('Date of expiry: 2032-01-09');
  });

  test('chat is gated with a warning when chunks_indexed === 0', async ({ page }) => {
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          document_id: 1,
          classification: { doc_class: 'Passport', confidence: 0.95, reasoning: 'mocked' },
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
          ocr_language: 'eng',
          ocr_confidence: 0,
          chunks_indexed: 0,
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    await page.goto('/viewer/1');
    await expect(page.getByTestId('docbrain-chat-not-indexed')).toBeVisible();
    await expect(page.getByTestId('docbrain-chat-input')).toBeDisabled();
    await expect(page.getByTestId('docbrain-chat-send')).toBeDisabled();
  });
});
