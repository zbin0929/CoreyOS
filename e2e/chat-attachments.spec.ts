import { test, expect } from './fixtures/test';

/**
 * Phase 1 · T1.5 — Chat attachments.
 *
 * The real attachment_stage_blob IPC writes bytes to disk; the mock
 * synthesises metadata from the args. Either way the UI round-trip is
 * the same: pick/paste → chip appears → send → bubble carries the chip
 * → the LLM request body includes an `[attached: …]` marker.
 */
test.describe('chat attachments', () => {
  test('file picker → chip appears → send → bubble shows chip', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Drive the hidden <input type="file"> directly. Playwright supports
    // attaching an in-memory buffer via `setInputFiles`.
    const input = page.getByTestId('chat-file-input');
    await input.setInputFiles({
      name: 'screenshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from('\x89PNG\r\n\x1a\n-fake-body', 'binary'),
    });

    // Chip appears in the composer.
    const chips = page.getByTestId('chat-attachment-chips');
    await expect(chips).toBeVisible();
    await expect(chips).toContainText('screenshot.png');

    // Typing is optional; we should be able to send with ONLY an attachment.
    const composer = page.getByPlaceholder(/Message|输入/i);
    await composer.fill('look at this');
    await page.getByTestId('chat-send').click();

    // Bubble renders the attachment. T1.5d — images now display as a
    // thumbnail `<img>` tile (filename lives on the alt/title attrs),
    // non-images still render as a filename chip. Assert the image-tile
    // variant appeared for this PNG attachment.
    const bubbleAttachments = page.getByTestId('bubble-attachments').first();
    await expect(bubbleAttachments).toBeVisible();
    const thumb = bubbleAttachments.locator('img[alt="screenshot.png"]');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('src', /^data:image\/png;base64,/);

    // T1.5b — the bubble no longer prepends `[attached: …]` to the text.
    // The user's typed content is stored verbatim; the LLM receives the
    // attachment as a proper multimodal `image_url` part instead.
    await expect(page.getByText('look at this').first()).toBeVisible();
    await expect(page.getByText(/\[attached: screenshot\.png\]/)).toHaveCount(0);

    // After send, the pending chip row is cleared.
    await expect(page.getByTestId('chat-attachment-chips')).toHaveCount(0);
  });

  test('remove-chip clears a pending attachment without sending', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    await page.getByTestId('chat-file-input').setInputFiles({
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });
    const chips = page.getByTestId('chat-attachment-chips');
    await expect(chips).toContainText('doc.pdf');

    // The × button lives inside the chip with aria-label "Remove doc.pdf".
    await page.getByRole('button', { name: 'Remove doc.pdf' }).click();
    await expect(page.getByTestId('chat-attachment-chips')).toHaveCount(0);
  });

  test('sending two attachments at once lists both in the bubble', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    await page.getByTestId('chat-file-input').setInputFiles([
      {
        name: 'a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('alpha'),
      },
      {
        name: 'b.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('bravo'),
      },
    ]);
    await expect(page.getByTestId('chat-attachment-chips')).toContainText('a.txt');
    await expect(page.getByTestId('chat-attachment-chips')).toContainText('b.txt');

    await page.getByPlaceholder(/Message|输入/i).fill('two files');
    await page.getByTestId('chat-send').click();

    const bubble = page.getByTestId('bubble-attachments').first();
    await expect(bubble).toContainText('a.txt');
    await expect(bubble).toContainText('b.txt');
    // T1.5b — the text body is the user's input only; filenames live
    // exclusively in the chip row, not interpolated into the content.
    await expect(page.getByText('two files').first()).toBeVisible();
    await expect(page.getByText(/\[attached: a\.txt, b\.txt\]/)).toHaveCount(0);
  });

  test('T1.5c: vision warning appears when a text-only model has a pending image', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // The mock's currentModel is `deepseek-chat` — the visionSupport
    // heuristic deny-lists that, so attaching an image should surface
    // the warning banner without blocking the attach flow itself.
    await page.getByTestId('chat-file-input').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('PNG-fake'),
    });
    await expect(page.getByTestId('chat-vision-warning')).toBeVisible();
    await expect(page.getByTestId('chat-vision-warning')).toContainText(
      /deepseek-chat/i,
    );
    // The Paperclip button's data-attr also carries the tri-state.
    await expect(page.getByTestId('chat-attach-button')).toHaveAttribute(
      'data-vision-support',
      'no',
    );

    // Removing the image clears the warning (no pending image left).
    await page
      .getByTestId('chat-attachment-chips')
      .getByRole('button', { name: /Remove/i })
      .first()
      .click();
    await expect(page.getByTestId('chat-attachment-chips')).toHaveCount(0);
    await expect(page.getByTestId('chat-vision-warning')).toHaveCount(0);
  });

  test('T1.5b: outgoing IPC payload carries the attachments array', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Intercept chat_stream_start via the test override hook so we can
    // assert the wire shape. The default mock just drives a canned reply;
    // ours captures the args, then delegates back to the default behaviour
    // by calling `emit` with a fake done frame so the UI doesn't hang.
    await page.evaluate(() => {
      const mock = (window as unknown as { __CADUCEUS_MOCK__: any }).__CADUCEUS_MOCK__;
      mock.on('chat_stream_start', (args: any) => {
        (window as any).__CAPTURED_CHAT_ARGS__ = args.args;
        const h = args.args.handle;
        const delta = 'plugin:event|listen';
        void delta;
        setTimeout(() => {
          mock.emit('chat:delta:' + h, 'ok');
          mock.emit('chat:done:' + h, {
            finish_reason: 'stop',
            model: 'test',
            latency_ms: 0,
            prompt_tokens: null,
            completion_tokens: null,
          });
        }, 10);
        return h;
      });
    });

    await page.getByTestId('chat-file-input').setInputFiles({
      name: 'cat.png',
      mimeType: 'image/png',
      buffer: Buffer.from('PNG-fake'),
    });
    await page.getByPlaceholder(/Message|输入/i).fill('what is this');
    await page.getByTestId('chat-send').click();

    // Wait for the stream to drain (done handler fires above).
    await expect(page.getByText('ok').first()).toBeVisible();

    const captured = await page.evaluate(
      () => (window as any).__CAPTURED_CHAT_ARGS__,
    );
    // The messages array should include the user turn with an attachments
    // entry. Earlier turns (if any) won't have attachments.
    const last = captured.messages[captured.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('what is this');
    expect(Array.isArray(last.attachments)).toBe(true);
    expect(last.attachments).toHaveLength(1);
    expect(last.attachments[0]).toMatchObject({
      name: 'cat.png',
      mime: 'image/png',
    });
    expect(typeof last.attachments[0].path).toBe('string');
  });
});
