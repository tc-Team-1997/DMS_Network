/**
 * Indexing Station — Playwright E2E (Wave B, migration 0034)
 *
 * Happy-path:  runs against the real stack (no mocking).
 * Error/edge:  uses page.route() mocks for claim conflicts,
 *              lock display, beacon release, keyboard nav.
 *
 * Queue fixture shape now includes a `lock` field (null | {...}).
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ── shared fixture ────────────────────────────────────────────────────────────

const QUEUE_ROW = {
  id: 42,
  filename: 'test.pdf',
  original_name: 'Passport scan.pdf',
  doc_type: null,
  customer_cid: null,
  customer_name: null,
  doc_number: null,
  dob: null,
  issue_date: null,
  expiry_date: null,
  issuing_authority: null,
  branch: 'Cairo',
  status: 'Pending',
  ocr_confidence: 55.2,
  uploaded_at: new Date().toISOString(),
  notes: null,
  lock: null,
};

const STATS = { low_confidence: 1, missing_type: 1, missing_owner: 0, missing_number: 0 };

const ANALYSIS = {
  document_id: 42,
  fields: {
    doc_type:          { value: null,     confidence: 0.0 },
    customer_name:     { value: 'Jane D', confidence: 0.45 },
    customer_cid:      { value: null,     confidence: 0.0 },
    doc_number:        { value: 'A99',    confidence: 0.85 },
    dob:               { value: null,     confidence: 0.0 },
    issue_date:        { value: null,     confidence: 0.0 },
    expiry_date:       { value: null,     confidence: 0.0 },
    issuing_authority: { value: null,     confidence: 0.0 },
    notes:             { value: null,     confidence: 0.0 },
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function mockStationRoutes(
  page: import('@playwright/test').Page,
  options: {
    claimStatus?: number;
    claimBody?: object;
    queueRows?: object[];
  } = {},
) {
  const { claimStatus = 200, claimBody = { ok: true, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), ttl_minutes: 15 }, queueRows = [QUEUE_ROW] } = options;

  await page.route('**/spa/api/indexing/stats', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }),
  );
  await page.route('**/spa/api/indexing?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queueRows) }),
  );
  await page.route('**/spa/api/indexing/42/claim', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: claimStatus, contentType: 'application/json', body: JSON.stringify(claimBody) });
    }
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.continue();
  });
  await page.route('**/spa/api/indexing/42/claim/release', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  await page.route('**/spa/api/indexing/42/analysis', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ANALYSIS) }),
  );
  await page.route('**/spa/api/indexing/42', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.continue();
  });
}

// ── happy-path (real stack) ───────────────────────────────────────────────────
// These tests require the dev server to be running (npm start / npm run dev).
// They are skipped automatically in environments where the server is absent.

test.describe('Indexing Station — real stack', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if server is not reachable — avoids false failures in offline envs.
    const resp = await page.request.get('/spa/api/auth/session-status').catch(() => null);
    if (!resp || !resp.ok()) test.skip();
    await login(page, 'admin', 'admin123');
    await page.goto('/indexing');
  });

  test('shows the four triage metrics', async ({ page }) => {
    await expect(page.getByText('Low OCR confidence', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing doc type',   { exact: true })).toBeVisible();
    await expect(page.getByText('Missing owner',      { exact: true })).toBeVisible();
    await expect(page.getByText('Missing doc number', { exact: true })).toBeVisible();
  });

  test('idle placeholder shown when no document selected', async ({ page }) => {
    await expect(page.getByText('Select a document to begin indexing')).toBeVisible();
  });

  test('low-conf filter checkbox is present and toggles', async ({ page }) => {
    const cb = page.getByTestId('only-low-conf');
    await expect(cb).toBeVisible();
    await cb.check();
    await expect(cb).toBeChecked();
    await cb.uncheck();
    await expect(cb).not.toBeChecked();
  });
});

// ── mocked specs ──────────────────────────────────────────────────────────────

