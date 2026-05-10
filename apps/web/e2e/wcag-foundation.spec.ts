/**
 * WCAG Level-A/AA foundation spec using @axe-core/playwright.
 * Asserts zero critical or serious violations on 5 high-traffic routes.
 *
 * Run: npx playwright test wcag-foundation.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

const ROUTES = [
  '/',
  '/workflows',
  '/repository',
  '/search',
  '/compliance',
];

for (const route of ROUTES) {
  test(`axe-core: ${route} has zero critical or serious violations`, async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto(route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blockers = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (blockers.length) {
      const summary = blockers.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
      }));
      console.error(JSON.stringify(summary, null, 2));
    }

    expect(blockers).toHaveLength(0);
  });
}
