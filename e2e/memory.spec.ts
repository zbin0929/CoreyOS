import { test, expect } from './fixtures/test';

/**
 * Phase 7 · T7.3 — Memory page.
 *
 * Smokes the full editor loop: open → seed a tab → switch tabs →
 * type → save → confirm the mock fixture reflects the write. The
 * CodeMirror instance exposes a hidden textarea under
 * `memory-textarea-<kind>` (same pattern Skills uses) so fills are
 * deterministic.
 */
test.describe('memory page (T7.3)', () => {
  test('both tabs load, agent seed visible, switch shows user profile', async ({
    page,
  }) => {
    // Seed BOTH files before the page ever reads them so the mount-time
    // `memoryRead` calls hit a known starting state. The init script
    // runs before the app bundle so state is fully prepared.
    await page.addInitScript(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: { memory: Record<string, string | null> } } }
      ).__CADUCEUS_MOCK__;
      mock.state.memory.agent = '# Agent notes\n\n- prefers terse responses\n';
      mock.state.memory.user = '# User profile\n\n- calls me Corey\n';
    });
    await page.goto('/memory');

    // Agent is the default tab. Its textarea mirror carries the seeded
    // body; `toHaveValue` is the strict equality contract Skills
    // already relies on.
    const agentTa = page.getByTestId('memory-textarea-agent');
    await expect(agentTa).toHaveValue(/Agent notes/);
    await expect(page.getByTestId('memory-tab-agent')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Switch to user tab. The second textarea is always rendered; the
    // editor area swaps to the user body.
    await page.getByTestId('memory-tab-user').click();
    const userTa = page.getByTestId('memory-textarea-user');
    await expect(userTa).toHaveValue(/User profile/);
  });

  test('search tab runs FTS query and renders hits with highlights', async ({
    page,
  }) => {
    await page.goto('/memory');
    await page.getByTestId('memory-tab-search').click();

    // Idle state visible before any search runs.
    await expect(page.getByTestId('memory-search-results')).toContainText(
      /Type a query|输入关键词/,
    );

    await page.getByTestId('memory-search-input').fill('docker');
    await page.getByTestId('memory-search-run').click();

    // Mock seeds 2 hits; both should render with the highlight mark.
    const hits = page.getByTestId('memory-search-hit');
    await expect(hits).toHaveCount(2);
    // First hit title comes from mock.
    await expect(hits.first()).toContainText('Docker deploy recipe');
    // Highlighted span renders as <mark>.
    await expect(hits.first().locator('mark')).toContainText('docker');
  });

  test('edit → dirty dot appears → save clears dot and persists to mock', async ({
    page,
  }) => {
    await page.goto('/memory');

    // First read on a fresh mock returns exists:false for both slots,
    // so the capacity meter advertises the "new file" hint.
    await expect(page.getByTestId('memory-status-new')).toBeVisible();

    const ta = page.getByTestId('memory-textarea-agent');
    await ta.fill('- be terse\n- verify assumptions\n');

    // Dirty indicator: a dot on the tab + an "unsaved changes" chip.
    await expect(page.getByTestId('memory-tab-agent-dirty')).toBeVisible();
    await expect(page.getByTestId('memory-status-dirty')).toBeVisible();

    // Save button lights up once the body diverges from the loaded
    // snapshot; clicking writes through the mock.
    const save = page.getByTestId('memory-save');
    await expect(save).toBeEnabled();
    await save.click();

    // Dirty indicators clear, saved chip shows, save button disables
    // until the next edit.
    await expect(page.getByTestId('memory-tab-agent-dirty')).toHaveCount(0);
    await expect(page.getByTestId('memory-status-saved')).toBeVisible();
    await expect(save).toBeDisabled();

    // The mock slot reflects the write — this is the acceptance
    // contract for "Hermes would actually see the new memory".
    const slot = await page.evaluate(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: { memory: Record<string, string | null> } } }
      ).__CADUCEUS_MOCK__;
      return mock.state.memory.agent;
    });
    expect(slot).toBe('- be terse\n- verify assumptions\n');
  });
});
