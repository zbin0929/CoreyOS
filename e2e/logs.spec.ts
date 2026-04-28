import { test, expect } from './fixtures/test';

test.describe('logs (changelog)', () => {
  test('empty state when no journal entries', async ({ page }) => {
    await page.goto('/logs');
    await page.getByTestId('logs-tab-changelog').click();
    await expect(page.getByText(/No changes yet|暂无改动/)).toBeVisible();
  });

  test('a changelog entry shows up and can be reverted', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const s = (window as unknown as { __CADUCEUS_MOCK__?: { state: { changelog: unknown[] } } }).__CADUCEUS_MOCK__?.state;
      if (s) {
        s.changelog = [
          {
            id: 'mock-entry-1',
            ts: new Date().toISOString(),
            op: 'hermes.config.model',
            before: { default: 'deepseek-chat', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1' },
            after: { default: 'deepseek-reasoner', provider: 'openai-compatible', base_url: 'https://api.deepseek.com/v1' },
            summary: 'default: deepseek-chat -> deepseek-reasoner',
          },
        ];
      }
    });
    await page.getByRole('link', { name: /Logs|日志/ }).click();
    await page.getByTestId('logs-tab-changelog').click();
    await expect(
      page.getByText(/deepseek-reasoner/).first(),
    ).toBeVisible({ timeout: 4000 });

    await page
      .getByRole('button', { name: /^Revert$|^撤销$/ })
      .first()
      .click();
    await expect(
      page.getByText(/Reverted|已撤销/).first(),
    ).toBeVisible({ timeout: 4000 });
  });
});
