import { test, expect } from './fixtures/test';

/**
 * Chat flow — exercises the streaming IPC contract end-to-end against the
 * mocked gateway. Covers: compose → send → deltas stream in → "done"
 * callback fires → message bubble shows the full reply.
 */

test.describe('chat', () => {
  test('sending a message streams the mock reply into the bubble', async ({
    page,
  }) => {
    await page.goto('/chat');

    // Give the chat store a tick to finish hydrating (empty DB → fresh session).
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Find the composer textarea and send a prompt.
    const composer = page.getByPlaceholder(/Message|输入/i);
    await expect(composer).toBeVisible();
    await composer.fill('Say hi');
    await composer.press('Enter');

    // The user's own bubble should show up immediately.
    await expect(page.getByText('Say hi').first()).toBeVisible();

    // The mocked gateway emits the canned reply in two chunks; wait for the
    // full string to land in an assistant bubble.
    await expect(
      page.getByText('Hello from the mock gateway.', { exact: false }).first(),
    ).toBeVisible();
  });
});
