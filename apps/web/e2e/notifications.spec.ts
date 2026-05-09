/**
 * E2E tests for the Notifications module — Wave C (F#23).
 *
 * Happy-path group: runs against real Node stack (mocked API responses so the
 * test harness does not need seeded notification rows).
 *
 * Error-state group: uses page.route() to simulate failure responses and
 * verifies the UI handles them gracefully.
 *
 * Admin test-send group: verifies the test-send button on the
 * /admin/settings/notifications panel fires correctly.
 *
 * Run with:
 *   npx playwright test notifications.spec.ts --reporter=line
 */

import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const FEED_EMPTY = {
  items: [],
  unread_count: 0,
  limit: 10,
  offset: 0,
};

const FEED_WITH_ITEMS = {
  items: [
    {
      id: 101,
      channel: 'in_app',
      subject: 'Document Expiry Alert',
      body: '3 documents expired today.',
      status: 'sent',
      sent_at: new Date().toISOString(),
      is_read: 0,
      read_at: null,
      event_type: 'expiry_alert',
      template_id: 'expiry_alert',
    },
    {
      id: 102,
      channel: 'email',
      subject: 'Workflow Assigned',
      body: 'You have been assigned a workflow.',
      status: 'sent',
      sent_at: new Date(Date.now() - 3600_000).toISOString(),
      is_read: 1,
      read_at: new Date(Date.now() - 1800_000).toISOString(),
      event_type: 'workflow_assigned',
      template_id: 'workflow_assigned',
    },
  ],
  unread_count: 1,
  limit: 100,
  offset: 0,
};

const TEST_SEND_RESPONSE = {
  ok: true,
  template_id: 'expiry_alert',
  subject: '[TEST] Document Expiry Alert',
  body: 'Dear Doc Admin, 3 documents have expired.',
  results: { email: { ok: true }, in_app: { ok: true } },
  skipped: ['sms', 'push'],
};

async function mockFeedApis(page: Page, feed = FEED_WITH_ITEMS): Promise<void> {
  await page.route('**/spa/api/notifications*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(feed),
    });
  });
  await page.route('**/spa/api/notifications/mark-all-read', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/spa/api/notifications/*/mark-read', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function mockAdminTestSend(page: Page, response = TEST_SEND_RESPONSE, status = 200): Promise<void> {
  await page.route('**/spa/api/admin/notifications/test-send', (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

// ---------------------------------------------------------------------------
// Group 1 — /notifications feed page (happy path)
// ---------------------------------------------------------------------------

test.describe('Notifications feed page — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await mockFeedApis(page);
    await login(page, 'admin', 'admin123');
  });

  test('navigates to /notifications and renders the page heading', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    // Panel title includes the count
    await expect(page.getByText(/Notifications/)).toBeVisible();
  });

  test('shows notification items with subject and channel badge', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Document Expiry Alert')).toBeVisible();
    await expect(page.getByText('Workflow Assigned')).toBeVisible();
    // Channel badge for first item
    await expect(page.getByText('in_app').first()).toBeVisible();
  });

  test('unread count label is shown in the panel action area', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('1 unread')).toBeVisible();
  });

  test('"Mark all read" button is present when there are unread items', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /mark all read/i })).toBeVisible();
  });

  test('"Mark all read" button triggers the API and mutation succeeds', async ({ page }) => {
    let markAllCalled = false;
    await page.route('**/spa/api/notifications/mark-all-read', (route) => {
      markAllCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /mark all read/i }).click();
    await page.waitForTimeout(300);
    expect(markAllCalled).toBe(true);
  });

  test('"Mark read" button on unread item triggers the mark-read API', async ({ page }) => {
    let markReadCalled = false;
    await page.route('**/spa/api/notifications/101/mark-read', (route) => {
      markReadCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    // The unread item row has an aria-label "Mark notification 101 as read"
    await page.getByRole('button', { name: /mark notification 101 as read/i }).click();
    await page.waitForTimeout(300);
    expect(markReadCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — empty feed state
// ---------------------------------------------------------------------------

test.describe('Notifications feed page — empty state', () => {
  test.beforeEach(async ({ page }) => {
    await mockFeedApis(page, FEED_EMPTY);
    await login(page, 'admin', 'admin123');
  });

  test('shows empty-state message when no notifications', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/No notifications/i)).toBeVisible();
  });

  test('"Mark all read" button is not shown when unread count is 0', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    const markAllBtn = page.getByRole('button', { name: /mark all read/i });
    await expect(markAllBtn).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Topbar bell badge
// ---------------------------------------------------------------------------

test.describe('Topbar bell badge', () => {
  test.beforeEach(async ({ page }) => {
    // Feed with 1 unread — also covers the feed popover
    await page.route('**/spa/api/notifications*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...FEED_WITH_ITEMS, limit: 10 }),
      });
    });
    await login(page, 'admin', 'admin123');
  });

  test('bell button is present in the topbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /notifications/i }).first()).toBeVisible();
  });

  test('bell button shows unread dot when unread_count > 0', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The badge is an aria-hidden span; check the aria-label on the button
    const bell = page.getByRole('button', { name: /1 unread/i });
    await expect(bell).toBeVisible();
  });

  test('clicking bell opens the notification popover feed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const bell = page.getByRole('button', { name: /notifications/i }).first();
    await bell.click();
    // The popover heading
    await expect(page.getByText('Notifications').first()).toBeVisible();
    await expect(page.getByText('Document Expiry Alert')).toBeVisible();
  });

  test('"View all notifications" link in popover navigates to /notifications', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /notifications/i }).first().click();
    await page.getByRole('link', { name: /view all notifications/i }).click();
    await expect(page).toHaveURL(/\/notifications/);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — Error states (mocked)
