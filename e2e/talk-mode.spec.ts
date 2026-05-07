import { test, expect } from './fixtures/test';

/**
 * Talk Mode v1 — smoke spec (B-8 task 11).
 *
 * Real audio + LLM round-trips need a manual run on a physical
 * machine with a working microphone (see `docs/talk-mode-plan.md`).
 * This spec covers the surface that breaks loudest in regressions:
 *
 * 1. Topbar mic affordance is present and clickable.
 * 2. Clicking opens the overlay (the readiness probe finishes).
 * 3. With cloud providers stubbed configured, the overlay shows
 *    the talk mic (idle state) — NOT the unconfigured banner.
 * 4. Mode toggle switches between PTT and auto modes.
 * 5. Close button dismisses the overlay.
 *
 * Anything below this line that asserts on real audio capture or
 * STT output is intentionally left to the manual cross-platform
 * pass tracked in `docs/talk-mode-plan.md` task 11.
 */

test.describe('Talk Mode (smoke)', () => {
  test('composer talk button opens overlay; mode toggle + close work', async ({ page }) => {
    await page.goto('/');

    const talkBtn = page.getByTestId('chat-talk-mode');
    await expect(talkBtn).toBeVisible({ timeout: 10000 });

    await talkBtn.click();

    // Overlay opens. The mocked voice config has both providers
    // configured, so we should land on the configured path — the
    // mic button is visible, NOT the unconfigured banner.
    const overlay = page.getByTestId('talk-mode-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId('talk-unconfigured')).toHaveCount(0);
    await expect(page.getByTestId('talk-mic')).toBeVisible();

    // Mode toggle starts in PTT (default). Click flips to auto;
    // the VU halo only renders in auto mode so it's a sufficient
    // assertion that the mode actually changed.
    const toggle = page.getByTestId('talk-mode-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('talk-vu-halo')).toBeVisible();

    // Click again, halo disappears (back to PTT).
    await toggle.click();
    await expect(page.getByTestId('talk-vu-halo')).toHaveCount(0);

    // Close dismisses the overlay.
    await page.getByTestId('talk-close').click();
    await expect(overlay).toHaveCount(0);
  });
});
