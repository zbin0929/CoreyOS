import { test, expect } from './fixtures/test';

/**
 * Config changelog page — proves the T2.1 journal surfaces in the UI and
 * that revert round-trips through the mock's hermes_config_write_model →
 * changelog_list → changelog_revert chain.
 */

test.describe('logs (changelog)', () => {
  test('empty state when no journal entries', async ({ page }) => {
    await page.goto('/logs');
    // T2.6 made /logs a tabbed surface with Agent as the default. Click
    // the Changelog tab before asserting the existing empty-state copy.
    await page.getByTestId('logs-tab-changelog').click();
    // Seeded fixture has `changelog: []`.
    await expect(page.getByText(/No changes yet|暂无改动/)).toBeVisible();
  });

  test('a write_model edit shows up in the journal and can be reverted', async ({
    page,
  }) => {
    // Drive a real write_model from the Models page so the mock populates
    // its changelog identically to how the Rust journal would. T8 moved
    // the legacy config.yaml editor behind a <details> disclosure — open
    // it before hunting for the model input.
    await page.goto('/models');
    await page.getByTestId('models-legacy-advanced').click();
    const modelInput = page.getByPlaceholder(/deepseek-reasoner|deepseek-chat/).first();
    await modelInput.fill('deepseek-reasoner');
    // Press Enter to commit + close the Combobox dropdown that otherwise
    // intercepts clicks on the Save button.
    await modelInput.press('Enter');
    await page.getByRole('button', { name: /Save to config/i }).click();
    // Wait for the "saved" flash so we know the journal entry has been appended.
    await expect(page.getByText(/Saved|已保存/)).toBeVisible({ timeout: 4000 });

    // Use client-side nav (sidebar link) instead of page.goto so the mock's
    // in-memory journal survives — a full reload would re-run addInitScript
    // and wipe state.changelog.
    await page.getByRole('link', { name: /Logs|日志/ }).click();
    // Active tab defaults to Agent; switch to Changelog to see the entry.
    await page.getByTestId('logs-tab-changelog').click();
    await expect(page.getByText(/deepseek-reasoner/).first()).toBeVisible();

    // Click the single Revert button on the row. The row flips to "Reverted"
    // and a new entry prepends describing the revert itself.
    await page.getByRole('button', { name: /^Revert$|^撤销$/ }).first().click();
    await expect(page.getByText(/Reverted|已撤销/).first()).toBeVisible({
      timeout: 4000,
    });

    // Head back to Models (client-side) and confirm the model reverted.
    // The <details> re-collapses across the client nav — reopen before
    // asserting on the legacy form's content.
    await page.getByRole('link', { name: /Language models|LLMs|模型|Models/ }).first().click();
    await page.getByTestId('models-legacy-advanced').click();
    await expect(page.getByText('deepseek-chat').first()).toBeVisible();
  });
});
