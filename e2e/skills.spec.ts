import { test, expect } from './fixtures/test';

/**
 * Phase 4 · T4.2 — Skill editor.
 *
 * Covers create → list → open → edit (dirty badge) → save → delete.
 */
test.describe('skills', () => {
  test('create new → edit body → save flips dirty badge off', async ({ page }) => {
    await page.goto('/skills');
    await expect(page.getByText(/No skills yet|还没有技能/)).toBeVisible();

    // New → fill path → create.
    await page.getByTestId('skills-new').click();
    await page.getByTestId('skills-new-name').fill('daily');
    await page.getByTestId('skills-new-create').click();

    // Editor opens with the seeded body.
    await expect(page.getByTestId('skills-editor')).toBeVisible();
    const ta = page.getByTestId('skills-editor-textarea');
    await expect(ta).toHaveValue(/daily\n\nWrite your prompt here/);

    // Tree row appears.
    await expect(page.getByTestId('skill-row-daily/SKILL.md')).toBeVisible();

    // Edit → dirty badge + save enabled.
    await ta.fill('# new body\n');
    await expect(page.getByTestId('skills-dirty-badge')).toBeVisible();
    await expect(page.getByTestId('skills-save')).toBeEnabled();

    await page.getByTestId('skills-save').click();
    await expect(page.getByTestId('skills-dirty-badge')).toHaveCount(0);
    await expect(page.getByTestId('skills-save')).toBeDisabled();
  });

  test('seeded tree with two skills lets you switch between them and delete', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: {
            state: {
              skills: Record<string, { body: string; updated_at_ms: number }>;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      mock.state.skills = {
        'standup/SKILL.md': { body: '# standup\n', updated_at_ms: 2 },
        'work/prreview/SKILL.md': { body: '# pr review\n', updated_at_ms: 1 },
      };
    });
    await page.goto('/skills');

    await expect(page.getByTestId('skill-row-standup/SKILL.md')).toBeVisible();
    await expect(page.getByTestId('skill-row-work/prreview/SKILL.md')).toBeVisible();

    // Open the root one first.
    await page.getByTestId('skill-row-standup/SKILL.md').click();
    await expect(page.getByTestId('skills-editor-textarea')).toHaveValue(
      '# standup\n',
    );

    // Switch to the nested one.
    await page.getByTestId('skill-row-work/prreview/SKILL.md').click();
    await expect(page.getByTestId('skills-editor-textarea')).toHaveValue(
      '# pr review\n',
    );

    // Delete → row vanishes, editor returns to empty state.
    await page.getByTestId('skills-delete').click();
    await expect(page.getByTestId('skill-row-work/prreview/SKILL.md')).toHaveCount(0);
    await expect(page.getByTestId('skills-editor')).toHaveCount(0);
  });
});
