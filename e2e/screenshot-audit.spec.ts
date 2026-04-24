import { test } from './fixtures/test';

/**
 * Screenshot audit — not a regression test, not part of the default
 * `pnpm test:e2e` run. Navigates through every top-level page and
 * takes a full-page screenshot under `e2e/screenshots/audit/`.
 *
 * Run explicitly:
 *   pnpm playwright test screenshot-audit --reporter=list
 *
 * The screenshots feed a manual UX-audit pass: do empty states read
 * right? Is every page's header aligned? Any misaligned buttons?
 */

const ROUTES: Array<{ path: string; name: string; waitFor?: string }> = [
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

// Opt-in: run with `SCREENSHOT_AUDIT=1 pnpm playwright test screenshot-audit`.
// Skipped by default so regular suite runs stay fast.
test.describe('screenshot audit (not part of default run)', () => {
  test.skip(
    !process.env.SCREENSHOT_AUDIT,
    'Set SCREENSHOT_AUDIT=1 to run the full-page screenshot sweep.',
  );

  for (const route of ROUTES) {
    test(`${route.name} — ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      // Give stores a tick to hydrate + IPC to respond.
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `e2e/screenshots/audit/${route.name}.png`,
        fullPage: true,
      });
    });
  }
});
