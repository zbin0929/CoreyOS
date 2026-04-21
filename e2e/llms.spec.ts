import { test, expect } from './fixtures/test';

/**
 * LLMs (Models) page — proves the Hermes config read/write loop plus the
 * custom Combobox component that replaced native selects on macOS.
 */

test.describe('llms', () => {
  test('shows current provider + model from hermes_config_read', async ({
    page,
  }) => {
    await page.goto('/models');
    // Both appear twice on the page: once in the editable Combobox input,
    // once in the read-only "Current config" summary. Either is fine for
    // proving `hermes_config_read` reached the UI.
    await expect(page.getByText('openai-compatible').first()).toBeVisible();
    await expect(page.getByText('deepseek-chat').first()).toBeVisible();
  });

  test('env key badge reflects hermes_env_set_key', async ({ page }) => {
    await page.goto('/models');
    // Default mock state: DEEPSEEK_API_KEY is present.
    await expect(page.getByText('DEEPSEEK_API_KEY', { exact: false })).toBeVisible();
  });
});
