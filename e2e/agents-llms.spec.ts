import { test, expect } from './fixtures/test';

/**
 * T8 — end-to-end coverage of the agent/model split:
 *
 *   1. /agents loads and renders the list (empty state → wizard).
 *   2. /models renders the LLM profile list with the empty state,
 *      then a "New LLM" row we fill + save round-trips through the
 *      mock IPC and shows up as a row.
 *   3. Agent wizard happy path saves BOTH a profile and an agent.
 *      We reach into the mock state to verify both collections got
 *      the new row.
 *
 * Screenshots land under e2e/screenshots/agents-llms/ so the
 * maintainer can eyeball the new pages without a local build.
 */

test.describe('T8 · agents + llms', () => {
  test('/agents renders + opens wizard', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('hermes-instances-list')).toBeVisible();
    await expect(page.getByTestId('hermes-instances-quick-add')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/agents-empty.png',
      fullPage: true,
    });

    await page.getByTestId('hermes-instances-quick-add').click();
    await expect(page.getByTestId('agent-wizard-providers')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/wizard-step1.png',
      fullPage: true,
    });
  });

  test('/models lets user create an LLM profile', async ({ page }) => {
    await page.goto('/models');

    // Empty state first.
    await expect(page.getByTestId('llm-profiles-empty')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/models-empty.png',
      fullPage: true,
    });

    await page.getByTestId('llm-profiles-add').click();
    const form = page.getByTestId('llm-profile-form-new');
    await expect(form).toBeVisible();

    // Fill in the fields.
    await form.locator('input').nth(0).fill('openai-gpt4o');
    await form.locator('input').nth(1).fill('OpenAI GPT-4o');
    await form.locator('input').nth(2).fill('openai');
    await form.locator('input').nth(3).fill('gpt-4o');
    await form.locator('input').nth(4).fill('https://api.openai.com/v1');

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/models-new-form.png',
      fullPage: true,
    });

    await page.getByTestId('llm-profile-save-new').click();

    // Row should appear + form should close.
    await expect(page.getByTestId('llm-profile-row-openai-gpt4o')).toBeVisible();
    await expect(form).toBeHidden();

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/models-populated.png',
      fullPage: true,
    });
  });

  test('wizard save creates both a profile and an agent', async ({ page }) => {
    await page.goto('/agents');
    await page.getByTestId('hermes-instances-quick-add').click();
    await page.getByTestId('agent-wizard-provider-deepseek').click();
    await expect(page.getByTestId('agent-wizard-details')).toBeVisible();

    // No existing profiles in the default fixture, so the picker is
    // hidden and we go straight to "fresh" save.
    await expect(page.getByTestId('agent-wizard-profile-picker')).toHaveCount(0);

    await page.getByTestId('agent-wizard-save').click();
    await expect(page.getByTestId('agent-wizard')).toBeHidden();

    // Reach into the mock state to assert both collections got rows.
    const state = await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: {
              hermesInstances: Array<Record<string, unknown>>;
              llmProfiles: Array<Record<string, unknown>>;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      return {
        instances: mock.state.hermesInstances,
        profiles: mock.state.llmProfiles,
      };
    });

    expect(state.profiles.length).toBeGreaterThan(0);
    expect(state.instances.length).toBeGreaterThan(0);
    expect(state.instances[0]).toMatchObject({ llm_profile_id: state.profiles[0]!.id });
  });

  test('wizard shows profile picker when a matching profile exists', async ({ page }) => {
    // Seed the mock with an openai profile before the page loads so
    // the wizard's llm_profile_list call sees it.
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: {
            state: { llmProfiles: Array<Record<string, unknown>> };
          };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.llmProfiles.push({
        id: 'openai-fast',
        label: 'OpenAI fast',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        api_key_env: 'OPENAI_API_KEY',
      });
    });

    await page.goto('/agents');
    await page.getByTestId('hermes-instances-quick-add').click();
    await page.getByTestId('agent-wizard-provider-openai').click();

    // Picker shows up, listing the seeded profile.
    await expect(page.getByTestId('agent-wizard-profile-picker')).toBeVisible();
    const select = page.getByTestId('agent-wizard-profile-select');
    await select.selectOption('openai-fast');

    // Model picker collapses into the profile summary.
    await expect(page.getByTestId('agent-wizard-profile-summary')).toBeVisible();
    await expect(page.getByTestId('agent-wizard-model')).toHaveCount(0);

    await page.screenshot({
      path: 'e2e/screenshots/agents-llms/wizard-linked.png',
      fullPage: true,
    });
  });
});
