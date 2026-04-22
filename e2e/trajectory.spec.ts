import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.3 — Trajectory timeline.
 *
 * Seeds the SQLite-backed `db_load_all` response with a two-session
 * fixture and verifies the route renders rows + tool ribbons, and that
 * clicking a row opens the inspector with the captured content.
 */
test.describe('trajectory', () => {
  test('renders sessions + message rows + tool ribbons; inspector opens on click', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__?: { state: Record<string, unknown> } }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      // Stub the load-all response via an override so we don't have to
      // simulate the full zustand hydration.
      (mock as unknown as { on: (cmd: string, h: () => unknown) => void }).on(
        'db_load_all',
        () => [
          {
            id: 's1',
            title: 'Deploy review',
            model: 'gpt-4o',
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_060_000,
            messages: [
              {
                id: 'm1',
                session_id: 's1',
                role: 'user',
                content: 'Walk me through the deploy checklist.',
                error: null,
                position: 0,
                created_at: 1_700_000_000_000,
                tool_calls: [],
              },
              {
                id: 'm2',
                session_id: 's1',
                role: 'assistant',
                content: 'Here it is: build → test → stage → prod.',
                error: null,
                position: 1,
                created_at: 1_700_000_030_000,
                prompt_tokens: 18,
                completion_tokens: 24,
                tool_calls: [
                  {
                    id: 'tc1',
                    message_id: 'm2',
                    tool: 'terminal',
                    emoji: null,
                    label: 'pnpm build',
                    at: 1_700_000_020_000,
                  },
                ],
              },
            ],
          },
          {
            id: 's2',
            title: 'Model comparison',
            model: 'claude-sonnet',
            created_at: 1_699_000_000_000,
            updated_at: 1_699_000_005_000,
            messages: [],
          },
        ],
      );
    });

    await page.goto('/trajectory');

    // First session auto-selected.
    await expect(page.getByTestId('trajectory-timeline')).toBeVisible();
    await expect(page.getByTestId('trajectory-row-m1')).toBeVisible();
    await expect(page.getByTestId('trajectory-row-m2')).toBeVisible();
    await expect(page.getByTestId('trajectory-tool-tc1')).toBeVisible();
    // Totals strip shows 2 messages + 1 tool.
    await expect(page.getByText(/2 msg|2 消息/)).toBeVisible();
    await expect(page.getByText(/1 tool|1 工具/)).toBeVisible();

    // Click m2 → inspector opens with the captured content.
    await page.getByTestId('trajectory-row-m2').click();
    const inspector = page.getByTestId('trajectory-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText(/build → test → stage → prod/)).toBeVisible();

    // Switch sessions via the picker → empty session shows its own empty state.
    await page.getByTestId('trajectory-session-picker').click();
    await page.getByTestId('trajectory-session-option-s2').click();
    await expect(page.getByText(/Empty session|空会话/)).toBeVisible();
  });
});
