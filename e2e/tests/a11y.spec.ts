import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("WCAG 2.2 AA", () => {
  test("dashboard has no serious/critical violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#kpiRow .kpi", { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const blocking = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    if (blocking.length) {
      console.log(JSON.stringify(blocking.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })), null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test("skip link appears on keyboard focus", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.locator(".skip-link");
    await expect(skip).toBeFocused();
  });

  test("keyboard navigation reaches main content", async ({ page }) => {
    await page.goto("/");
    // Tab through topbar into sidebar and confirm at least one nav-item is focusable.
    for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "INPUT", "A", "MAIN"]).toContain(focused);
  });

  test("RTL mode passes axe too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "عربي" }).click();
    await page.waitForTimeout(200);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aa"]).analyze();
    const blocking = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(blocking).toEqual([]);
  });
});
