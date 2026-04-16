import { defineConfig, devices } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:8000";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: {
      "X-API-Key": process.env.E2E_API_KEY || "dev-key-change-me",
    },
  },
  projects: [
    { name: "chromium-ltr", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-rtl",
      use: { ...devices["Desktop Chrome"], locale: "ar-EG" } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"] } },
    { name: "mobile",   use: { ...devices["Pixel 7"] } },
  ],
});
