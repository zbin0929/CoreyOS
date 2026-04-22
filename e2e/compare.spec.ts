import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.1 — Multi-model compare.
 *
 * The mock fixture ships only one model (`hermes-agent`). These tests
 * seed additional mock models via an `addInitScript` that runs AFTER the
 * tauri-mock IIFE has populated `__CADUCEUS_MOCK__` but BEFORE React
 * mounts the route, so the first `model_list` call returns all lanes.
 */

test.describe('compare', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: { state: { models: unknown[] } };
        }
      ).__CADUCEUS_MOCK__;
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
        {
          id: 'gemini-flash',
          provider: 'google',
          display_name: 'Gemini Flash',
          context_window: 1000000,
          is_default: false,
          capabilities: { vision: true, tool_use: false, reasoning: false },
        },
      ];
    });
  });

  test('4 lanes stream in parallel, each ends with a per-model reply and latency pill', async ({
    page,
  }) => {
    await page.goto('/compare');

    // Hermes is seeded by default. Add the other three so we have 4 lanes.
    for (const id of ['gpt-4o', 'claude-sonnet', 'gemini-flash']) {
      await page.getByTestId('compare-add-model').click();
      await page.getByTestId(`compare-add-option-${id}`).click();
    }
    // Chip for each selected model is visible in the picker.
    for (const id of ['hermes-agent', 'gpt-4o', 'claude-sonnet', 'gemini-flash']) {
      await expect(page.getByTestId(`compare-model-chip-${id}`)).toBeVisible();
    }

    await page.getByTestId('compare-prompt-input').fill('hi');
    await page.getByTestId('compare-run').click();

    // All four lanes finish; each ends with a reply that echoes its
    // own model id (mock behavior added in T4.1).
    for (const id of ['hermes-agent', 'gpt-4o', 'claude-sonnet', 'gemini-flash']) {
      const lane = page.getByTestId(`compare-lane-${id}`);
      await expect(lane).toBeVisible();
      await expect(lane.getByText(`[model=${id}]`, { exact: false })).toBeVisible({
        timeout: 3000,
      });
      await expect(page.getByTestId(`compare-lane-latency-${id}`)).toBeVisible();
      await expect(page.getByTestId(`compare-lane-tokens-${id}`)).toBeVisible();
    }

    // Diff footer lights up after ≥2 lanes finish.
    await expect(page.getByTestId('compare-diff-footer')).toBeVisible();
    await expect(page.getByTestId('compare-winner-latency')).toBeVisible();
  });

  test('cancelling one lane leaves the others free to finish', async ({ page }) => {
    await page.goto('/compare');
    // Add two more so we have 3 lanes (enough to cancel one + observe the
    // rest). Starting state already has hermes-agent selected.
    for (const id of ['gpt-4o', 'claude-sonnet']) {
      await page.getByTestId('compare-add-model').click();
      await page.getByTestId(`compare-add-option-${id}`).click();
    }

    // Slow the mock's `done` emission so we have a window to cancel.
    // Default is 20ms; bump to 400ms for this test.
    await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            on: (cmd: string, h: (args: unknown) => unknown) => void;
            emit: (ev: string, payload: unknown) => void;
          };
        }
      ).__CADUCEUS_MOCK__;
      mock.on('chat_stream_start', (raw: unknown) => {
        const args = raw as { args: { handle: string; model?: string } };
        const h = args.args.handle;
        const modelId = args.args.model;
        const reply = modelId
          ? 'Hello from the mock gateway. [model=' + modelId + ']'
          : 'Hello from the mock gateway.';
        queueMicrotask(() => {
          mock.emit('chat:delta:' + h, reply.slice(0, 5));
          setTimeout(() => mock.emit('chat:delta:' + h, reply.slice(5)), 50);
          setTimeout(
            () =>
              mock.emit('chat:done:' + h, {
                finish_reason: 'stop',
                model: modelId || 'mock',
                latency_ms: 400,
                prompt_tokens: 10,
                completion_tokens: 5,
              }),
            400,
          );
        });
        return h;
      });
    });

    await page.getByTestId('compare-prompt-input').fill('hi');
    await page.getByTestId('compare-run').click();

    // Cancel gpt-4o mid-stream. The lane flips to cancelled; others finish.
    await page.getByTestId('compare-lane-cancel-gpt-4o').click();
    await expect(page.getByTestId('compare-lane-cancelled-gpt-4o')).toBeVisible();

    // The other two lanes still finish (latency pills appear).
    await expect(page.getByTestId('compare-lane-latency-hermes-agent')).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByTestId('compare-lane-latency-claude-sonnet')).toBeVisible({
      timeout: 3000,
    });

    // Diff footer includes the two that finished.
    await expect(page.getByTestId('compare-diff-footer')).toBeVisible();
  });

  test('remove-chip deselects a model; max-lanes cap blocks the 5th add', async ({
    page,
  }) => {
    await page.goto('/compare');

    for (const id of ['gpt-4o', 'claude-sonnet', 'gemini-flash']) {
      await page.getByTestId('compare-add-model').click();
      await page.getByTestId(`compare-add-option-${id}`).click();
    }
    // 4 chips, at cap → Add-button disabled.
    await expect(page.getByTestId('compare-add-model')).toBeDisabled();

    // Remove hermes-agent's chip → its chip vanishes.
    await page
      .getByTestId('compare-model-chip-hermes-agent')
      .getByRole('button')
      .click();
    await expect(page.getByTestId('compare-model-chip-hermes-agent')).toHaveCount(0);

    // Now 3 chips → Add button re-enabled.
    await expect(page.getByTestId('compare-add-model')).toBeEnabled();
  });
});
