import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('AI chat (streaming)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('empty state shows suggested prompts', async ({ page }) => {
    // Mock /ai/conversations to return empty — user starts fresh.
    await page.route('**/spa/api/ai/conversations', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      return route.continue();
    });
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: 'Ask your document corpus' })).toBeVisible();
    await expect(page.getByTestId('chat-suggested').first()).toBeVisible();
  });

  test('mocked: streaming send appends tokens and renders citations', async ({ page }) => {
    // Empty conversation list.
    await page.route('**/spa/api/ai/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 42,
            user_id: 1,
            title: 'Test chat',
            scope_type: 'all',
            scope_id: null,
            tenant_id: 'nbe',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    // /ai/agent/stream — write back an SSE body with a citation, two tokens, done.
    await page.route('**/spa/api/ai/agent/stream', async (route) => {
      const sse = [
        'data: {"type":"citations","items":[{"document_id":1,"chunk_index":0,"snippet":"Test passage"}]}',
        '',
        'data: {"type":"token","text":"Hello "}',
        '',
        'data: {"type":"token","text":"world [^1]."}',
        '',
        'data: {"type":"done","has_evidence":true}',
        '',
        '',
      ].join('\n');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sse,
      });
    });

    await page.goto('/ai');
    // Start a new conversation + send through a suggested prompt.
    await page.getByTestId('chat-suggested').first().click();
    await expect(page.getByTestId('chat-msg-user')).toBeVisible();
    await expect(page.getByTestId('chat-msg-assistant')).toContainText(/Hello world/);
    // Citation list renders with the one item.
    await expect(page.getByTestId('chat-citations')).toBeVisible();
    await expect(page.getByTestId('chat-citation-link-1')).toBeVisible();
  });

  test('keyboard: Enter submits', async ({ page }) => {
    await page.route('**/spa/api/ai/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 7, user_id: 1, title: 'New', scope_type: 'all', scope_id: null,
            tenant_id: 'nbe', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });
    let streamCalled = false;
    await page.route('**/spa/api/ai/agent/stream', async (route) => {
      streamCalled = true;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: 'data: {"type":"done","has_evidence":false}\n\n',
      });
    });
    await page.goto('/ai');
    const input = page.getByTestId('chat-input');
    await input.fill('hello');
    await input.press('Enter');
    await expect.poll(() => streamCalled).toBe(true);
  });
});
