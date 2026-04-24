import { test, expect } from './fixtures/test';

/**
 * Phase 7 · T7.4 — Skill hub browser.
 *
 * Smokes the thin wrapper around `hermes skills browse / install`.
 * The mock echoes the invocation args back as stdout so the test
 * asserts on BOTH the UI rendering and the command Corey actually
 * constructed.
 */
test.describe('skill hub (T7.4)', () => {
  test('browse default source → output rendered with exit status', async ({
    page,
  }) => {
    await page.goto('/skills');
    // Switch to hub tab.
    await page.getByTestId('skills-tab-hub').click();
    await expect(page.getByTestId('skill-hub-panel')).toBeVisible();

    // Default source is "official", no query → browse.
    await page.getByTestId('skill-hub-browse').click();

    // Output section appears with the echoed command and stdout.
    await expect(page.getByTestId('skill-hub-output')).toBeVisible();
    await expect(page.getByTestId('skill-hub-status')).toHaveText(/exit 0/);
    await expect(page.getByTestId('skill-hub-stdout')).toContainText(
      'hermes skills browse --source official',
    );
  });

  test('search switches the subcommand + passes --source', async ({ page }) => {
    await page.goto('/skills');
    await page.getByTestId('skills-tab-hub').click();

    // Pick a non-default source + query. The Select is a custom
    // combobox (role=combobox) — open it, then click the option by
    // its accessible name.
    await page.getByTestId('skill-hub-source').click();
    await page.getByRole('option', { name: 'skills-sh' }).click();
    await page.getByTestId('skill-hub-query').fill('react');
    await page.getByTestId('skill-hub-browse').click();

    await expect(page.getByTestId('skill-hub-stdout')).toContainText(
      'hermes skills search react --source skills-sh',
    );
  });

  test('install invokes install subcommand with the slug', async ({ page }) => {
    await page.goto('/skills');
    await page.getByTestId('skills-tab-hub').click();

    await page
      .getByTestId('skill-hub-install-slug')
      .fill('official/security/1password');
    await page.getByTestId('skill-hub-install').click();

    await expect(page.getByTestId('skill-hub-stdout')).toContainText(
      'hermes skills install official/security/1password',
    );
  });

  test('CLI-missing state shows a clear install hint', async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            on: (cmd: string, h: () => unknown) => void;
          };
        }
      ).__CADUCEUS_MOCK__;
      // Override the handler so every call reports CLI-not-found.
      mock.on('skill_hub_exec', () => ({
        stdout: '',
        stderr: 'hermes CLI not found on PATH',
        status: -1,
        cli_available: false,
      }));
    });
    await page.goto('/skills');
    await page.getByTestId('skills-tab-hub').click();
    await page.getByTestId('skill-hub-browse').click();

    await expect(page.getByTestId('skill-hub-cli-missing')).toBeVisible();
  });
});
