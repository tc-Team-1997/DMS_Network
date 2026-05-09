import { defineConfig, devices } from '@playwright/test';

// Dev: SPA served by Vite (port 5175 when 5174 is taken); CI: built SPA on Node.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5175';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CI ? {
    command: 'node /Users/cosmicintelligence/Documents/DMS_Network/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  } : undefined,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
