import { test, expect } from './fixtures/test';

test.describe('llms', () => {
  test('shows provider + model from profile list', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __CADUCEUS_MOCK__?: { state: { llmProfiles: unknown[] } } }).__CADUCEUS_MOCK__?.state;
      if (s) {
        s.llmProfiles = [
          {
            id: 'test-profile-1',
            label: 'Test Profile',
            provider: 'openai-compatible',
            base_url: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            api_key_env: 'DEEPSEEK_API_KEY',
          },
        ];
      }
    });
    await page.goto('/models');
    await expect(page.getByTestId('llm-profiles-section')).toBeVisible();
    await expect(page.getByText('deepseek-chat').first()).toBeVisible();
  });

  test('empty state when no profiles', async ({ page }) => {
    await page.goto('/models');
    await expect(page.getByTestId('llm-profiles-section')).toBeVisible();
    await expect(page.getByTestId('llm-profiles-empty')).toBeVisible();
  });

  test('add button opens new profile drawer', async ({ page }) => {
    await page.goto('/models');
    await expect(page.getByTestId('llm-profiles-section')).toBeVisible();
    await page.getByTestId('llm-profiles-add').click();
    await expect(page.getByTestId('llm-profile-new-drawer')).toBeVisible();
  });
});
