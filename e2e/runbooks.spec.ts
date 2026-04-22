import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.6 — Runbooks.
 *
 * Covers: CRUD on the Runbooks page, palette integration (no-params
 * runbook drops straight into chat with the template pre-filled), and
 * param-fill dialog (params runbook navigates back to /runbooks for the
 * fill flow).
 */
test.describe('runbooks', () => {
  test('create → edit → delete round-trip via the Runbooks page', async ({
    page,
  }) => {
    await page.goto('/runbooks');
    // Empty state on first load.
    await expect(page.getByText(/No runbooks yet|还没有运行手册/)).toBeVisible();

    // Create.
    await page.getByTestId('runbooks-new').click();
    await expect(page.getByTestId('runbook-editor')).toBeVisible();
    await page.getByTestId('runbook-name').fill('daily-standup');
    await page.getByTestId('runbook-description').fill('Summarise notes');
    // The default template already has a `{{notes}}` placeholder.
    await page.getByTestId('runbook-save').click();

    // Row appears with name + 1-parameter pill.
    const row = page.locator('[data-testid^="runbook-row-"]').first();
    await expect(row.getByText('daily-standup')).toBeVisible();
    await expect(row.getByText('Summarise notes')).toBeVisible();
    await expect(row.getByText(/1 parameter|1 个参数/)).toBeVisible();

    // Edit — rename.
    const editBtn = row.locator('[data-testid^="runbook-edit-"]');
    await editBtn.click();
    await expect(page.getByTestId('runbook-editor')).toBeVisible();
    await page.getByTestId('runbook-name').fill('daily-standup-v2');
    await page.getByTestId('runbook-save').click();
    await expect(
      page.locator('[data-testid^="runbook-row-"]').first().getByText('daily-standup-v2'),
    ).toBeVisible();

    // Delete.
    const delBtn = page
      .locator('[data-testid^="runbook-row-"]')
      .first()
      .locator('[data-testid^="runbook-delete-"]');
    await delBtn.click();
    await expect(page.getByText(/No runbooks yet|还没有运行手册/)).toBeVisible();
  });

  test('using a param-less runbook drops straight into Chat with the template as-is', async ({
    page,
  }) => {
    // Seed one without placeholders so the palette path skips the param dialog.
    await page.addInitScript(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__?: { state: { runbooks: unknown[] } } }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.runbooks = [
        {
          id: 'rb-seed',
          name: 'ping',
          description: 'sanity check',
          template: 'Hello, are you there?',
          scope_profile: null,
          created_at: 1,
          updated_at: 1,
        },
      ];
    });
    await page.goto('/runbooks');

    // "Use" on the row → param-less runbook takes us straight to /chat
    // with the template pre-filled in the composer.
    await page.getByTestId('runbook-use-rb-seed').click();
    await expect(page).toHaveURL(/\/chat/);
    await expect(
      page.locator('textarea[placeholder*="Hermes"]'),
    ).toHaveValue('Hello, are you there?');
  });

  test('using a param-ful runbook shows the fill-form and renders the template', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as { __CADUCEUS_MOCK__?: { state: { runbooks: unknown[] } } }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.runbooks = [
        {
          id: 'rb-summary',
          name: 'summary',
          description: null,
          template: 'Summarise: {{topic}}\n\nTone: {{tone}}',
          scope_profile: null,
          created_at: 1,
          updated_at: 1,
        },
      ];
    });
    await page.goto('/runbooks');

    await page.getByTestId('runbook-use-rb-summary').click();
    await expect(page.getByTestId('runbook-run-dialog')).toBeVisible();

    // Launch is disabled until all params are filled.
    await expect(page.getByTestId('runbook-launch')).toBeDisabled();

    await page.getByTestId('runbook-param-topic').fill('react hooks');
    await page.getByTestId('runbook-param-tone').fill('friendly');

    await page.getByTestId('runbook-launch').click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(
      page.locator('textarea[placeholder*="Hermes"]'),
    ).toHaveValue('Summarise: react hooks\n\nTone: friendly');
  });
});
