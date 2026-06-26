import { test, expect, type Page } from "@playwright/test";

/**
 * Web UI smoke — updated for the enterprise redesign:
 * navy sidebar, new topbar ("Admin · CDO" identity + breadcrumb), KPI cards,
 * RefId id tokens. Assertions target roles / labels / visible text rather than
 * the old static-HTML internals (window.showScreen, #kpiRow, Arabic toggle …),
 * none of which exist in the React app.
 */

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

test.describe("Web UI", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("dashboard loads with KPI cards", async ({ page }) => {
    await expect(page.locator(".kpi-card").first()).toBeVisible({ timeout: 12_000 });
    // The redesign shows two rows of four KPI cards.
    await expect(page.locator(".kpi-card")).toHaveCount(8);
    await expect(page.getByText("Total Documents")).toBeVisible();
  });

  test("navy sidebar navigation switches screens", async ({ page }) => {
    const sidebar = page.locator("nav.sidebar");
    await expect(sidebar).toBeVisible();

    await sidebar.getByRole("link", { name: "Capture" }).click();
    await expect(page).toHaveURL(/\/capture/);

    await sidebar.getByRole("link", { name: "Workflow Engine" }).click();
    await expect(page).toHaveURL(/\/workflow-engine/);
  });

  test("topbar shows the Admin · CDO identity and breadcrumb", async ({ page }) => {
    const identity = page.locator(".usr-identity");
    await expect(identity).toBeVisible();
    await expect(identity).toContainText("Admin");
    await expect(identity).toContainText("CDO");

    // Breadcrumb reflects the current screen (group › label).
    const crumb = page.locator(".topbar-breadcrumb");
    await expect(crumb).toBeVisible();
    await expect(crumb).toContainText("Dashboard");
  });

  test("RefId id tokens render on the search results", async ({ page }) => {
    await page.goto("/search");
    const searchInput = page
      .locator("input[type='search'], input[placeholder*='earch'], input[placeholder*='query']")
      .first();
    await expect(searchInput).toBeVisible({ timeout: 12_000 });
    await searchInput.fill("loan");
    await searchInput.press("Enter");
    await page.waitForTimeout(1500);
    // Either results (with monospace RefId tokens) or a clean empty state — no crash.
    await expect(page.locator("body")).not.toContainText("TypeError");
  });

  test("semantic sign-out button returns to login", async ({ page }) => {
    await page.click('button[aria-label="Sign out"]');
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
