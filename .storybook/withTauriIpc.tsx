import type { Decorator } from '@storybook/react';

import { tauriMockInitScript } from '../e2e/fixtures/tauri-mock';

/**
 * Storybook decorator that injects the same in-memory `__TAURI_INTERNALS__`
 * mock the Playwright suite uses, so `feature/**` components that
 * import IPC helpers (or read stores hydrated from IPC) render
 * without a "tauri internals not available" error.
 *
 * Mounting strategy mirrors the e2e harness:
 *  1. The mock is a self-contained IIFE serialised into a string at
 *     `e2e/fixtures/tauri-mock.ts` — Playwright injects it via
 *     `page.addInitScript`.
 *  2. Storybook has no `addInitScript`, so we eval the IIFE once on
 *     module load (BEFORE the first story renders). It's
 *     idempotent — calling it twice just rebuilds the empty
 *     listener / fixture maps.
 *  3. Components keep using `@tauri-apps/api/core::invoke()`
 *     unchanged; the mock dispatches by command name and returns
 *     the same shapes the production gateway would.
 *
 * If a feature component dispatches a command the mock doesn't
 * implement, it'll get an `unknown ipc command` rejection in dev
 * tools — exactly the same diagnostic you'd see in e2e. Add the
 * handler to `e2e/fixtures/tauri-mock.ts` so both harnesses stay
 * in lockstep.
 *
 * Side-effect-only import for `src/lib/i18n` is missing on purpose:
 * the package's `init()` runs on its first import inside any story,
 * so importing it from `preview.ts` keeps boot order obvious without
 * coupling this decorator to translation state.
 */
let installed = false;
function installMockOnce() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    // The script is a backtick-string IIFE that closes over a fresh
    // listener / callback registry. `new Function` avoids the
    // strict-CSP gotchas of a top-level `eval()` and keeps the
    // bundler from trying to statically resolve names inside the
    // template.
    new Function(tauriMockInitScript)();
  } catch (e) {
    // Surfaced once in the Storybook dev console — any feature
    // story that depends on IPC will then explicitly fail in its
    // own render path, which is the right signal for "the mock
    // surface is missing a command".
    console.error('[storybook] tauri mock failed to install', e);
  }
}

export const withTauriIpc: Decorator = (Story) => {
  installMockOnce();
  return Story();
};
