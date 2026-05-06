import { test, expect } from './fixtures/test';

/**
 * B-10.7 Settings · Webhook section.
 *
 * Renders URL + masked token + curl example, all driven by the
 * tauri-mock state. We don't drive a real HTTP request through the
 * mock — that's covered by the Rust unit tests in
 * `mcp_server::webhook::tests`.
 */
test('settings webhook section renders URL, token, and curl example', async ({ page }) => {
  await page.goto('/settings');
  const section = page.locator('#settings-webhook');
  await expect(section).toBeVisible();
  // Heading
  await expect(section.getByRole('heading', { name: 'Webhook 触发器' })).toBeVisible();
  // URL block — there are multiple matches (URL + curl), so just assert at least one.
  await expect(section.getByText(/127\.0\.0\.1:49081\/webhook/).first()).toBeVisible();
  // curl example body (only present once, in the curl block).
  await expect(section.getByText(/Authorization: Bearer/)).toBeVisible();
  // Rotate button reachable.
  await expect(section.getByTestId('webhook-rotate')).toBeVisible();
});

test('rotate token button refreshes the displayed token', async ({ page }) => {
  await page.goto('/settings');
  const section = page.locator('#settings-webhook');
  await section.getByTestId('webhook-rotate').click();
  // After rotation, the new mocked token appears in the curl example
  // (curl block prints the token in plaintext, not the masked field).
  await expect(
    section.getByText(/00000000-0000-0000-0000-000000000001/).first(),
  ).toBeVisible();
});
