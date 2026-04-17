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
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({ status: 404, body: '{}' }),
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
    await page.route('**/spa/api/docbrain/document/**', (route) =>
      route.fulfill({ status: 404, body: '{}' }),
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
});
