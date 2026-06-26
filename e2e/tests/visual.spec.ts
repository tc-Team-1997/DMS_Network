import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Visual regression for the enterprise (navy) redesign.
 *
 * The redesign is intentional, so baselines are captured fresh against the
 * current React app. To keep snapshots deterministic we:
 *   • use a fixed 1280×800 viewport,
 *   • force a single font stack,
 *   • disable all animations/transitions and force full opacity,
 *   • mask dynamic regions: charts (Math.random-seeded), date inputs, the
 *     sidebar version/build footer, and KPI values (live counts).
 */

const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `
      * { font-family: 'Arial', sans-serif !important; }
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `;
    document.documentElement.appendChild(style);
  });
});

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await page.locator(".kpi-card").first().waitFor({ timeout: 12_000 });
}

/** Regions whose content is non-deterministic across runs. */
function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator(".recharts-responsive-container"),
    page.locator('input[type="date"]'),
    page.locator(".sidebar-footer"),
    page.locator(".kpi-card .kv"),
  ];
}

const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "dashboard",  path: "/dashboard",  ready: ".kpi-card" },
  { name: "capture",    path: "/capture",    ready: ".tabs" },
  { name: "search",     path: "/search",     ready: "input" },
  { name: "repository", path: "/repository", ready: ".card, table" },
  { name: "ai-engine",  path: "/ai-engine",  ready: "textarea" },
];

test.describe("Visual regression (navy redesign)", () => {
  test("login screen", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Sanity: no error banner / blank screen.
    await expect(page.locator("#username")).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("login.png", {
      maxDiffPixelRatio: 0.01,
      // The left panel carousel rotates — mask it.
      mask: [page.locator(".carousel-slide"), page.locator('[role="tablist"]')],
    });
  });

  for (const screen of SCREENS) {
    test(`${screen.name} screen`, async ({ page }) => {
      await loginAsAdmin(page);
      if (screen.path !== "/dashboard") {
        await page.goto(screen.path);
      }
      // Confirm the screen actually rendered before baselining.
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 12_000 });
      await expect(page.locator("nav.sidebar")).toBeVisible();
      // No crash markers.
      await expect(page.locator("body")).not.toContainText("TypeError");
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`${screen.name}.png`, {
        maxDiffPixelRatio: 0.01,
        mask: dynamicMasks(page),
      });
    });
  }
});
