import { defineConfig, devices } from '@playwright/test';

// Playwright config for Caduceus E2E.
//
// We test the frontend against Vite's dev server (http://localhost:5173)
// rather than the full Tauri webview: faster iteration, no code-sign dance
// in CI, and all user-facing UI logic still exercised.
//
// The Tauri IPC layer is stubbed in the page via e2e/fixtures/tauri-mock.ts.
// Rust-side IPC contracts are covered by cargo test on the backend.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 15_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // System Chrome. Skips the ~170 MB Chromium download; falls back to
    // whatever the host has installed as Google Chrome.
    channel: 'chrome',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
