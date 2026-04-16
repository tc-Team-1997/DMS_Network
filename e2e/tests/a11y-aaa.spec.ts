import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("WCAG 2.2 AAA (opt-in mode)", () => {
  test("toggling enables AAA mode attribute", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#kpiRow .kpi");
    await page.getByRole("button", { name: /Toggle high-contrast AAA mode/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-a11y", "aaa");
  });

  test("AAA mode passes axe at AAA tags", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#kpiRow .kpi");
    await page.getByRole("button", { name: /Toggle high-contrast AAA mode/i }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aaa", "wcag21aaa", "wcag22aaa"])
      .analyze();
    const blocking = results.violations.filter(v => ["serious", "critical"].includes(v.impact || ""));
    if (blocking.length) {
      console.log(JSON.stringify(blocking.map(v => ({ id: v.id, impact: v.impact, help: v.help })), null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test("hit-target size ≥ 44x44 for primary controls", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Toggle high-contrast AAA mode/i }).click();
    const btn = page.locator(".upload-btn");
    const box = await btn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  });
});
