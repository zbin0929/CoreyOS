import { test, expect } from './fixtures/test';

/**
 * T6.7b — Telegram end-to-end smoke test.
 *
 * Proves that the post-T6.7a Telegram channel schema actually wires
 * all the way through the UI: unconfigured → enter token → save →
 * never leak the token into the DOM → configured → optional gateway
 * restart → live-status probe flips to online.
 *
 * Complements `channels.spec.ts` (catalog rendering + discord save
 * flow) with the full loop against a realistic starting state: the
 * fixture ships telegram *pre-configured*, so we RESET it to
 * unconfigured here before driving the flow so the assertions are
 * symmetric with real first-time user behaviour.
 */

test.describe('T6.7b — Telegram smoke', () => {
  test('full configure → save → restart → online loop', async ({ page }) => {
    // Reset telegram to unconfigured so the UI reflects the empty
    // starting state. The mock's init script reseeds state on every
    // page load so we can't pre-set via addInitScript; instead we
    // navigate once, mutate the fixture, then click Refresh to
    // trigger a re-fetch of the catalog through the existing
    // refresh path (same IPC the user's manual refresh uses).
    await page.goto('/channels');
    // Wait for the mock init script to land before touching its
    // state. The fixture's `addInitScript` runs before app scripts
    // but it's possible for `page.evaluate` to fire before the IIFE
    // assigns `__CADUCEUS_MOCK__` on some machines.
    await page.waitForFunction(() => {
      return typeof (
        window as unknown as { __CADUCEUS_MOCK__?: unknown }
      ).__CADUCEUS_MOCK__ !== 'undefined';
    });
    await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: {
              channels: Array<{
                id: string;
                env_present: Record<string, boolean>;
              }>;
              channelStatuses: Record<
                string,
                { state: 'online' | 'offline' | 'unknown'; last_marker: string | null }
              >;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      const telegram = mock.state.channels.find((c) => c.id === 'telegram');
      if (telegram) {
        telegram.env_present = { TELEGRAM_BOT_TOKEN: false };
      }
      mock.state.channelStatuses.telegram = {
        state: 'offline',
        last_marker: '2026-04-23 telegram: no bot token configured',
      };
    });
    // Refresh button re-fetches both the channel catalog and the
    // live-status probe — equivalent to the user-facing
    // "Refresh" action and preserves our mutated state (reload would
    // re-run the mock's init script and wipe it).
    await page.getByTestId('channels-refresh-button').click();

    // Card starts in the unconfigured bucket + shows the Verified
    // badge (T6.7b catalog entry lives in src/features/channels/verified.ts).
    const card = page.getByTestId('channel-card-telegram');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('channel-verified-telegram')).toBeVisible();
    await expect(card.getByTestId('channel-status-unconfigured')).toBeVisible();
    await expect(card.getByText('TELEGRAM_BOT_TOKEN')).toBeVisible();

    // Open the inline editor.
    await card.getByTestId('channel-edit-telegram').click();
    await expect(page.getByTestId('channel-form-telegram')).toBeVisible();

    // Fill a plausible Telegram bot token. The exact format doesn't
    // matter to the frontend — the backend never receives a live
    // Telegram API call from e2e, only the save IPC.
    const token = '1234567890:ABCDEFghijklmnopqrstuvwxyz_0123456789';
    await page
      .getByTestId('channel-env-input-telegram-TELEGRAM_BOT_TOKEN')
      .fill(token);

    // Submit → diff appears, diff must surface the env key name but
    // MUST NOT leak the token value anywhere in the DOM.
    await page.getByTestId('channel-form-save-telegram').click();
    const diff = page.getByTestId('channel-confirm-diff');
    await expect(diff).toBeVisible();
    await expect(diff.getByText('TELEGRAM_BOT_TOKEN')).toBeVisible();
    await expect(page.getByText(token)).toHaveCount(0);

    // Confirm the save. Mock applies env_present update + records the
    // payload.
    await page.getByTestId('channel-confirm-save').click();

    // The restart prompt appears because telegram is not
    // hot-reloadable. Also assert the save payload was captured
    // correctly: env_updates has the exact key → value we typed,
    // yaml_updates is empty.
    await expect(page.getByTestId('channel-restart-prompt-telegram')).toBeVisible();
    const saves = await page.evaluate(() => {
      return (
        window as unknown as {
          __CADUCEUS_MOCK__: { state: { channelSaves: unknown[] } };
        }
      ).__CADUCEUS_MOCK__.state.channelSaves;
    });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      id: 'telegram',
      env_updates: { TELEGRAM_BOT_TOKEN: token },
    });

    // Confirm the restart. Flip the live-status fixture to "online"
    // before we click — the mock's hermes_gateway_restart handler
    // does not touch status state, so the probe-after-restart
    // transition is what real users would see (gateway reconnects,
    // next probe sees the online marker).
    await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: {
              channelStatuses: Record<
                string,
                { state: 'online' | 'offline' | 'unknown'; last_marker: string | null }
              >;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      mock.state.channelStatuses.telegram = {
        state: 'online',
        last_marker: '2026-04-23 telegram: connected to bot API',
      };
    });

    await page.getByTestId('channel-restart-confirm-telegram').click();

    // After restart returns, the card is back in view mode and the
    // status pill is now "configured".
    await expect(
      card.getByTestId('channel-status-configured'),
    ).toBeVisible();

    // Force a live-status probe; the online pill appears.
    await page.getByTestId('channels-probe-button').click();
    await expect(card.getByTestId('channel-live-online-telegram')).toBeVisible();

    // Token still never visible in the DOM at any point.
    await expect(page.getByText(token)).toHaveCount(0);
  });
});
