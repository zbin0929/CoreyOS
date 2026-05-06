import { test, expect } from './fixtures/test';

/**
 * v0.2.4 / B-9 — global Tasks page (/tasks).
 *
 * Smoke + light fixture coverage:
 *   1. Empty state: both Active and History tabs render their empty
 *      EmptyState with the right copy.
 *   2. Tab switch: clicking History flips the active tab and updates
 *      the underline indicator.
 *   3. Populated state: pushing fixtures into state.workflowActive +
 *      state.workflowHistory before goto renders the rows + cancel
 *      button on running tasks.
 *
 * Required by project rule T-3 (new routes need an E2E spec).
 */
test.describe('tasks page', () => {
  test('empty state renders both tabs and switches between them', async ({ page }) => {
    await page.goto('/tasks');

    // Default tab is Active. EmptyState should be visible.
    await expect(
      page.getByText(/当前没有运行中的任务|No active tasks/i),
    ).toBeVisible();

    // Switch to History.
    await page.getByRole('button', { name: /历史|History/ }).click();
    await expect(
      page.getByText(/暂无任务历史|No task history/i),
    ).toBeVisible();
  });

  test('populated active + history rows show with cancel on running', async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: Record<string, unknown> } }
      ).__CADUCEUS_MOCK__;
      mock.state.workflowActive = [
        {
          id: 'run-running-1',
          workflow_id: 'daily-digest',
          status: 'running',
          step_runs: {
            s1: { status: 'completed' },
            s2: { status: 'running' },
          },
          error: null,
          inputs: {},
        },
      ];
      mock.state.workflowHistory = [
        {
          id: 'run-done-1',
          workflow_id: 'pdf-summary',
          status: 'completed',
          step_count: 2,
          completed_count: 2,
          failed_count: 0,
          started_at: Date.now() - 60_000,
          updated_at: Date.now() - 30_000,
          error: null,
        },
        {
          id: 'run-failed-1',
          workflow_id: 'old-flow',
          status: 'failed',
          step_count: 3,
          completed_count: 1,
          failed_count: 1,
          started_at: Date.now() - 120_000,
          updated_at: Date.now() - 90_000,
          error: 'agent timeout',
        },
      ];
    });

    await page.goto('/tasks');

    // Active tab — running row shows the workflow id + cancel affordance.
    const runningRow = page.locator('li', { hasText: 'daily-digest' }).first();
    await expect(runningRow).toBeVisible();
    // The row itself is a <button> that toggles the detail panel; the
    // cancel control lives inside it as a span with role=button. Locate
    // it by tabindex so we don't match the outer toggle.
    await expect(
      runningRow.locator('span[role="button"]', { hasText: /取消|Cancel/ }),
    ).toBeVisible();

    // Click the row to expand and verify the step list renders.
    await runningRow.getByTestId('task-row-run-running-1').click();
    await expect(
      page.getByTestId('task-detail-run-running-1'),
    ).toBeVisible();

    // History tab — both terminal rows visible. Failed row surfaces error.
    await page.getByRole('button', { name: /历史|History/ }).click();
    await expect(page.getByText('pdf-summary')).toBeVisible();
    await expect(page.getByText('old-flow')).toBeVisible();
    await expect(page.getByText(/agent timeout/)).toBeVisible();
  });
});
