import { test, expect } from './fixtures/test';

/**
 * Chat · per-session model picker (ActiveLLMBadge dropdown).
 *
 * Regression guard for the bug where `setSessionModel` wrote into the store
 * but the chat wire path explicitly dropped the `model` field. Relies on
 * the tauri-mock behavior of echoing `[model=<id>]` into the reply when
 * a model is present on `chat_stream_start` — proves the override reached
 * the IPC boundary.
 *
 * The fixture ships a single model; we seed two extras before boot so the
 * list has something meaningful to pick from.
 */

test.describe('chat · model picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (window as unknown as { __CADUCEUS_MOCK__?: { state: Record<string, unknown> } })
        .__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.models = [
        {
          id: 'hermes-agent',
          provider: 'hermes',
          display_name: 'Hermes',
          context_window: 200000,
          is_default: true,
          capabilities: { vision: false, tool_use: true, reasoning: true },
        },
        {
          id: 'gpt-4o',
          provider: 'openai',
          display_name: 'GPT-4o',
          context_window: 128000,
          is_default: false,
          capabilities: { vision: true, tool_use: true, reasoning: false },
        },
        {
          id: 'claude-sonnet',
          provider: 'anthropic',
          display_name: 'Claude Sonnet',
          context_window: 200000,
          is_default: false,
          capabilities: { vision: true, tool_use: true, reasoning: true },
        },
      ];
    });
  });

  test('override → send → reply carries the picked model; "Use default" clears it', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Default state: badge visible, not overridden, label = default model id.
    const trigger = page.getByTestId('chat-model-picker-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('data-overridden', 'false');
    // Default from mock hermesConfig.model.default.
    await expect(trigger).toContainText('deepseek-chat');

    // Open the picker and confirm two of the three seeded models
    // render. `hermes-agent` is intentionally filtered out by
    // ActiveLLMBadge — it's a meta-model alias for "use the default"
    // and would create a duplicate entry against the "Use default"
    // sentinel row at the top.
    await trigger.click();
    const list = page.getByTestId('chat-model-picker-list');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('chat-model-picker-option-gpt-4o')).toBeVisible();
    await expect(page.getByTestId('chat-model-picker-option-claude-sonnet')).toBeVisible();
    // Confirm the meta-model is NOT shown — the dedup was the
    // entire reason the filter exists.
    await expect(page.getByTestId('chat-model-picker-option-hermes-agent')).toHaveCount(0);

    // Pick non-default → badge flips to override state.
    await page.getByTestId('chat-model-picker-option-gpt-4o').click();
    await expect(list).toBeHidden();
    await expect(trigger).toHaveAttribute('data-overridden', 'true');
    await expect(trigger).toContainText('gpt-4o');

    // Send a message. Mock echoes `[model=<id>]` back iff the `model` field
    // actually made it onto the IPC payload — this is the core regression
    // check: before the fix, the reply arrived without the suffix.
    const composer = page.getByPlaceholder(/Message|输入/i);
    await composer.fill('Pick test');
    await composer.press('Enter');
    await expect(
      page.getByText('Hello from the mock gateway. [model=gpt-4o]').first(),
    ).toBeVisible();

    // Clear override via "Use default" row → back to default label.
    await trigger.click();
    await page.getByTestId('chat-model-picker-use-default').click();
    await expect(trigger).toHaveAttribute('data-overridden', 'false');
    await expect(trigger).toContainText('deepseek-chat');
  });

  test('keyboard: ↓↓ Enter lands on the first model; Esc closes', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    const trigger = page.getByTestId('chat-model-picker-trigger');
    // Open via keyboard — trigger supports ↓/Enter/Space.
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('chat-model-picker-list')).toBeVisible();

    // Start on the "Use default" sentinel (-1). ↓ once → gpt-4o
    // (idx 0 after `hermes-agent` is filtered out — see picker
    // logic in ActiveLLMBadge.tsx).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('chat-model-picker-list')).toBeHidden();
    await expect(trigger).toContainText('gpt-4o');
    await expect(trigger).toHaveAttribute('data-overridden', 'true');

    // Re-open + Esc closes without further mutation.
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-model-picker-list')).toBeHidden();
    await expect(trigger).toContainText('gpt-4o');
  });
});
