import { test, expect } from './fixtures/test';

/**
 * T6.5 — per-agent sandbox isolation. Exercises the full user-facing
 * surface: Settings can CRUD scopes, each Hermes instance row picks a
 * scope, and the attachment_stage_path IPC refuses paths outside the
 * chosen scope.
 *
 * All assertions run against the mocked Tauri IPC layer in
 * `fixtures/tauri-mock.ts`. The mock mirrors the Rust invariants:
 *   - the `default` scope is always present and undeletable;
 *   - non-default scopes with 0 roots reject every path;
 *   - non-default scopes only allow paths under one of their roots.
 */

test.describe('T6.5 — sandbox scopes', () => {
  test('create, assign, enforce, delete — full loop', async ({ page }) => {
    await page.goto('/settings');

    // 1. Default scope is visible in the Sandbox Scopes section and
    //    its delete affordance is locked (shows a "Locked" badge
    //    rather than a trash button).
    const defaultRow = page.getByTestId('sandbox-scope-row-default');
    await expect(defaultRow).toBeVisible();
    await expect(defaultRow).toContainText('default');
    await expect(defaultRow).toContainText('Locked');
    await expect(
      page.getByTestId('sandbox-scope-delete-default'),
    ).toHaveCount(0);

    // 2. Create a new "worker" scope via the inline form.
    await page.getByTestId('sandbox-scope-new-id').fill('worker');
    await page.getByTestId('sandbox-scope-new-label').fill('Worker');
    await page.getByTestId('sandbox-scope-create').click();
    await expect(
      page.getByTestId('sandbox-scope-row-worker'),
    ).toBeVisible();

    // 3. Assign the worker scope to a new Hermes instance. T8 moved
    //    HermesInstancesSection to /agents, so nav there to reach
    //    the add button + per-row scope <select>. Client-side nav
    //    via the sidebar link keeps mock state in memory.
    await page.getByRole('link', { name: /Agents/ }).first().click();
    await page.getByTestId('hermes-instances-add').click();
    // Custom <Select> — click trigger, then click option by label.
    await page.getByTestId('hermes-instance-scope-new').click();
    await page.getByRole('option', { name: /Worker/ }).click();
    // T8 polish — the "Add instance" form now lives in a right-side
    // Drawer overlay. Dismiss it before nav so the backdrop doesn't
    // intercept the subsequent Settings link click.
    await page.keyboard.press('Escape');

    // 4. Pre-seed the mock so the IPC actually enforces. Without
    //    this, the mock would treat the worker scope as empty-roots
    //    (consent required) and every path would be denied — which
    //    happens to be the correct T6.5 default behaviour, but
    //    here we want to PROVE that adding a root opens things up.
    await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: {
              sandboxScopes: Array<{
                id: string;
                label: string;
                roots: Array<{ path: string; label: string; mode: string }>;
              }>;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      const worker = mock.state.sandboxScopes.find((s) => s.id === 'worker');
      if (worker) {
        worker.roots = [
          { path: '/workspace', label: 'Workspace', mode: 'read_write' },
        ];
      }
    });

    // 5. A path INSIDE the worker root is accepted.
    const insideOk = await page.evaluate(async () => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke;
      try {
        const r = await invoke('attachment_stage_path', {
          path: '/workspace/notes.txt',
          mimeHint: 'text/plain',
          sandboxScopeId: 'worker',
        });
        return { ok: true, r };
      } catch (e) {
        return { ok: false, e };
      }
    });
    expect(insideOk.ok).toBe(true);

    // 6. A path OUTSIDE the worker root (but inside the user's home
    //    — which a "default" scope with broad roots would allow)
    //    is rejected with SandboxConsentRequired. This is the core
    //    security property of T6.5.
    const outsideResult = await page.evaluate(async () => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke;
      try {
        await invoke('attachment_stage_path', {
          path: '/Users/someone/Documents/secret.pdf',
          mimeHint: 'application/pdf',
          sandboxScopeId: 'worker',
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, e };
      }
    });
    expect(outsideResult.ok).toBe(false);
    expect(outsideResult.e).toMatchObject({
      kind: 'sandbox_consent_required',
    });

    // 7. The same path through the DEFAULT scope is accepted (mock's
    //    default scope has no roots → dev-allow semantics), proving
    //    the enforcement is scope-specific, not universal.
    const defaultOk = await page.evaluate(async () => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke;
      try {
        await invoke('attachment_stage_path', {
          path: '/Users/someone/Documents/secret.pdf',
          mimeHint: 'application/pdf',
          // no sandboxScopeId → default scope
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, e };
      }
    });
    expect(defaultOk.ok).toBe(true);

    // 8. Delete the worker scope. Sandbox scopes live under /settings,
    //    so nav back (client-side) before clicking the trash button.
    //    JS confirm() is the default yes in Playwright unless
    //    intercepted; accept it so the delete proceeds to the IPC
    //    layer.
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('link', { name: /Settings|设置/ }).first().click();
    await page.getByTestId('sandbox-scope-delete-worker').click();
    await expect(
      page.getByTestId('sandbox-scope-row-worker'),
    ).toHaveCount(0);
  });
});
