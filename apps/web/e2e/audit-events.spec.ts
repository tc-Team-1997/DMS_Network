/**
 * Playwright E2E spec — SPA-emitted audit events.
 *
 * Covers:
 *   1. Happy path: allowed action is written to audit_log and readable back.
 *   2. Allow-list enforcement: disallowed action returns 400.
 *   3. Body validation: malformed body returns 400 with invalid_body error.
 *   4. Auth gate: unauthenticated request returns 401/403.
 *
 * Requires: Node dev server running (npm start from repo root, port 3000).
 * Credentials: admin/admin123 (Doc Admin — has audit_log read access).
 *
 * NOTE: Uses page.request (not the request fixture) for API calls that require
 * the browser session — page.request shares the browser context's cookie jar.
 *
 * The read-back in test 1 uses GET /spa/api/audit/events which requires
 * the 'audit_log:read' permission (Doc Admin role has it via requireNamespacePermJson).
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('SPA can emit audit events through /spa/api/audit/events', async ({ page }) => {
  await login(page, 'admin', 'admin123');

  // Emit a client-side pii_reveal event using page.request (shares session cookies).
  const r = await page.request.post('/spa/api/audit/events', {
    data: {
      action: 'pii_reveal',
      entity_type: 'customer',
      entity_id: 'cust-e2e-001',
      detail: { field: 'national_id' },
    },
  });
  expect(r.ok()).toBe(true);
  const body = await r.json();
  expect(body).toEqual({ ok: true });

  // Read it back via the audit log list endpoint (requires audit_log:read).
  // Path: GET /spa/api/audit/events (the existing Wave C list endpoint).
  // Filter by action=pii_reveal; entity_id is inside the row for matching.
  const list = await page.request.get('/spa/api/audit/events?per_page=20&action=pii_reveal');
  expect(list.ok()).toBe(true);
  const listBody = await list.json();

  // Response shape: { total, page, per_page, events: [...] }
  const row = listBody.events.find((e: any) => e.entity_id === 'cust-e2e-001');
  expect(row).toBeTruthy();
  expect(row.action).toBe('pii_reveal');
  expect(row.entity_type).toBe('customer');
  // policy_decision must be persisted and parseable.
  expect(row.policy_decision).toBeTruthy();
  expect(JSON.parse(row.policy_decision)).toMatchObject({ opa_allow: true });
});

test('SPA audit endpoint rejects untrusted action prefixes', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  const r = await page.request.post('/spa/api/audit/events', {
    data: { action: 'workflow.approve', entity_type: 'doc', entity_id: '1' },
  });
  expect(r.status()).toBe(400);
  const body = await r.json();
  expect(body.error).toBe('action_not_allowed_from_spa');
});

test('SPA audit endpoint rejects malformed body', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  // Body with no 'action' field is invalid.
  const r = await page.request.post('/spa/api/audit/events', { data: { foo: 'bar' } });
  expect(r.status()).toBe(400);
  const body = await r.json();
  expect(body.error).toBe('invalid_body');
});

test('SPA audit endpoint rejects unauthenticated requests', async ({ page }) => {
  // Do NOT log in — no session cookie.
  // Hit the API directly from a fresh page context with no session.
  const r = await page.request.post('/spa/api/audit/events', {
    data: { action: 'pii_reveal' },
  });
  expect([401, 403]).toContain(r.status());
});
