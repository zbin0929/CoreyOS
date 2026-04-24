import { test, expect } from './fixtures/test';

/**
 * Phase 7 · T7.1 — MCP server manager.
 *
 * Smokes the full CRUD loop + restart-nudge:
 *   1. Empty state visible on a fresh mock.
 *   2. Add a stdio server → row appears, restart banner shows.
 *   3. Click restart → banner clears.
 *   4. Delete the server → row gone.
 *
 * `window.confirm` is stubbed out so the delete path doesn't hang
 * waiting for a native dialog the headless browser can't satisfy.
 */
test.describe('mcp server manager (T7.1)', () => {
  test('empty → add stdio → restart → delete round-trip', async ({ page }) => {
    // Auto-accept window.confirm before any code runs so the delete
    // confirmation never blocks the test.
    await page.addInitScript(() => {
      window.confirm = () => true;
    });

    await page.goto('/mcp');

    // Fresh state: empty message.
    await expect(page.getByText(/No MCP servers configured|还没有 MCP/)).toBeVisible();

    // Open the new-server form.
    await page.getByTestId('mcp-add').click();
    await expect(page.getByTestId('mcp-server-form')).toBeVisible();

    // Fill id + tweak the default stdio config to something concrete.
    await page.getByTestId('mcp-form-id').fill('project_fs');
    const cfg = page.getByTestId('mcp-form-config');
    await cfg.fill(
      JSON.stringify(
        {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/demo'],
        },
        null,
        2,
      ),
    );
    await page.getByTestId('mcp-form-save').click();

    // Row lands in the list; form closes.
    const row = page.getByTestId('mcp-server-row-project_fs');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('mcp-server-form')).toHaveCount(0);

    // Mock state reflects the write.
    const mcpStored = await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: { mcpServers: Record<string, unknown> };
          };
        }
      ).__CADUCEUS_MOCK__;
      return mock.state.mcpServers;
    });
    expect(mcpStored).toEqual({
      project_fs: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/demo'],
      },
    });

    // Restart nudge appears; "Restart now" clears it.
    await expect(page.getByTestId('mcp-restart-hint')).toBeVisible();
    await page.getByTestId('mcp-restart-now').click();
    await expect(page.getByTestId('mcp-restart-hint')).toHaveCount(0);

    // Delete: row is gone; restart hint comes back.
    await page.getByTestId('mcp-server-delete-project_fs').click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('mcp-restart-hint')).toBeVisible();

    const mcpAfter = await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: { mcpServers: Record<string, unknown> };
          };
        }
      ).__CADUCEUS_MOCK__;
      return mock.state.mcpServers;
    });
    expect(mcpAfter).toEqual({});
  });

  test('form rejects dotted ids inline before hitting the backend', async ({
    page,
  }) => {
    await page.goto('/mcp');
    await page.getByTestId('mcp-add').click();

    await page.getByTestId('mcp-form-id').fill('bad.id');
    // Save button disables while the id is invalid — the inline error
    // is the signal, no backend round-trip is attempted.
    await expect(page.getByTestId('mcp-form-save')).toBeDisabled();
    await expect(page.getByText(/cannot contain '\.'|不能包含/)).toBeVisible();
  });
});
