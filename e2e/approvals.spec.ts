import { test, expect } from './fixtures/test';

/**
 * /approvals — workflow approval inbox.
 *
 * The page polls `workflow_active_runs` and surfaces every step in
 * `awaiting_approval` status. With no live runs the page lands on
 * the EmptyState. We don't simulate a paused workflow here (would
 * require driving the engine through a real approval-gated def);
 * the empty path is enough to verify routing + IPC wiring + render.
 */
test('/approvals route renders empty state with no pending workflows', async ({ page }) => {
  await page.goto('/approvals');
  await expect(page.getByText('审批中心')).toBeVisible();
  await expect(page.getByText('没有等待审批的工作流')).toBeVisible();
});

test('/approvals refresh button is reachable', async ({ page }) => {
  await page.goto('/approvals');
  const refresh = page.getByTestId('approvals-refresh');
  await expect(refresh).toBeVisible();
  await refresh.click();
  // Re-renders without crashing; empty state still shown.
  await expect(page.getByText('没有等待审批的工作流')).toBeVisible();
});
