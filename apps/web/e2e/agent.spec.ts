import { test, expect } from '@playwright/test';
import { login } from './helpers';

// The RAG/Agent mode toggle was removed — Agent is now the only public chat
// mode because it can transparently call `find_documents` (grounded RAG)
// alongside the analytics tools. These specs confirm every submit lands on
// the agent stream endpoint regardless of the question shape.
test.describe('ChatPage — Agent (default)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('mode toggle is gone; header shows Agent label', async ({ page }) => {
    await page.route('**/spa/api/ai/conversations', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.goto('/ai');
    await expect(page.getByTestId('chat-mode-rag')).toHaveCount(0);
    await expect(page.getByTestId('chat-mode-agent')).toHaveCount(0);
    await expect(page.locator('text=/Agent ·/').first()).toBeVisible();
  });

  test('any submit routes to /ai/agent/stream and renders tool chips', async ({ page }) => {
    await page.route('**/spa/api/ai/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 77, user_id: 1, title: 'Agent test',
            scope_type: 'all', scope_id: null, tenant_id: 'nbe',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    let ragCalled = false;
    let agentCalled = false;
    await page.route('**/spa/api/ai/chat/stream', async (route) => {
      ragCalled = true;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: 'data: {"type":"done","has_evidence":false}\n\n',
      });
    });
    await page.route('**/spa/api/ai/agent/stream', async (route) => {
      agentCalled = true;
      const sse = [
        'data: {"type":"tool_call","name":"list_expiring","arguments":{"days":30}}',
        '',
        'data: {"type":"tool_result","name":"list_expiring","result":[{"id":5,"original_name":"Passport.pdf","expiry_date":"2026-05-01"}]}',
        '',
        'data: {"type":"token","text":"You have one document expiring in May 2026: doc#5."}',
        '',
        'data: {"type":"done","iterations":1,"used_tools":["list_expiring"]}',
        '',
        '',
      ].join('\n');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: sse,
      });
    });

    await page.goto('/ai');
    const input = page.getByTestId('chat-input');
    await input.fill('Which documents are expiring soon?');
    await input.press('Enter');

    await expect.poll(() => agentCalled).toBe(true);
    expect(ragCalled).toBe(false);
    await expect(page.locator('[data-testid^="chat-tools-"]').first()).toContainText('list_expiring');
    await expect(page.getByTestId('chat-msg-assistant').last()).toContainText(/expiring in May 2026/);
  });
});
