/**
 * Plan 3 (Wave-E1) Task #4 follow-up — axe-core sweep on /admin/audit.
 *
 * Validates that the Plan-3 surface added in commit 384795e (promoted
 * green chain banner, three new diff-drawer sections, /chain/verify
 * endpoint render) passes WCAG 2.1 A + AA at axe-core's "critical" and
 * "serious" impact levels.
 *
 * Mirror of wcag-foundation.spec.ts, scoped to:
 *   1. /admin/audit (page-load with the green banner above the tabs)
 *   2. /admin/audit with the diff drawer open (focus trap, dialog labelling,
 *      `<mark>` highlight contrast, chain-segment monospace contrast).
 *
 * The drawer pass is the riskier one — Wave-D postmortems flagged dialog
 * focus-trap regressions on three earlier slices.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

test('axe-core: /admin/audit page-load has zero critical or serious violations', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');
  await page.waitForLoadState('networkidle');

  // Wait for the chain banner to materialise — the green-state header is the
  // dominant new surface Plan 3 Task #4 added.
  await expect(page.getByTestId('audit-chain-banner')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blockers = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  if (blockers.length) {
    console.error(
      'axe-core blockers on /admin/audit page-load:\n' +
      JSON.stringify(
        blockers.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        null,
        2,
      ),
    );
  }

  expect(blockers).toHaveLength(0);
});

test('axe-core: /admin/audit with diff drawer open has zero critical or serious violations', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');
  await page.waitForLoadState('networkidle');

  // Open the diff drawer by clicking the first events-tab row.
  const eventsTab = page.getByTestId('events-tab');
  await expect(eventsTab).toBeVisible();
  const firstRow = eventsTab.locator('tr').filter({ has: page.locator('td') }).first();
  const rowCount = await firstRow.count();
  test.skip(rowCount === 0, 'no seeded audit rows; cannot open the diff drawer');
  await firstRow.click();

  const drawer = page.getByTestId('audit-diff-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('audit-policy-decision-json')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blockers = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  if (blockers.length) {
    console.error(
      'axe-core blockers on /admin/audit with diff drawer open:\n' +
      JSON.stringify(
        blockers.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        null,
        2,
      ),
    );
  }

  expect(blockers).toHaveLength(0);
});
