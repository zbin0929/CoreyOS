import { test, expect } from './fixtures/test';

/**
 * Analytics page — covers the full render path from `analytics_summary` IPC
 * down to the KPI strip + charts. Mock state ships non-trivial counts so
 * each section has something to assert against.
 */

test.describe('analytics', () => {
  test('renders KPIs and top-model bars from mock summary', async ({ page }) => {
    await page.goto('/analytics');

    // Five KPI tiles (testid is namespaced so we don't clash with other pages).
    await expect(page.getByTestId('analytics-kpi-sessions')).toContainText('42');
    await expect(page.getByTestId('analytics-kpi-messages')).toContainText('137');
    await expect(page.getByTestId('analytics-kpi-tool_calls')).toContainText('58');
    await expect(page.getByTestId('analytics-kpi-active_days')).toContainText('12');
    // total_tokens = 143_555 → formatNumber → "144k".
    await expect(page.getByTestId('analytics-kpi-total_tokens')).toContainText('144k');

    // Top-models list shows the seeded row.
    await expect(page.getByText('deepseek-chat').first()).toBeVisible();
    // Top-tools list too.
    await expect(page.getByText('terminal').first()).toBeVisible();

    // Both 30-day SVG charts render (activity + tokens), matched by their
    // i18n-driven aria-labels.
    await expect(page.getByRole('img', { name: /Activity.*30 days/i })).toBeVisible();
    await expect(page.getByRole('img', { name: /Tokens.*30 days/i })).toBeVisible();
  });

  test('empty state when totals are zero', async ({ page }) => {
    // Override the mock BEFORE the app mounts and fires the IPC.
    await page.addInitScript(() => {
      // The tauri-mock init script ran first and set __CADUCEUS_MOCK__.
      // Reach into its state and zero everything out.
      const mock = (window as unknown as { __CADUCEUS_MOCK__?: { state: unknown } })
        .__CADUCEUS_MOCK__;
      if (mock)
        (mock.state as { analytics: Record<string, unknown> }).analytics = {
          totals: {
            sessions: 0,
            messages: 0,
            tool_calls: 0,
            active_days: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            estimated_cost_usd: 0,
            estimated_cost_cny: 0,
          },
          messages_per_day: [],
          tokens_per_day: [],
          model_usage: [],
          tool_usage: [],
          adapter_usage: [],
          generated_at: Date.now(),
        };
    });
    await page.goto('/analytics');

    await expect(page.getByText(/No activity yet/i)).toBeVisible();
  });
});
