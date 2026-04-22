import { test, expect } from './fixtures/test';

/**
 * Phase 3 · T3.1 — Channels page catalog pass. The grid is read-only
 * in this sprint; form interactivity lands with T3.2.
 *
 * The mock returns a 4-channel representative set that exercises every
 * status bucket so we don't need per-test state mutation.
 */

test.describe('channels', () => {
  test('renders one card per catalog entry with the right status pill', async ({ page }) => {
    await page.goto('/channels');

    // All 4 cards rendered.
    await expect(page.getByTestId('channel-card-telegram')).toBeVisible();
    await expect(page.getByTestId('channel-card-discord')).toBeVisible();
    await expect(page.getByTestId('channel-card-matrix')).toBeVisible();
    await expect(page.getByTestId('channel-card-wechat')).toBeVisible();

    // Status buckets. Scope the selector to the card so partial/discord
    // don't collide (they share CSS classes, not text).
    await expect(
      page.getByTestId('channel-card-telegram').getByTestId('channel-status-configured'),
    ).toBeVisible();
    await expect(
      page.getByTestId('channel-card-discord').getByTestId('channel-status-unconfigured'),
    ).toBeVisible();
    await expect(
      page.getByTestId('channel-card-matrix').getByTestId('channel-status-partial'),
    ).toBeVisible();
    await expect(
      page.getByTestId('channel-card-wechat').getByTestId('channel-status-qr'),
    ).toBeVisible();

    // Matrix card surfaces "1/2" set-count in its partial pill.
    await expect(
      page.getByTestId('channel-card-matrix').getByText(/1\/2/),
    ).toBeVisible();
  });

  test('env key rows render presence icons but never a value', async ({ page }) => {
    await page.goto('/channels');

    const telegram = page.getByTestId('channel-card-telegram');
    // Name is shown; no value is ever rendered.
    await expect(telegram.getByText('TELEGRAM_BOT_TOKEN')).toBeVisible();
    // Matrix has two rows; check both are listed.
    const matrix = page.getByTestId('channel-card-matrix');
    await expect(matrix.getByText('MATRIX_ACCESS_TOKEN')).toBeVisible();
    await expect(matrix.getByText('MATRIX_HOMESERVER')).toBeVisible();
  });
});
