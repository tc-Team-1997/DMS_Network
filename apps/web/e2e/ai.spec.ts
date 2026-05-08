import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('AI Engine info page', () => {
  // The primary /ai route is the ChatPage (see chat.spec.ts). The capability
  // overview moved to /ai/engine.
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/ai/engine');
  });

  test('shows the DocBrain panel and capability list', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'DocBrain AI Engine' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Capabilities' })).toBeVisible();
    // Use exact — "document classification" also appears in the intro paragraph.
    await expect(page.getByText('Document classification', { exact: true })).toBeVisible();
    await expect(page.getByText('Field extraction', { exact: true })).toBeVisible();
    await expect(page.getByText('Grounded RAG chat', { exact: true })).toBeVisible();
  });

  test('shows the four metric cards', async ({ page }) => {
    await expect(page.getByText('Ollama', { exact: true })).toBeVisible();
    await expect(page.getByText('Chat model')).toBeVisible();
    await expect(page.getByText('Embed model')).toBeVisible();
    await expect(page.getByText('Vectors stored')).toBeVisible();
  });
});
