import { test, expect } from './fixtures/test';

/**
 * Home customization smoke — validates `useHomeLayoutStore` end-to-end.
 *
 * Covers:
 *   1. Edit-mode toggle (gear button → expanded toolbar with chips).
 *   2. Hiding a default-visible widget removes it from the page.
 *   3. The widget chip flips state and re-shows it on click.
 *   4. The reset button wipes overrides.
 */
test.describe('home customization', () => {
  test('hide a widget then restore via the toggle chips', async ({ page }) => {
    await page.goto('/');

    // Default state: System Status widget is visible.
    await expect(page.locator('[data-widget-id="system_status"]')).toBeVisible();

    // Open edit mode.
    await page.getByTestId('home-edit-toggle').click();
    await expect(page.getByTestId('home-edit-bar')).toBeVisible();

    // Hide the System Status widget via its inline button.
    await page.getByTestId('widget-hide-system_status').click();
    await expect(
      page.locator('[data-widget-id="system_status"]'),
    ).toHaveCount(0);

    // The toggle chip in the bar shows the hidden state and brings it back.
    await page.getByTestId('widget-toggle-system_status').click();
    await expect(
      page.locator('[data-widget-id="system_status"]'),
    ).toBeVisible();

    // Reset wipes overrides; the bar is still open.
    await page.getByTestId('home-edit-reset').click();
    await expect(
      page.locator('[data-widget-id="system_status"]'),
    ).toBeVisible();

    // Done exits edit mode.
    await page.getByTestId('home-edit-done').click();
    await expect(page.getByTestId('home-edit-bar')).toHaveCount(0);
    await expect(page.getByTestId('home-edit-toggle')).toBeVisible();
  });
});
