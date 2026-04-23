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

  test('activate: click Activate on non-active profile → confirm modal → flips active badge', async ({
    page,
  }) => {
    await page.goto('/profiles');

    // Initial state: dev is active, prod is not. The Activate button
    // should only render on the non-active card.
    await expect(page.getByTestId('profile-action-activate-dev')).toHaveCount(0);
    await expect(page.getByTestId('profile-action-activate-prod')).toBeVisible();

    // Open the confirm modal; it should render `dev → prod` and the
    // gateway-restart toggle on by default.
    await page.getByTestId('profile-action-activate-prod').click();
    await expect(page.getByTestId('profiles-activate-modal')).toBeVisible();
    await expect(page.getByTestId('profiles-activate-modal')).toContainText(/dev/);
    await expect(page.getByTestId('profiles-activate-modal')).toContainText(/prod/);
    await expect(
      page.getByTestId('profiles-activate-restart-toggle'),
    ).toBeChecked();

    // Uncheck the restart so the test doesn't also rely on the
    // gateway-restart mock path (the mock accepts it, but the more
    // we assert here the flakier the test gets).
    await page.getByTestId('profiles-activate-restart-toggle').uncheck();

    // Confirm → modal closes, prod becomes the active card, dev
    // loses its pill.
    await page.getByTestId('profiles-activate-confirm').click();
    await expect(page.getByTestId('profiles-activate-modal')).toHaveCount(0);
    await expect(
      page.getByTestId('profile-card-prod').getByText(/Active|使用中/),
    ).toBeVisible();
    await expect(page.getByTestId('profile-action-activate-prod')).toHaveCount(0);
    // dev is no longer active → its Activate button materialises.
    await expect(page.getByTestId('profile-action-activate-dev')).toBeVisible();
  });

  test('import a .tar.gz: preview shows manifest; confirm adds the card; overwrite path prompts', async ({
    page,
  }) => {
    await page.goto('/profiles');

    // Stage the file the Import button is about to receive. The mock's
    // import-preview handler recognises the `PROFILE_ARCHIVE_FIXTURE:`
    // sentinel + echoes the name back through the manifest — so
    // picking a file named `work.tar.gz` whose body encodes
    // "PROFILE_ARCHIVE_FIXTURE:work" drops us into a preview dialog
    // for a profile called `work`.
    const sentinel = 'PROFILE_ARCHIVE_FIXTURE:work';
    await page.getByTestId('profiles-import').click();
    await page
      .getByTestId('profiles-import-input')
      .setInputFiles({ name: 'work.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from(sentinel) });

    // Preview modal renders the manifest + file tally.
    await expect(page.getByTestId('profiles-import-modal')).toBeVisible();
    await expect(page.getByTestId('profiles-import-target-name')).toHaveValue('work');
    await expect(page.getByTestId('profiles-import-modal')).toContainText(/3/); // file_count

    // Confirm → new card appears.
    await page.getByTestId('profiles-import-confirm').click();
    await expect(page.getByTestId('profile-card-work')).toBeVisible();

    // Re-importing the same archive with an unchanged target should
    // trip the overwrite prompt — the backend refuses by default.
    await page.getByTestId('profiles-import').click();
    await page
      .getByTestId('profiles-import-input')
      .setInputFiles({ name: 'work.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from(sentinel) });
    await page.getByTestId('profiles-import-confirm').click();
    await expect(page.getByTestId('profiles-import-confirm-overwrite')).toBeVisible();

    // Accept the overwrite → one card still named `work`.
    await page.getByTestId('profiles-import-confirm-overwrite').click();
    await expect(page.getByTestId('profile-card-work')).toHaveCount(1);
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
