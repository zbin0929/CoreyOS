import { test, expect } from './fixtures/test';

/**
 * T2.6 — tail of Hermes's rolling log files. Covers the Agent / Gateway /
 * Error tabs that ship alongside the existing Changelog tab at /logs.
 *
 * The mock returns canned lines from `state.hermesLogs`; these tests don't
 * exercise the real `hermes_log_tail` IPC (Rust-side unit tests do that —
 * see `src-tauri/src/hermes_logs.rs::tests`).
 */

test.describe('hermes logs', () => {
  test('Agent tab renders tailed lines and is the default', async ({ page }) => {
    await page.goto('/logs');

    // Agent is the default tab — its lines render without clicking anything.
    await expect(page.getByText(/agent boot/).first()).toBeVisible();
    await expect(page.getByText(/rate limiter near cap/).first()).toBeVisible();

    // Meta line reports 4 of 4.
    await expect(page.getByText(/Showing 4 of 4 lines|显示 4 \/ 4 行/)).toBeVisible();
  });

  test('filter narrows the visible lines without refetching', async ({ page }) => {
    await page.goto('/logs');

    await page.getByTestId('hermes-log-filter-agent').fill('rate limiter');

    // The ERROR line and INFO boot line disappear; only the WARN match stays.
    await expect(page.getByText(/rate limiter near cap/).first()).toBeVisible();
    await expect(page.getByText(/agent boot/)).toHaveCount(0);
    await expect(page.getByText(/Showing 1 of 4 lines|显示 1 \/ 4 行/)).toBeVisible();
  });

  test('Error tab shows missing-file empty state with path', async ({ page }) => {
    await page.goto('/logs');
    await page.getByTestId('logs-tab-error').click();

    await expect(page.getByText(/No log file yet|暂无日志文件/)).toBeVisible();
    // The resolved path is surfaced so users can verify their Hermes install.
    await expect(page.getByText(/\/Users\/test\/\.hermes\/logs\/error\.log/)).toBeVisible();
  });

  test('Gateway tab swaps content and tab aria-selected', async ({ page }) => {
    await page.goto('/logs');

    await page.getByTestId('logs-tab-gateway').click();
    await expect(page.getByTestId('logs-tab-gateway')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/listening on 127\.0\.0\.1:8642/).first()).toBeVisible();
  });
});
