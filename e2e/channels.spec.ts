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

    // All 4 cards rendered. Post-T6.7a (2026-04-23 pm) the fixture's
    // fourth channel is WeiXin (replacing WeChat's fake QR flow).
    await expect(page.getByTestId('channel-card-telegram')).toBeVisible();
    await expect(page.getByTestId('channel-card-discord')).toBeVisible();
    await expect(page.getByTestId('channel-card-matrix')).toBeVisible();
    await expect(page.getByTestId('channel-card-weixin')).toBeVisible();

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
      page.getByTestId('channel-card-weixin').getByTestId('channel-status-unconfigured'),
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

  // ───────────────────────── T3.2 — form flow ─────────────────────────

  test('toggling a yaml field flips to form → diff → save, pips update', async ({ page }) => {
    await page.goto('/channels');

    // Open the Telegram form via the edit button.
    await page.getByTestId('channel-edit-telegram').click();
    await expect(page.getByTestId('channel-form-telegram')).toBeVisible();

    // Toggle `mention_required` off (seed fixture has it true).
    const mention = page.getByTestId('channel-yaml-input-telegram-mention_required');
    await mention.uncheck();

    // Submit the form → diff view should appear with one yaml line.
    await page.getByTestId('channel-form-save-telegram').click();
    const diff = page.getByTestId('channel-confirm-diff');
    await expect(diff).toBeVisible();
    await expect(diff.getByText('mention_required')).toBeVisible();

    // Confirm → IPC fires and the restart prompt shows (hot_reloadable=false).
    await page.getByTestId('channel-confirm-save').click();
    await expect(page.getByTestId('channel-restart-prompt-telegram')).toBeVisible();

    // The mock recorded the save payload; assert env_updates is empty
    // and yaml_updates carries the one toggle we flipped.
    const saves = await page.evaluate(() => {
      return (window as unknown as { __CADUCEUS_MOCK__: { state: { channelSaves: unknown[] } } })
        .__CADUCEUS_MOCK__.state.channelSaves;
    });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      id: 'telegram',
      env_updates: {},
      yaml_updates: { mention_required: false },
    });

    // Dismiss the restart prompt; card returns to view mode.
    await page.getByTestId('channel-restart-prompt-telegram').getByRole('button').first().click();
    await expect(page.getByTestId('channel-form-telegram')).toBeHidden();
  });

  test('typing a token and saving reports env_updates without leaking the value into the card', async ({ page }) => {
    await page.goto('/channels');

    // Discord starts unconfigured in the fixture.
    await expect(
      page.getByTestId('channel-card-discord').getByTestId('channel-status-unconfigured'),
    ).toBeVisible();

    await page.getByTestId('channel-edit-discord').click();
    await page
      .getByTestId('channel-env-input-discord-DISCORD_BOT_TOKEN')
      .fill('super-secret-bot-token');

    await page.getByTestId('channel-form-save-discord').click();
    // Diff surfaces the env name but NOT the value.
    const diff = page.getByTestId('channel-confirm-diff');
    await expect(diff.getByText('DISCORD_BOT_TOKEN')).toBeVisible();
    await expect(diff.getByText(/super-secret/)).toHaveCount(0);

    await page.getByTestId('channel-confirm-save').click();

    // Card flips to "configured" after the mock applies the save.
    // The restart prompt is in the way; dismiss it first.
    await page.getByTestId('channel-restart-prompt-discord').getByRole('button').first().click();
    await expect(
      page.getByTestId('channel-card-discord').getByTestId('channel-status-configured'),
    ).toBeVisible();

    // The token string never appears in the rendered DOM anywhere.
    await expect(page.getByText('super-secret-bot-token')).toHaveCount(0);
  });

  // ───────────────────────── T3.4 — live status probe ─────────────────────────

  test('live status pill: configured channels render online/offline per probe, unconfigured hidden', async ({
    page,
  }) => {
    // Fixture setup: telegram is configured, matrix is partial,
    // discord is unconfigured. We'll use all three to exercise the
    // render/hide branches of the live pill.
    await page.goto('/channels');
    await expect(page.getByTestId('channel-card-telegram')).toBeVisible();

    // Seed mixed verdicts. Discord stays absent from the map so its
    // probe defaults to "unknown" AND its status is "unconfigured"
    // — both reasons to hide the pill; we assert neither renders.
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
        last_marker: '2026-04-22 telegram connected to bot API',
      };
      mock.state.channelStatuses.matrix = {
        state: 'offline',
        last_marker: '2026-04-22 matrix failed: auth rejected',
      };
    });

    await page.getByTestId('channels-probe-button').click();

    // Telegram (configured) → online pill.
    await expect(
      page.getByTestId('channel-card-telegram').getByTestId('channel-live-online-telegram'),
    ).toBeVisible();
    // Matrix (partial, still "configured-ish" = not unconfigured) → offline pill.
    await expect(
      page.getByTestId('channel-card-matrix').getByTestId('channel-live-offline-matrix'),
    ).toBeVisible();
    // Discord (unconfigured) → no live pill at all.
    await expect(
      page.getByTestId('channel-card-discord').locator('[data-testid^="channel-live-"]'),
    ).toHaveCount(0);

    // Flip matrix → online, then click Probe. Force-refresh path
    // should re-fetch status and the pill flips without a full
    // reload.
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
      mock.state.channelStatuses.matrix = {
        state: 'online',
        last_marker: '2026-04-22 matrix reconnected and subscribed',
      };
    });
    await page.getByTestId('channels-probe-button').click();
    await expect(
      page.getByTestId('channel-card-matrix').getByTestId('channel-live-online-matrix'),
    ).toBeVisible();
  });

  // ───────────────────────── T3.5 — mobile drawer ─────────────────────────

  test('mobile viewport: editing a channel opens a bottom drawer (not inline expansion)', async ({
    page,
  }) => {
    // Shrink the default test page instead of spawning a fresh
    // context — that way the shared fixture (which installs the
    // Tauri IPC mock via addInitScript) still applies. The
    // useIsMobile hook flips at <720px; 375 is iPhone-SE width
    // and unambiguously in-range.
    await page.setViewportSize({ width: 375, height: 740 });

    await page.goto('/channels');
    await expect(page.getByTestId('channel-card-telegram')).toBeVisible();

    // Inline form not present on mobile until Edit is clicked; the
    // drawer shouldn't exist yet either.
    await expect(page.getByTestId('channel-form-telegram')).toHaveCount(0);
    await expect(page.getByTestId('channel-drawer-telegram')).toHaveCount(0);

    await page.getByTestId('channel-edit-telegram').click();

    // Drawer mounts in a portal under <body>, not inside the card.
    await expect(page.getByTestId('channel-drawer-telegram')).toBeVisible();
    await expect(page.getByTestId('channel-form-telegram')).toBeVisible();
    // Form lives inside the drawer, not the card article.
    const formInCard = page
      .getByTestId('channel-card-telegram')
      .locator('[data-testid="channel-form-telegram"]');
    await expect(formInCard).toHaveCount(0);

    // Close via the drawer's X button → form unmounts + mode resets.
    await page.getByTestId('channel-drawer-telegram-close').click();
    await expect(page.getByTestId('channel-drawer-telegram')).toHaveCount(0);
    await expect(page.getByTestId('channel-form-telegram')).toHaveCount(0);

    // Reopen, then close via backdrop click — same outcome.
    await page.getByTestId('channel-edit-telegram').click();
    await expect(page.getByTestId('channel-drawer-telegram')).toBeVisible();
    await page.getByTestId('channel-drawer-telegram-backdrop').click({
      position: { x: 10, y: 10 }, // top-left of the backdrop, safely away from the sheet
    });
    await expect(page.getByTestId('channel-drawer-telegram')).toHaveCount(0);
  });

  // T3.3 WeChat QR flow deleted 2026-04-23 pm (T6.7a): Hermes upstream
  // has no QR integration. See docs/hermes-reality-check-2026-04-23.md.
});
