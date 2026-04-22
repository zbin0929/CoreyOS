import { test, expect } from './fixtures/test';

test.describe('chat budget gate (T4.4b)', () => {
  test('sends proceed with no active budgets (happy path)', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Track whether the native confirm dialog fires — it MUST NOT when
    // no budgets are configured. Default auto-dismiss just in case, so
    // a spurious dialog surfaces as a captured flag rather than hanging.
    let dialogFired = false;
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss();
    });

    await page.getByPlaceholder(/Message|输入/i).fill('plain turn');
    await page.getByTestId('chat-send').click();

    await expect(page.getByText('plain turn').first()).toBeVisible();
    // Let any pending dialog settle.
    await page.waitForTimeout(100);
    expect(dialogFired).toBe(false);
    await expect(page.getByTestId('chat-budget-warning')).toHaveCount(0);
  });

  test('notify-only breach surfaces inline, does not block', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    // Seed a notify-only budget at 1¢ — way under the ~27¢ of lifetime
    // spend the default analytics fixture reports.
    await page.evaluate(() => {
      (window as unknown as { __CADUCEUS_MOCK__: any }).__CADUCEUS_MOCK__.state.budgets = [
        {
          id: 'b-warn',
          scope_kind: 'global',
          scope_value: null,
          amount_cents: 1,
          period: 'month',
          action_on_breach: 'notify',
          created_at: 0,
          updated_at: 0,
        },
      ];
    });

    let dialogFired = false;
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss();
    });

    await page.getByPlaceholder(/Message|输入/i).fill('notify send');
    await page.getByTestId('chat-send').click();

    await expect(page.getByTestId('chat-budget-warning')).toBeVisible();
    await expect(page.getByTestId('chat-budget-warning')).toContainText(
      /global/i,
    );
    // The send went through — user message is in the bubble list.
    await expect(page.getByText('notify send').first()).toBeVisible();
    await page.waitForTimeout(100);
    expect(dialogFired).toBe(false);
  });

  test('block-action budget raises a confirm dialog; cancel aborts', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __CADUCEUS_MOCK__: any }).__CADUCEUS_MOCK__.state.budgets = [
        {
          id: 'b-block',
          scope_kind: 'global',
          scope_value: null,
          amount_cents: 1,
          period: 'month',
          action_on_breach: 'block',
          created_at: 0,
          updated_at: 0,
        },
      ];
    });

    // Dismiss the confirm → send must abort. The message text MUST NOT
    // appear in the bubble list.
    let seenDialog = '';
    page.on('dialog', (d) => {
      seenDialog = d.message();
      void d.dismiss();
    });

    await page.getByPlaceholder(/Message|输入/i).fill('blocked send');
    await page.getByTestId('chat-send').click();

    await page.waitForTimeout(150);
    expect(seenDialog).toContain('over cap');
    expect(seenDialog).toContain('global');

    // No USER bubble for the aborted send — look for an `msg-user`
    // role container rather than raw text (the composer textarea still
    // holds the string since we aborted before clearing).
    await expect(
      page.locator('[data-testid^="msg-"]:has-text("blocked send")'),
    ).toHaveCount(0);
    // And the textarea kept the draft so the user can reconsider /
    // switch model / shrink the send without retyping.
    await expect(page.getByPlaceholder(/Message|输入/i)).toHaveValue(
      'blocked send',
    );
  });

  test('block-action budget with confirm ACCEPTED proceeds with send', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __CADUCEUS_MOCK__: any }).__CADUCEUS_MOCK__.state.budgets = [
        {
          id: 'b-block-ok',
          scope_kind: 'global',
          scope_value: null,
          amount_cents: 1,
          period: 'month',
          action_on_breach: 'notify_block',
          created_at: 0,
          updated_at: 0,
        },
      ];
    });

    page.on('dialog', (d) => {
      void d.accept();
    });

    await page.getByPlaceholder(/Message|输入/i).fill('accepted send');
    await page.getByTestId('chat-send').click();

    // Send went through — bubble list contains the message.
    await expect(page.getByText('accepted send').first()).toBeVisible();
    // notify_block also populates the warn banner since `notify` is
    // one of its two halves.
    await expect(page.getByTestId('chat-budget-warning')).toBeVisible();
  });
});
