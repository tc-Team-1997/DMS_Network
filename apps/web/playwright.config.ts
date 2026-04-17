import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
