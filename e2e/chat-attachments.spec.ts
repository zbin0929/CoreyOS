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

    // Bubble renders the attachment chip.
    const bubbleAttachments = page.getByTestId('bubble-attachments').first();
    await expect(bubbleAttachments).toBeVisible();
    await expect(bubbleAttachments).toContainText('screenshot.png');

    // The user bubble text includes the marker so the LLM sees it.
    await expect(page.getByText(/\[attached: screenshot\.png\]/).first()).toBeVisible();

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
    // Marker preserves order.
    await expect(
      page.getByText(/\[attached: a\.txt, b\.txt\]/).first(),
    ).toBeVisible();
  });
});
