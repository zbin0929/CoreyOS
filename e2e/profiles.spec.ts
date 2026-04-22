import { test, expect } from './fixtures/test';

/**
 * T2.7 — Hermes profile management. Backed by pure filesystem ops on
 * the Rust side; this spec drives the UI against the mock which keeps
 * `state.profiles` as a mutable array so create/rename/delete/clone
 * round-trip through the same list the UI rereads.
 *
 * Unit coverage for name validation, missing-root, cloning, etc. lives
 * in `src-tauri/src/hermes_profiles.rs::tests`.
 */

test.describe('profiles', () => {
  test('list shows active + non-active with delete disabled on active', async ({ page }) => {
    await page.goto('/profiles');

    await expect(page.getByTestId('profile-card-dev')).toBeVisible();
    await expect(page.getByTestId('profile-card-prod')).toBeVisible();

    // Active pill rendered on the active card.
    await expect(
      page.getByTestId('profile-card-dev').getByText(/Active|使用中/),
    ).toBeVisible();

    // Can't delete the active profile — button is disabled.
    await expect(page.getByTestId('profile-action-delete-dev')).toBeDisabled();
    // Non-active profile's delete is enabled.
    await expect(page.getByTestId('profile-action-delete-prod')).toBeEnabled();
  });

  test('create → clone → rename → delete lifecycle', async ({ page }) => {
    await page.goto('/profiles');

    // CREATE.
    await page.getByTestId('profiles-new').click();
    await page.getByTestId('profiles-new-input').fill('staging');
    await page.getByRole('button', { name: /^Create$|^创建$/ }).click();
    await expect(page.getByTestId('profile-card-staging')).toBeVisible();

    // CLONE `staging` → `staging-copy`. The default prefill is
    // `<name>-copy`, so we just submit.
    await page.getByTestId('profile-action-clone-staging').click();
    await page.getByRole('button', { name: /^OK$|^确定$/ }).first().click();
    await expect(page.getByTestId('profile-card-staging-copy')).toBeVisible();

    // RENAME `staging-copy` → `staging-clone2`.
    await page.getByTestId('profile-action-rename-staging-copy').click();
    // The rename form prefills with the current name; clear + retype.
    const renameInput = page.getByRole('textbox').last();
    await renameInput.fill('staging-clone2');
    await page.getByRole('button', { name: /^OK$|^确定$/ }).first().click();
    await expect(page.getByTestId('profile-card-staging-clone2')).toBeVisible();
    await expect(page.getByTestId('profile-card-staging-copy')).toHaveCount(0);

    // DELETE `staging-clone2`. Two-step: click trash, then confirm.
    await page.getByTestId('profile-action-delete-staging-clone2').click();
    await page
      .getByTestId('profile-action-delete-confirm-staging-clone2')
      .click();
    await expect(page.getByTestId('profile-card-staging-clone2')).toHaveCount(0);
  });

  test('duplicate name surfaces the backend error inline', async ({ page }) => {
    await page.goto('/profiles');

    await page.getByTestId('profiles-new').click();
    await page.getByTestId('profiles-new-input').fill('dev'); // already exists
    await page.getByRole('button', { name: /^Create$|^创建$/ }).click();

    // Error text from the mock: "profile already exists: dev".
    await expect(page.getByText(/already exists/)).toBeVisible();
    // The form stays open so the user can correct and retry.
    await expect(page.getByTestId('profiles-new-input')).toBeVisible();
  });
});
