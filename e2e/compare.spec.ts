import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.1 — Multi-model compare.
 *
 * Compare's picker now reads from `llm_profile_list` (the prior
 * `model_list` source meant lanes only saw the active adapter's
 * models, which after the Hermes-as-default pivot meant a single
 * model — useless for cross-model compare). These tests seed four
 * synthetic LLM Profiles via `addInitScript`, which runs after the
 * tauri-mock IIFE has populated `__CADUCEUS_MOCK__` but before
 * React mounts.
 *
 * Each profile maps to a synthetic ModelInfo with id `profile:<p.id>`
 * inside Compare, so the existing chip / option testids
 * (`compare-add-option-profile:hermes` etc.) line up.
 */

test.describe('compare', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: { state: { llmProfiles: unknown[] } };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      // The shape mirrors `LlmProfile` in src-tauri/src/llm_profiles.rs.
      // Only fields the picker reads are required.
      mock.state.llmProfiles = [
        { id: 'hermes', label: 'Hermes', provider: 'hermes', base_url: '', model: 'hermes-agent', vision: false },
        { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', base_url: '', model: 'gpt-4o', vision: true },
        { id: 'claude-sonnet', label: 'Claude Sonnet', provider: 'anthropic', base_url: '', model: 'claude-sonnet', vision: true },
        { id: 'gemini-flash', label: 'Gemini Flash', provider: 'google', base_url: '', model: 'gemini-flash', vision: true },
      ];
    });
  });

  test('4 lanes stream in parallel, each ends with a per-model reply and latency pill', async ({
    page,
  }) => {
    await page.goto('/compare');

    // Hermes is seeded by default. Add the other three so we have 4 lanes.
    // Compare's picker uses synthetic ids `profile:<p.id>`, so the
    // testids embed the prefix.
    for (const id of ['profile:gpt-4o', 'profile:claude-sonnet', 'profile:gemini-flash']) {
      await page.getByTestId('compare-add-model').click();
      await page.getByTestId(`compare-add-option-${id}`).click();
    }
    // Chip for each selected model is visible in the picker.
    for (const id of ['profile:hermes', 'profile:gpt-4o', 'profile:claude-sonnet', 'profile:gemini-flash']) {
      await expect(page.getByTestId(`compare-model-chip-${id}`)).toBeVisible();
    }

    await page.getByTestId('compare-prompt-input').fill('hi');
    await page.getByTestId('compare-run').click();

    // All four lanes finish; each ends with a reply that echoes its
    // own model id (mock behavior added in T4.1).
    // Lane-id ↔ underlying model-name mapping. The lane's testid
    // uses the synthetic `profile:` id (Compare's source of truth
    // for selection); the reply echoes the WIRE model name (Hermes
    // gets `model=<profile.model>` not `<profile.id>` on the IPC).
    const laneByModel: Array<[string, string]> = [
      ['profile:hermes', 'hermes-agent'],
      ['profile:gpt-4o', 'gpt-4o'],
      ['profile:claude-sonnet', 'claude-sonnet'],
      ['profile:gemini-flash', 'gemini-flash'],
    ];
    for (const [laneId, wireModel] of laneByModel) {
      const lane = page.getByTestId(`compare-lane-${laneId}`);
      await expect(lane).toBeVisible();
      await expect(lane.getByText(`[model=${wireModel}]`, { exact: false })).toBeVisible({
        timeout: 3000,
      });
      await expect(page.getByTestId(`compare-lane-latency-${laneId}`)).toBeVisible();
      await expect(page.getByTestId(`compare-lane-tokens-${laneId}`)).toBeVisible();
    }

    // Diff footer lights up after ≥2 lanes finish.
    await expect(page.getByTestId('compare-diff-footer')).toBeVisible();
    await expect(page.getByTestId('compare-winner-latency')).toBeVisible();
  });

  test('cancelling one lane leaves the others free to finish', async ({ page }) => {
    await page.goto('/compare');
    // Add two more so we have 3 lanes (enough to cancel one + observe the
    // rest). Starting state already has hermes-agent selected.
    for (const id of ['profile:gpt-4o', 'profile:claude-sonnet']) {
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
    await page.getByTestId('compare-lane-cancel-profile:gpt-4o').click();
    await expect(page.getByTestId('compare-lane-cancelled-profile:gpt-4o')).toBeVisible();

    // The other two lanes still finish (latency pills appear).
    await expect(page.getByTestId('compare-lane-latency-profile:hermes')).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByTestId('compare-lane-latency-profile:claude-sonnet')).toBeVisible({
      timeout: 3000,
    });

    // Diff footer includes the two that finished.
    await expect(page.getByTestId('compare-diff-footer')).toBeVisible();
  });

  test('remove-chip deselects a model; max-lanes cap blocks the 5th add', async ({
    page,
  }) => {
    await page.goto('/compare');

    for (const id of ['profile:gpt-4o', 'profile:claude-sonnet', 'profile:gemini-flash']) {
      await page.getByTestId('compare-add-model').click();
      await page.getByTestId(`compare-add-option-${id}`).click();
    }
    // 4 chips, at cap → Add-button disabled.
    await expect(page.getByTestId('compare-add-model')).toBeDisabled();

    // Remove hermes profile's chip → its chip vanishes.
    await page
      .getByTestId('compare-model-chip-profile:hermes')
      .getByRole('button')
      .click();
    await expect(page.getByTestId('compare-model-chip-profile:hermes')).toHaveCount(0);

    // Now 3 chips → Add button re-enabled.
    await expect(page.getByTestId('compare-add-model')).toBeEnabled();
  });
});
