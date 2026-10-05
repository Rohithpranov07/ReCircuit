import { defineConfig, devices } from '@playwright/test';

// The specs drive the running stack (docker compose up) seeded with `python -m seed --profile small --seed 42`.
export default defineConfig({
  testDir: '.',
  testMatch: /f\d\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