test.describe('Indexing Station — mocked: claim + edit + save', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await mockStationRoutes(page);
    await page.goto('/indexing');
  });

  test('clicking a queue row opens the station panes', async ({ page }) => {
    // Queue row should be visible in the left pane.
    await expect(page.getByText('Passport scan.pdf')).toBeVisible();

    // Click the row to claim.
    await page.getByText('Passport scan.pdf').click();

    // PDF pane and field pane should appear.
    await expect(page.getByTestId('pdf-pane-scroll')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('field-row-doc_type')).toBeVisible();
  });

  test('field inputs are present after claim', async ({ page }) => {
    await page.getByText('Passport scan.pdf').click();
    await expect(page.getByTestId('indexing-input-doc_type')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('indexing-input-customer_name')).toBeVisible();
  });

  test('editing a field and saving via Save button', async ({ page }) => {
    await page.getByText('Passport scan.pdf').click();
    await page.getByTestId('indexing-input-doc_type').fill('Passport');
    await page.getByTestId('indexing-input-customer_name').fill('Jane Doe');
    await page.getByTestId('station-save').click();
    // Save is non-destructive — station stays open.
    await expect(page.getByTestId('station-save')).toBeVisible({ timeout: 5000 });
  });

  test('AI confidence badge visible on medium-confidence field', async ({ page }) => {
    await page.getByText('Passport scan.pdf').click();
    // customer_name has confidence 0.45 (45%) → medium band badge should appear
    await expect(page.locator('[data-testid="field-row-customer_name"] button[aria-label*="AI confidence"]'))
      .toBeVisible({ timeout: 8000 });
  });
});

test.describe('Indexing Station — mocked: lock conflict', () => {
  test('locked row shows lock badge, clicking does nothing visually', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const lockedRow = {
      ...QUEUE_ROW,
      lock: {
        user_name:  'Sarah K.',
        user_id:    99,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    };

    await mockStationRoutes(page, { queueRows: [lockedRow] });
    await page.goto('/indexing');

    // Lock badge displayed.
    await expect(page.getByText(/Locked by Sarah K\./)).toBeVisible();
    // Station does NOT open (idle placeholder remains).
    await page.getByText('Passport scan.pdf').click();
    await expect(page.getByText('Select a document to begin indexing')).toBeVisible();
  });

  test('claim 409 gracefully handled — station does not open', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await mockStationRoutes(page, {
      claimStatus: 409,
      claimBody: { error: 'locked', lock: { user_name: 'Bob', expires_at: new Date(Date.now() + 5 * 60_000).toISOString() } },
    });
    await page.goto('/indexing');
    await page.getByText('Passport scan.pdf').click();
    // Station should remain in idle state.
    await expect(page.getByText('Select a document to begin indexing')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Indexing Station — mocked: keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await mockStationRoutes(page);
    await page.goto('/indexing');
    await page.getByText('Passport scan.pdf').click();
    await expect(page.getByTestId('indexing-input-doc_type')).toBeVisible({ timeout: 8000 });
  });

  test('? opens shortcut help overlay', async ({ page }) => {
    // Click outside any input first so J/K bindings are active.
    await page.getByTestId('pdf-pane-scroll').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
  });

  test('Esc releases lock and closes station', async ({ page }) => {
    await page.getByTestId('pdf-pane-scroll').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Escape');
    await expect(page.getByText('Select a document to begin indexing')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Indexing Station — mocked: save error', () => {
  test('shows error banner on save failure', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await mockStationRoutes(page);
    // Override PATCH to fail.
    await page.route('**/spa/api/indexing/42', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
      }
      return route.continue();
    });

    await page.goto('/indexing');
    await page.getByText('Passport scan.pdf').click();
    await expect(page.getByTestId('indexing-input-doc_type')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('indexing-input-doc_type').fill('Passport');
    await page.getByTestId('station-save').click();
    await expect(page.getByTestId('indexing-error')).toBeVisible({ timeout: 5000 });
  });
});
