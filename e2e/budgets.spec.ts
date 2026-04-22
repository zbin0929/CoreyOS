import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.4 — Budgets.
 *
 * Covers: empty → create → list → edit → delete round-trip, and the
 * progress-bar percentage against a seeded analytics snapshot that
 * would put the user well over an imaginary $0.01 budget.
 */
test.describe('budgets', () => {
  test('CRUD round-trip on the Budgets page', async ({ page }) => {
    await page.goto('/budgets');
    await expect(page.getByText(/No budgets yet|还没有预算/)).toBeVisible();

    // New → global scope doesn't need a scope_value.
    await page.getByTestId('budgets-new').click();
    await expect(page.getByTestId('budget-editor')).toBeVisible();
    await page.getByTestId('budget-amount').fill('10.00');
    // Custom Select (not a native <select>) — click the trigger, then
    // click the option row by its visible label.
    await page.getByTestId('budget-period').click();
    await page.getByRole('option', { name: 'Weekly' }).click();
    await page.getByTestId('budget-action').click();
    await page.getByRole('option', { name: 'Notify + block' }).click();
    await page.getByTestId('budget-save').click();

    const row = page.locator('[data-testid^="budget-row-"]').first();
    await expect(row.getByText(/\$0\.\d\d \/ \$10\.00/)).toBeVisible();
    await expect(row.getByText(/Weekly|每周/)).toBeVisible();
    await expect(row.getByText(/Notify \+ block|通知 \+ 阻断/)).toBeVisible();

    // Edit → swap to model scope.
    await row.locator('[data-testid^="budget-edit-"]').click();
    await expect(page.getByTestId('budget-editor')).toBeVisible();
    await page.getByTestId('budget-scope-kind').click();
    await page.getByRole('option', { name: 'Model' }).click();
    await page.getByTestId('budget-scope-value').fill('gpt-4o');
    await page.getByTestId('budget-save').click();
    await expect(
      page.locator('[data-testid^="budget-row-"]').first().getByText('gpt-4o'),
    ).toBeVisible();

    // Delete.
    await page
      .locator('[data-testid^="budget-row-"]')
      .first()
      .locator('[data-testid^="budget-delete-"]')
      .click();
    await expect(page.getByText(/No budgets yet|还没有预算/)).toBeVisible();
  });

  test('breached state shows a red bar + warning when usage exceeds cap', async ({
    page,
  }) => {
    // Seed massive usage + one tiny $0.01 budget so the projection is
    // comfortably >= 100%.
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: {
            state: {
              budgets: unknown[];
              analytics: {
                totals: {
                  sessions: number;
                  messages: number;
                  tool_calls: number;
                  active_days: number;
                  prompt_tokens: number;
                  completion_tokens: number;
                  total_tokens: number;
                };
                messages_per_day: unknown[];
                tokens_per_day: unknown[];
                model_usage: unknown[];
                tool_usage: unknown[];
                generated_at: number;
              };
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.budgets = [
        {
          id: 'b-seed',
          scope_kind: 'global',
          scope_value: null,
          amount_cents: 1, // $0.01 — any measurable usage breaches this.
          period: 'day',
          action_on_breach: 'notify',
          created_at: 1,
          updated_at: 1,
        },
      ];
      mock.state.analytics = {
        totals: {
          sessions: 10,
          messages: 50,
          tool_calls: 5,
          active_days: 3,
          prompt_tokens: 1_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
        messages_per_day: [],
        tokens_per_day: [],
        model_usage: [],
        tool_usage: [],
        generated_at: Date.now(),
      };
    });

    await page.goto('/budgets');
    await expect(page.getByTestId('budget-row-b-seed')).toBeVisible();
    await expect(page.getByTestId('budget-breached-b-seed')).toBeVisible();

    const bar = page.getByTestId('budget-progress-b-seed');
    await expect(bar).toHaveAttribute('data-pct', '100');
  });
});
