import { test, expect } from './fixtures/test';

/**
 * Settings → Advanced — covers the new surface introduced by the
 * 2026-05-06 route audit. Verifies:
 *   1. The Advanced section renders with the demoted-badge stamp.
 *   2. Every entry in `DEMOTED_ROUTES` shows up as a link with the
 *      route path printed inline (so users can find them by URL).
 *   3. Clicking one of the links lands on the demoted page AND the
 *      `DemotedRouteBanner` is visible at the top — proving the
 *      route still works (per N-2) and is correctly tagged.
 */
test.describe('settings → advanced', () => {
  test('lists demoted routes and links to /compare with banner', async ({ page }) => {
    await page.goto('/settings');

    // Section heading + demoted timestamp pill.
    await expect(page.getByText(/高级.*实验|Advanced/i).first()).toBeVisible();
    await expect(page.getByText(/demoted · 2026-05-06/i)).toBeVisible();

    // Spot-check three demoted paths render as code spans.
    for (const path of ['/compare', '/terminal', '/agents']) {
      await expect(page.getByRole('code').filter({ hasText: path })).toBeVisible();
    }

    // Click the /compare link inside the Advanced section.
    await page.getByRole('link', { name: /对比|Compare/ }).click();
    await expect(page).toHaveURL(/\/compare$/);

    // The DemotedRouteBanner is the proof the wrapper is wired.
    await expect(
      page.getByText(/本页已从主侧边栏移除|hidden from the main sidebar/i),
    ).toBeVisible();
  });
});
