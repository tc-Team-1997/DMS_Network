import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('DocBrain — AI surfaces in Viewer', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoints so page.goto() resolves without a live session.
    await page.route('**/spa/api/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1, username: 'admin', full_name: 'Admin User',
          role: 'Doc Admin', branch: null, tenant_id: 'nbe',
          user: { id: 1, username: 'admin', full_name: 'Admin User',
                  role: 'Doc Admin', branch: null, tenant_id: 'nbe' },
        }),
      }),
    );
    await page.route('**/spa/api/auth/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: { id: 1, username: 'admin', role: 'Doc Admin', tenant_id: 'nbe' },
          session: {
            id: 'test1234',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7200_000).toISOString(),
            seconds_remaining: 7200,
            last_active_at: new Date().toISOString(),
            can_extend: true,
            warning_threshold: 1800,
          },
        }),
      }),
    );
    // Mock the document-types endpoint so the metadata panel can resolve labels.
    await page.route('**/spa/api/document-types**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 1,
          name: 'Passport',
          description: null,
          fields: [],
          active: 1,
          tenant_id: 'nbe',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]),
      }),
    );
    // Suppress PDF blob fetches — file doesn't exist in test environment.
    await page.route('**/uploads/**', (route) =>
      route.fulfill({ status: 404, body: '{}' }),
    );
  });

  test('viewer renders AI panel with Analyse button when no analysis yet', async ({ page }) => {
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
    await page.route('**/spa/api/docbrain/chat/stream', (route) => {
      const sse = [
        'data: {"type":"citations","items":[{"document_id":1,"chunk_index":0,"snippet":"Date of expiry: 2032-01-09"}]}',
        '',
        'data: {"type":"token","text":"The passport expires on 2032-01-09[^1]."}',
        '',
        'data: {"type":"done","has_evidence":true}',
        '',
        '',
      ].join('\n');
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sse,
      });
    });
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('When does this passport expire?');
    await page.getByTestId('docbrain-chat-send').click();
    const log = page.getByTestId('docbrain-chat-log');
    await expect(log.getByText('When does this passport expire?')).toBeVisible();
    await expect(log.getByText(/expires on 2032-01-09/)).toBeVisible();
  });

  test('RAG refuses an answer without evidence and surfaces the warning', async ({ page }) => {
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
    await page.route('**/spa/api/docbrain/chat/stream', (route) => {
      const sse = [
        'data: {"type":"no_evidence","message":"I could not find supporting passages."}',
        '',
        '',
      ].join('\n');
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sse,
      });
    });
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('What colour is the customer\'s tie?');
    await page.getByTestId('docbrain-chat-send').click();
    await expect(page.getByText(/No grounded evidence/i)).toBeVisible();
  });

  test('needs_verification: answer rendered with amber verify banner + retrieved passages', async ({ page }) => {
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
    await page.route('**/spa/api/docbrain/chat/stream', (route) => {
      const sse = [
        'data: {"type":"citations","items":[{"document_id":1,"chunk_index":0,"snippet":"Date of expiry: 2032-01-09"},{"document_id":1,"chunk_index":1,"snippet":"Issuing authority: Egyptian Passport Authority"}]}',
        '',
        'data: {"type":"token","text":"The passport expires in 2032."}',
        '',
        'data: {"type":"done","has_evidence":true,"needs_verification":true}',
        '',
        '',
      ].join('\n');
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sse,
      });
    });
    await page.goto('/viewer/1');
    await page.getByTestId('docbrain-chat-input').fill('When does it expire?');
    await page.getByTestId('docbrain-chat-send').click();
    const verify = page.getByTestId('docbrain-chat-verify');
    await expect(verify).toBeVisible();
    await expect(verify).toContainText(/Model did not cite passages/);
    await expect(verify).toContainText('Date of expiry: 2032-01-09');
  });

  test('chat is gated with a warning when chunks_indexed === 0', async ({ page }) => {
    // Mock the document endpoint.
    await page.route('**/spa/api/documents/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          filename: 'sample.pdf',
          original_name: 'Sample.pdf',
          doc_type: 'Passport',
          customer_cid: null,
          customer_name: null,
          doc_number: null,
          expiry_date: null,
          branch: null,
          folder_id: null,
          status: 'Valid',
          version: 'v1.0',
          size: 1000,
          mime_type: 'application/pdf',
          ocr_confidence: null,
          metadata_json: null,
          uploaded_at: new Date().toISOString(),
        }),
      }),
    );
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
