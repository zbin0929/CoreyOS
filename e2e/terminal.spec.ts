import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.5 — Terminal.
 *
 * Mock exercises the spawn → stream → write-echo → kill lifecycle
 * without a real shell. xterm.js renders chars into a canvas so we
 * assert against the backend-visible state (ptyIds) instead.
 */
test.describe('terminal', () => {
  test('open → type round-trips through backend → close tears down the pty', async ({
    page,
  }) => {
    await page.goto('/terminal');
    await expect(page.getByTestId('terminal-host')).toBeVisible();
    await expect(page.getByTestId('terminal-open')).toBeVisible();

    // Before open: no pty in the mock.
    let ids = await page.evaluate(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: { ptyIds: string[] } } }
      ).__CADUCEUS_MOCK__;
      return mock.state.ptyIds;
    });
    expect(ids.length).toBe(0);

    await page.getByTestId('terminal-open').click();
    await expect(page.getByTestId('terminal-close')).toBeVisible();

    // After open: one pty registered in the mock.
    ids = await page.evaluate(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: { ptyIds: string[] } } }
      ).__CADUCEUS_MOCK__;
      return mock.state.ptyIds;
    });
    expect(ids.length).toBe(1);

    // Type into the terminal host — xterm forwards keystrokes to the
    // backend, which the mock echoes back (no-op visually but the IPC
    // path is exercised).
    await page.getByTestId('terminal-host').locator('.xterm').click();
    await page.keyboard.type('hi');

    await page.getByTestId('terminal-close').click();
    await expect(page.getByTestId('terminal-open')).toBeVisible();

    // After close: pty released.
    ids = await page.evaluate(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__: { state: { ptyIds: string[] } } }
      ).__CADUCEUS_MOCK__;
      return mock.state.ptyIds;
    });
    expect(ids.length).toBe(0);
  });

  /**
   * T4.5b — the tab strip keeps multiple ptys alive at once and can
   * close a non-active tab without disturbing its neighbour.
   */
  test('multi-tab: new tab spawns a second pty; closing one leaves the other alive', async ({
    page,
  }) => {
    await page.goto('/terminal');
    const ptyCount = () =>
      page.evaluate(() => {
        const mock = (
          window as unknown as {
            __CADUCEUS_MOCK__: { state: { ptyIds: string[] } };
          }
        ).__CADUCEUS_MOCK__;
        return mock.state.ptyIds.length;
      });

    // Tab 1 via the big CTA.
    await page.getByTestId('terminal-open').click();
    await expect(page.getByTestId('terminal-new-tab')).toBeVisible();
    expect(await ptyCount()).toBe(1);

    // Tab 2 via the + button. Now we should see two tab pills.
    await page.getByTestId('terminal-new-tab').click();
    await expect(page.getByTestId('terminal-tabs').locator('[role="tab"]')).toHaveCount(2);
    expect(await ptyCount()).toBe(2);

    // Tab 2 is active (most recent). Close it via the active-tab
    // header button; tab 1 should remain and become active.
    await page.getByTestId('terminal-close').click();
    await expect(page.getByTestId('terminal-tabs').locator('[role="tab"]')).toHaveCount(1);
    expect(await ptyCount()).toBe(1);

    // Close tab 1 → back to the empty state with the big CTA.
    await page.getByTestId('terminal-close').click();
    await expect(page.getByTestId('terminal-open')).toBeVisible();
    expect(await ptyCount()).toBe(0);
  });
});
