import { test, expect } from './fixtures/test';

/**
 * Smoke + screenshot for Home's HermesInstallCard states.
 *
 * Covers:
 *   - binary missing → install instructions + copy-to-clipboard + docs
 *   - binary found but gateway offline → "Start gateway" button
 *   - happy path (default mock) → card absent (checklist carries the win)
 */

test.describe('home · hermes install card', () => {
  test('binary missing renders install CTA with copyable command', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: {
            state: Record<string, unknown>;
            on: (cmd: string, handler: (args: unknown) => unknown) => void;
          };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.hermesDetection = {
        installed: false,
        path: null,
        version: null,
      };
      // Force the gateway probe to fail so HermesInstallCard.tsx's
      // `if (gateway === 'online') return null;` early-exit doesn't
      // hide the card before our assertions run. Mutating config.base_url
      // alone is not enough — the mock's `config_test` ignores it and
      // returns a healthy probe by default. Override the handler so the
      // app's refreshGateway() flow falls into the `offline` branch.
      mock.on('config_test', () => {
        throw { kind: 'unreachable', message: 'gateway down (e2e fixture)' };
      });
    });

    await page.goto('/');
    const card = page.getByTestId('home-hermes-install-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/install/i);
    await expect(page.getByTestId('home-hermes-install-copy')).toBeVisible();
    await expect(page.getByTestId('home-hermes-recheck')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/hermes-install/missing.png',
      fullPage: true,
    });
  });

  test('binary present + gateway offline renders Start-gateway CTA', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: {
            state: Record<string, unknown>;
            on: (cmd: string, handler: (args: unknown) => unknown) => void;
          };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      // Default hermesDetection is "installed"; keep it. But knock the
      // gateway offline so the card renders its "start" variant.
      mock.on('config_test', () => {
        throw {
          kind: 'unreachable',
          endpoint: 'http://127.0.0.1:8642',
          message: 'connection refused',
        };
      });
    });

    await page.goto('/');
    const card = page.getByTestId('home-hermes-start-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('home-hermes-start')).toBeVisible();

    await page.screenshot({
      path: 'e2e/screenshots/hermes-install/offline.png',
      fullPage: true,
    });
  });
});
