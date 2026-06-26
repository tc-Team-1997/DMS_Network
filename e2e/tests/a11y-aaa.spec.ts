import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * WCAG 2.2 AAA — selected enhanced checks the redesign should still honour.
 * The old static-HTML "Toggle high-contrast AAA mode" button and `.upload-btn`
 * no longer exist, so we assert AAA-grade properties on the real React app:
 *   • enhanced contrast (7:1) on the high-stakes login screen,
 *   • 24×24 minimum hit targets on the primary topbar controls.
 */

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await page.locator(".kpi-card").first().waitFor({ timeout: 12_000 });
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;opacity:1!important}`,
  });
  await page.waitForTimeout(300);
}

test.describe("WCAG 2.2 AAA", () => {
  test("login screen meets enhanced (7:1) contrast", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.addStyleTag({
      content: `*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;opacity:1!important}`,
    });
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast-enhanced"])
      .analyze();
    const blocking = results.violations.filter(v => ["serious", "critical"].includes(v.impact || ""));
    if (blocking.length) {
      console.log(JSON.stringify(blocking.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.map(n => n.html.slice(0, 90)) })), null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test("primary sign-out control meets the 24×24 minimum hit target", async ({ page }) => {
    await loginAsAdmin(page);
    const btn = page.locator('button[aria-label="Sign out"]');
    const box = await btn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  });

  test("carousel highlight dots meet the 24×24 minimum hit target", async ({ page }) => {
    await page.goto("/login");
    const dot = page.getByRole("tab", { name: /highlight 1/i });
    await expect(dot).toBeVisible();
    const box = await dot.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  });
});
