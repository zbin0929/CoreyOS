import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

type CapturedMessage = { role: string; content: string };

/**
 * Pack Soul injection — smoke-test the enrichHistoryWithContext pipeline.
 *
 * Architectural contract under test:
 *   enabled Pack's soul.md content → unshift'd as a `system` message
 *   at the head of every chat_stream_start payload.
 *
 * Breakage here is a regression in one of:
 *   - src-tauri/src/ipc/pack/mod.rs:pack_active_souls
 *   - src/features/chat/enrichHistory.ts
 *   - src/features/chat/useChatSend.ts (finalHistory wiring)
 *
 * Strategy: install an init-script that (a) registers a
 * pack_active_souls override returning the fixture persona, and
 * (b) installs a chat_stream_start override that captures the
 * incoming messages array onto `window.__CAPTURED_HISTORY__` before
 * replaying the default streaming response. The test then drives
 * the UI and reads back what was captured.
 */

const CAPTURE_SCRIPT = (soulPayload: unknown[]) => `
(function () {
  function tryInstall() {
    var mock = window.__CADUCEUS_MOCK__;
    if (!mock) { return setTimeout(tryInstall, 10); }
    mock.on('pack_active_souls', function () {
      return ${JSON.stringify(soulPayload)};
    });
    mock.on('chat_stream_start', function (args, ctx) {
      window.__CAPTURED_HISTORY__ = args.args.messages;
      var h = args.args.handle;
      queueMicrotask(function () {
        ctx.emit('chat:delta:' + h, 'ok');
        setTimeout(function () {
          ctx.emit('chat:done:' + h, {
            finish_reason: 'stop',
            model: 'mock',
            latency_ms: 1,
            prompt_tokens: 1,
            completion_tokens: 1,
          });
        }, 5);
      });
      return h;
    });
  }
  tryInstall();
})();
`;

async function sendAndCapture(
  page: Page,
  soulPayload: unknown[],
): Promise<CapturedMessage[]> {
  await page.addInitScript({ content: CAPTURE_SCRIPT(soulPayload) });
  await page.goto('/chat');
  await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder(/Message|输入/i);
  await expect(composer).toBeVisible();
  await composer.fill('你是谁');
  await composer.press('Enter');

  // Wait for useChatSend → enrichHistoryWithContext → chat_stream_start.
  await page.waitForFunction(
    () => Array.isArray((window as any).__CAPTURED_HISTORY__),
    undefined,
    { timeout: 5000 },
  );
  return page.evaluate(
    () => (window as unknown as { __CAPTURED_HISTORY__: CapturedMessage[] }).__CAPTURED_HISTORY__,
  );
}

test.describe('pack soul injection', () => {
  test('enabled pack soul is unshifted into chat_stream_start history', async ({
    page,
  }) => {
    const history = await sendAndCapture(page, [
      {
        packId: 'cross_border_ecom',
        packTitle: '跨境电商运营顾问',
        content: '你是一位资深亚马逊跨境电商运营顾问，主营 Amazon FBA 美国站。',
      },
    ]);

    const soulHeader = history.find(
      (m: CapturedMessage) =>
        m.role === 'system' && m.content.startsWith('[Industry role definition]'),
    );
    expect(soulHeader, 'soul system message must be present in history').toBeTruthy();
    expect(soulHeader!.content).toContain('跨境电商运营顾问'); // packTitle
    expect(soulHeader!.content).toContain('亚马逊跨境电商运营顾问'); // body
  });

  test('no pack enabled → no soul header in history', async ({ page }) => {
    const history = await sendAndCapture(page, []);
    const soulHeader = history.find(
      (m: CapturedMessage) =>
        m.role === 'system' && m.content.startsWith('[Industry role definition]'),
    );
    expect(soulHeader).toBeFalsy();
  });
});
