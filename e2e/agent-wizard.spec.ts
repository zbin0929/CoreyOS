import { test, expect } from './fixtures/test';

/**
 * Smoke test + screenshot capture for the Agent wizard.
 */
test.describe('agent wizard', () => {
  test('provider picker → details → save', async ({ page }) => {
    // T8 — HermesInstancesSection was moved from /settings to its
    // own top-level /agents route. The wizard button lives there now.
    await page.goto('/agents');
    await page.waitForTimeout(500);

    const quickAdd = page.getByTestId('hermes-instances-quick-add');
    await quickAdd.scrollIntoViewIfNeeded();
    await expect(quickAdd).toBeVisible();
    await quickAdd.click();

    // Step 1 — provider grid.
    const providers = page.getByTestId('agent-wizard-providers');
    await expect(providers).toBeVisible();
    await expect(page.getByTestId('agent-wizard-provider-openai')).toBeVisible();
    await expect(page.getByTestId('agent-wizard-provider-anthropic')).toBeVisible();
    await expect(page.getByTestId('agent-wizard-provider-ollama')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/wizard/step-1-providers.png',
      fullPage: true,
    });

    // Pick DeepSeek → Step 2.
    await page.getByTestId('agent-wizard-provider-deepseek').click();
    await expect(page.getByTestId('agent-wizard-details')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/wizard/step-2-details.png',
      fullPage: true,
    });

    // The id field should be pre-filled.
    const idInput = page.getByTestId('agent-wizard-id');
    const idVal = await idInput.inputValue();
    expect(idVal).toMatch(/^deepseek/);

    // Save should invoke hermes_instance_upsert.
    await page.getByTestId('agent-wizard-save').click();

    // Wizard closes → new row appears in the list.
    await expect(page.getByTestId('agent-wizard')).toBeHidden();
  });
});
