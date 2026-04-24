import { test, expect } from './fixtures/test';

/**
 * LLMs (Models) page — proves the Hermes config read/write loop plus the
 * custom Combobox component that replaced native selects on macOS.
 */

test.describe('llms', () => {
  /**
   * The legacy single-model config.yaml form is now collapsed under a
   * `<details>` disclosure (T8 feedback 1a — LLM profiles are the
   * primary affordance; this is Hermes-gateway-default-model only).
   * Every test below needs to expand it before poking the Combobox
   * or Discover button.
   */
  async function expandLegacy(page: import('@playwright/test').Page) {
    await page.getByTestId('models-legacy-advanced').click();
  }

  test('shows current provider + model from hermes_config_read', async ({
    page,
  }) => {
    await page.goto('/models');
    await expandLegacy(page);
    // Both appear twice on the page: once in the editable Combobox input,
    // once in the read-only "Current config" summary. Either is fine for
    // proving `hermes_config_read` reached the UI.
    await expect(page.getByText('openai-compatible').first()).toBeVisible();
    await expect(page.getByText('deepseek-chat').first()).toBeVisible();
  });

  test('env key badge reflects hermes_env_set_key', async ({ page }) => {
    await page.goto('/models');
    await expandLegacy(page);
    // Default mock state: DEEPSEEK_API_KEY is present.
    await expect(page.getByText('DEEPSEEK_API_KEY', { exact: false })).toBeVisible();
  });

  test('Discover populates model suggestions from probe', async ({ page }) => {
    await page.goto('/models');
    await expandLegacy(page);
    await page.getByRole('button', { name: /Discover/i }).click();
    // Two elements match: the emerald success line under the button, and the
    // Combobox hint. Either being visible proves the probe round-tripped;
    // `.first()` keeps the assertion strict-mode compliant.
    await expect(page.getByText(/3 models from/i).first()).toBeVisible();
    // Normalized endpoint shown in the status line (mock echoes the
    // base_url with /v1/models appended).
    await expect(page.getByText('/v1/models').first()).toBeVisible();
  });
});
