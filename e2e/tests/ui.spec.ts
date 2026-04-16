import { test, expect } from "@playwright/test";

test.describe("Web UI", () => {
  test("dashboard loads with KPIs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".page-title")).toBeVisible();
    await expect(page.locator("#kpiRow .kpi")).toHaveCount(4, { timeout: 10_000 });
  });

  test("sidebar navigation switches screens", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Capture|الالتقاط/).first().click();
    await expect(page.locator("#screen-capture.active")).toBeVisible();
    await page.getByText(/Workflow|سير العمل/).first().click();
    await expect(page.locator("#screen-workflow.active")).toBeVisible();
  });

  test("Arabic RTL toggles direction", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "عربي" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("quick upload wires through API", async ({ page }) => {
    await page.goto("/");
    page.once("dialog", (d) => d.accept());
    await page.setInputFiles("#uploadInput", {
      name: "ui-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("e2e content"),
    });
  });
});
