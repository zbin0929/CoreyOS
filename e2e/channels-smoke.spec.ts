import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';

/**
 * T6.7c — end-to-end smoke tests for the remaining five channels.
 *
 * One test per channel: walk the full
 *   unconfigured → fill required env keys → diff → save → restart →
 *   live-status online → status pill flips to configured
 * loop using the mocked Tauri IPC. Complements T6.7b's
 * `telegram-smoke.spec.ts` which covers the same loop for Telegram.
 *
 * All five channels are defined in `e2e/fixtures/tauri-mock.ts` with
 * `env_present` starting false so the cards begin unconfigured in
 * every run — no per-test reset needed.
 */

interface SmokeChannel {
  id: string;
  /** Display name regex — used only to sanity-check the card header,
   *  so that a typo in `id` vs `display_name` in the fixture is
   *  caught here rather than silently passing. */
  displayName: RegExp;
  /** Env keys the test fills. Each entry gets a plausible non-empty
   *  value so the backend considers it configured; non-required keys
   *  are filled too when it makes the resulting channel fully
   *  configured, matching how a real user would typically set up the
   *  integration. */
  envKeysToFill: Array<{ name: string; value: string }>;
}

const CHANNELS: SmokeChannel[] = [
  {
    id: 'discord',
    displayName: /Discord/,
    envKeysToFill: [
      { name: 'DISCORD_BOT_TOKEN', value: 'MT-discord-bot-token-example-xxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'slack',
    displayName: /Slack/,
    // Slack's real deployment uses Socket Mode which requires BOTH
    // the bot and app tokens — fill both so the post-save state
    // represents a working Socket Mode setup.
    envKeysToFill: [
      { name: 'SLACK_BOT_TOKEN', value: 'xoxb-slack-bot-token-example-00000000-00000000-xxxxxxxxxxxxxxxxxxxxxxxx' },
      { name: 'SLACK_APP_TOKEN', value: 'xapp-slack-app-token-example-0-A0000000000-0000000000000-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'feishu',
    displayName: /Feishu|Lark/,
    envKeysToFill: [
      { name: 'FEISHU_APP_ID', value: 'cli_feishu_app_id_example' },
      { name: 'FEISHU_APP_SECRET', value: 'feishu-app-secret-example-0000000000000000' },
    ],
  },
  {
    id: 'weixin',
    displayName: /WeiXin/,
    envKeysToFill: [
      { name: 'WEIXIN_ACCOUNT_ID', value: 'corey_bot' },
      { name: 'WEIXIN_TOKEN', value: 'weixin-token-example-0000000000000000000000000000' },
    ],
  },
  {
    id: 'wecom',
    displayName: /WeCom/,
    envKeysToFill: [
      { name: 'WECOM_BOT_ID', value: 'corey-wecom-bot' },
      { name: 'WECOM_SECRET', value: 'wecom-secret-example-0000000000000000000000000000' },
    ],
  },
];

/**
 * Drive the full configure-save-restart-online loop for one channel
 * and make the channel-agnostic assertions. Each spec calls this
 * with its own `SmokeChannel` so the test bodies stay tiny + the
 * failure message points at the specific channel that regressed.
 */
async function runSmoke(page: Page, c: SmokeChannel) {
  await page.goto('/channels');
  // Wait for the mock init script before touching window state.
  // Matches the pattern `telegram-smoke.spec.ts` uses.
  await page.waitForFunction(() => {
    return typeof (
      window as unknown as { __CADUCEUS_MOCK__?: unknown }
    ).__CADUCEUS_MOCK__ !== 'undefined';
  });

  // Seed an "offline" live-status verdict so the later online flip
  // is observable as a real transition, not a coincidence of initial
  // state.
  await page.evaluate((id: string) => {
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
    mock.state.channelStatuses[id] = {
      state: 'offline',
      last_marker: `2026-04-23 ${id}: no credentials configured`,
    };
  }, c.id);

  // The fixture ships all T6.7c channels pre-unconfigured; no reset
  // needed. Refresh so the just-seeded live-status is picked up.
  await page.getByTestId('channels-refresh-button').click();

  const card = page.getByTestId(`channel-card-${c.id}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(c.displayName);
  await expect(card.getByTestId('channel-status-unconfigured')).toBeVisible();

  // Open the editor, fill each env key.
  await card.getByTestId(`channel-edit-${c.id}`).click();
  await expect(page.getByTestId(`channel-form-${c.id}`)).toBeVisible();

  for (const kv of c.envKeysToFill) {
    await page
      .getByTestId(`channel-env-input-${c.id}-${kv.name}`)
      .fill(kv.value);
  }

  // Submit → diff panel surfaces each env key name but NEVER the
  // value. Check every (key, value) pair explicitly so a single
  // channel leaking one secret is caught.
  await page.getByTestId(`channel-form-save-${c.id}`).click();
  const diff = page.getByTestId('channel-confirm-diff');
  await expect(diff).toBeVisible();
  for (const kv of c.envKeysToFill) {
    await expect(diff.getByText(kv.name)).toBeVisible();
    await expect(page.getByText(kv.value)).toHaveCount(0);
  }

  // Confirm the save.
  await page.getByTestId('channel-confirm-save').click();
  await expect(page.getByTestId(`channel-restart-prompt-${c.id}`)).toBeVisible();

  // Assert the captured save payload matches what we typed, verbatim,
  // for every env key.
  const saves = await page.evaluate(() => {
    return (
      window as unknown as {
        __CADUCEUS_MOCK__: { state: { channelSaves: unknown[] } };
      }
    ).__CADUCEUS_MOCK__.state.channelSaves;
  });
  expect(saves.length).toBeGreaterThanOrEqual(1);
  const last = saves[saves.length - 1] as {
    id: string;
    env_updates: Record<string, string>;
  };
  expect(last.id).toBe(c.id);
  for (const kv of c.envKeysToFill) {
    expect(last.env_updates[kv.name]).toBe(kv.value);
  }

  // Flip live-status to online before restarting — the gateway
  // restart itself is mocked and doesn't touch status state, so the
  // probe after restart will see the new verdict.
  await page.evaluate((id: string) => {
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
    mock.state.channelStatuses[id] = {
      state: 'online',
      last_marker: `2026-04-23 ${id}: connected`,
    };
  }, c.id);

  await page.getByTestId(`channel-restart-confirm-${c.id}`).click();

  // Status pill flips to configured, probe flips to online.
  await expect(card.getByTestId('channel-status-configured')).toBeVisible();
  await page.getByTestId('channels-probe-button').click();
  await expect(card.getByTestId(`channel-live-online-${c.id}`)).toBeVisible();

  // No secret value leaked anywhere in the rendered DOM at any point.
  for (const kv of c.envKeysToFill) {
    await expect(page.getByText(kv.value)).toHaveCount(0);
  }
}

test.describe('T6.7c — channel smoke tests', () => {
  for (const c of CHANNELS) {
    test(`${c.id}: configure → save → restart → online`, async ({ page }) => {
      await runSmoke(page, c);
    });
  }
});
