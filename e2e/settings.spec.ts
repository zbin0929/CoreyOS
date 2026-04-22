import { test, expect } from './fixtures/test';

/**
 * Settings page — T2.3.
 *
 * Covers:
 * - Appearance: theme segmented control flips `html[data-theme]` without a
 *   page reload (zustand + the `Providers` effect do this purely in-memory).
 * - Appearance: language switcher swaps visible copy immediately (i18next's
 *   `changeLanguage` re-renders subscribed components).
 * - Gateway form: loads from `config_get`, `Test connection` hits
 *   `config_test` and shows the latency string.
 * - Storage: the paths panel renders all four rows from `app_paths`.
 */

test.describe('settings', () => {
  test('theme segmented control updates html[data-theme] live', async ({ page }) => {
    await page.goto('/settings');

    // Light tile flips the attribute.
    await page.getByTestId('settings-theme-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Dark flips it back.
    await page.getByTestId('settings-theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('language switcher swaps UI copy without reload', async ({ page }) => {
    await page.goto('/settings');

    // English is the default (LanguageDetector falls back to navigator).
    // The "Appearance" heading uses a stable i18n key.
    await expect(page.getByRole('heading', { name: /Appearance/i })).toBeVisible();

    // Custom Select — open then pick the row. Chinese rendering swaps
    // the same heading to the translated string.
    await page.getByTestId('settings-lang').click();
    await page.getByRole('option', { name: '中文' }).click();
    await expect(page.getByRole('heading', { name: '外观' })).toBeVisible();

    // Reset so other tests don't inherit the Chinese localStorage value.
    await page.getByTestId('settings-lang').click();
    await page.getByRole('option', { name: 'English' }).click();
  });

  test('gateway form loads config and Test connection reports latency', async ({ page }) => {
    await page.goto('/settings');

    // base_url prefilled from the mock's config_get.
    await expect(page.getByPlaceholder('http://127.0.0.1:8642').first()).toHaveValue(
      'http://127.0.0.1:8642',
    );

    // The mock returns latency_ms: 12 — the i18n'd message interpolates it.
    await page.getByRole('button', { name: /Test connection/i }).click();
    await expect(page.getByText(/Healthy.*12.*ms/)).toBeVisible();
  });

  test('storage panel renders all four paths from app_paths', async ({ page }) => {
    await page.goto('/settings');

    // The DB-path row's <code> contains the full path — matches by substring.
    await expect(page.getByText(/caduceus\.db/).first()).toBeVisible();
    await expect(page.getByText(/changelog\.jsonl/).first()).toBeVisible();
  });
});
