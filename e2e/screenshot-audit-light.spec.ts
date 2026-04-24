import { test } from './fixtures/test';

/**
 * Light-theme screenshot audit. Flips `data-theme="light"` before each
 * route loads so every page renders under the light palette. Pairs with
 * screenshot-audit.spec.ts (dark, default).
 *
 * Opt-in:
 *   SCREENSHOT_AUDIT=1 pnpm playwright test screenshot-audit-light
 */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/', name: '01-home' },
  { path: '/chat', name: '02-chat' },
  { path: '/compare', name: '03-compare' },
  { path: '/skills', name: '04-skills' },
  { path: '/trajectory', name: '05-trajectory' },
  { path: '/analytics', name: '06-analytics' },
  { path: '/logs', name: '07-logs' },
  { path: '/terminal', name: '08-terminal' },
  { path: '/scheduler', name: '09-scheduler' },
  { path: '/channels', name: '10-channels' },
  { path: '/models', name: '11-models' },
  { path: '/profiles', name: '12-profiles' },
  { path: '/runbooks', name: '13-runbooks' },
  { path: '/budgets', name: '14-budgets' },
  { path: '/memory', name: '15-memory' },
  { path: '/mcp', name: '16-mcp' },
  { path: '/settings', name: '17-settings' },
];

test.describe('screenshot audit — light theme (not part of default run)', () => {
  test.skip(
    !process.env.SCREENSHOT_AUDIT,
    'Set SCREENSHOT_AUDIT=1 to run the light-theme screenshot sweep.',
  );

  test.beforeEach(async ({ page }) => {
    // Seed the persisted Zustand store so the app hydrates into light
    // mode without a flicker. `caduceus.ui` is the persist key set in
    // src/stores/ui.ts.
    await page.addInitScript(() => {
      localStorage.setItem(
        'caduceus.ui',
        JSON.stringify({
          state: { theme: 'light', sidebarCollapsed: false },
          version: 0,
        }),
      );
      document.documentElement.dataset.theme = 'light';
    });
  });

  for (const route of ROUTES) {
    test(`${route.name} — ${route.path} (light)`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `e2e/screenshots/audit-light/${route.name}.png`,
        fullPage: true,
      });
    });
  }
});
