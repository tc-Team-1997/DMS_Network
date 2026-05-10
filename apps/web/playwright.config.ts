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
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        // Pixel 7 viewport: 412×915 CSS pixels
      },
      // Mobile specs: run mobile-ux.spec.ts plus the operational specs
      testMatch: [
        '**/mobile-ux.spec.ts',
        '**/dashboard.spec.ts',
        '**/capture.spec.ts',
        '**/capture-v2.spec.ts',
        '**/repository.spec.ts',
        '**/viewer-v2.spec.ts',
        '**/workflows.spec.ts',
      ],
    },
  ],
});