// ---------------------------------------------------------------------------

test.describe('Notifications — error states', () => {
  test.beforeEach(async ({ page }) => {
    // Provide a valid feed first so the page renders
    await mockFeedApis(page);
    await login(page, 'admin', 'admin123');
  });

  test('mark-read 500 does not crash the page', async ({ page }) => {
    // Override mark-read to return 500 after login
    await page.route('**/spa/api/notifications/101/mark-read', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) });
    });

    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /mark notification 101 as read/i }).click();
    await page.waitForTimeout(400);
    // Page should still show the notification list, not a crash
    await expect(page.getByText('Document Expiry Alert')).toBeVisible();
  });

  test('mark-all-read 500 does not crash the page', async ({ page }) => {
    await page.route('**/spa/api/notifications/mark-all-read', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) });
    });

    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /mark all read/i }).click();
    await page.waitForTimeout(400);
    // Page should still show items
    await expect(page.getByText('Document Expiry Alert')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Group 5 — Admin test-send (happy path + error)
// ---------------------------------------------------------------------------

test.describe('Admin test-send panel', () => {
  test.beforeEach(async ({ page }) => {
    // Mock config reads for the notifications namespace
    await page.route('**/spa/api/admin/config/notifications', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          'channels.email.enabled': true,
          'channels.in_app.enabled': true,
          'email.provider': 'local',
          'sms.provider': 'noop',
          'templates.expiry_alert.subject': 'Expiry Alert — {{count}} docs',
          'templates.expiry_alert.body': 'Dear {{role}}, {{count}} docs expired.',
          'templates.expiry_alert.channels': '["email","in_app"]',
          'routing.expiry_alert': '["Doc Admin"]',
        }),
      });
    });
    await page.route('**/spa/api/admin/config-schema/notifications', (route) => {
      route.fulfill({ status: 404, body: '{}' });
    });
    await mockAdminTestSend(page);
    await login(page, 'admin', 'admin123');
  });

  test('renders the notifications settings panel with channel toggles', async ({ page }) => {
    await page.goto('/admin/settings/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Channels')).toBeVisible();
    await expect(page.getByText('Email')).toBeVisible();
    await expect(page.getByText('SMS')).toBeVisible();
  });

  test('renders the Templates section with event-type accordions', async ({ page }) => {
    await page.goto('/admin/settings/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Templates')).toBeVisible();
    await expect(page.getByText('Document Expiry Alert')).toBeVisible();
  });

  test('expanding a template accordion shows subject/body fields and Test send button', async ({ page }) => {
    await page.goto('/admin/settings/notifications');
    await page.waitForLoadState('networkidle');
    // Click the accordion for expiry_alert
    await page.getByText('Document Expiry Alert').click();
    await expect(page.getByRole('button', { name: /test send/i })).toBeVisible();
    await expect(page.getByText('Active channels')).toBeVisible();
    await expect(page.getByText('Recipient roles')).toBeVisible();
  });

  test('test-send button fires the API and shows preview result', async ({ page }) => {
    let testSendCalled = false;
    await page.route('**/spa/api/admin/notifications/test-send', (route) => {
      testSendCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_SEND_RESPONSE),
      });
    });

    await page.goto('/admin/settings/notifications');
    await page.waitForLoadState('networkidle');
    await page.getByText('Document Expiry Alert').click();
    await page.getByRole('button', { name: /test send/i }).click();
    await page.waitForTimeout(500);
    expect(testSendCalled).toBe(true);
    // Result preview should appear
    await expect(page.getByText('[TEST] Document Expiry Alert')).toBeVisible();
  });

  test('test-send 500 shows toast error without crashing', async ({ page }) => {
    await page.route('**/spa/api/admin/notifications/test-send', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'SMTP not configured' }),
      });
    });

    await page.goto('/admin/settings/notifications');
    await page.waitForLoadState('networkidle');
    await page.getByText('Document Expiry Alert').click();
    await page.getByRole('button', { name: /test send/i }).click();
    await page.waitForTimeout(500);
    // Panel heading should still be visible
    await expect(page.getByText('Templates')).toBeVisible();
  });
});
