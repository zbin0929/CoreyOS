import { test as base, expect } from '@playwright/test';
import { tauriMockInitScript } from './tauri-mock';

/**
 * Custom `test` that wires the Tauri IPC mock into every page BEFORE any
 * app script runs. Use this instead of `@playwright/test`'s default `test`.
 *
 *     import { test, expect } from './fixtures/test';
 *     test('foo', async ({ page }) => { ... });
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Runs in the page context before any `<script>` evaluates, so the app's
    // top-level `import { invoke } from '@tauri-apps/api/core'` sees our
    // `window.__TAURI_INTERNALS__` and dispatches to the mock.
    await page.addInitScript({ content: tauriMockInitScript });
    await use(page);
  },
});

export { expect };
