import { test, expect } from "@playwright/test";

// Visual regression: compare full-page screenshots against committed baselines.
// First run on a branch updates the snapshots; subsequent runs diff pixel-by-pixel
// with a conservative tolerance (0.2% mismatch). Fonts are non-deterministic — so
// we inject a style override to force a single web-safe stack before snapshotting.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `
      * { font-family: 'Arial', sans-serif !important; }
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
    `;
    document.documentElement.appendChild(style);
  });
});

async function stabilize(page) {
  // Wait for KPIs + mock a stable timestamp to avoid snapshot churn.
  await page.waitForSelector("#kpiRow .kpi", { timeout: 10_000 });
  await page.addStyleTag({ content: ".page-sub{visibility:hidden}" });
  await page.waitForTimeout(150);
}

const SCREENS = ["dashboard", "capture", "indexing", "ai", "repository",
                 "search", "workflow", "integration"];

for (const screen of SCREENS) {
  test(`visual — ${screen} LTR`, async ({ page }) => {
    await page.goto("/");
    if (screen !== "dashboard") {
      await page.evaluate((s) => (window as any).showScreen(s), screen);
    }
    await stabilize(page);
    await expect(page).toHaveScreenshot(`${screen}-ltr.png`, { maxDiffPixelRatio: 0.002 });
  });

  test(`visual — ${screen} RTL`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "عربي" }).click();
    if (screen !== "dashboard") {
      await page.evaluate((s) => (window as any).showScreen(s), screen);
    }
    await stabilize(page);
    await expect(page).toHaveScreenshot(`${screen}-rtl.png`, { maxDiffPixelRatio: 0.003 });
  });
}

test("visual — guided tour overlay", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(200);
  await page.evaluate(() => (window as any).NBE_Tour.start("dashboard"));
  await page.waitForSelector(".tour-pop");
  await expect(page).toHaveScreenshot("guided-tour.png", { maxDiffPixelRatio: 0.003 });
});
