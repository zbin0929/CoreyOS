import { test, expect } from './fixtures/test';

/**
 * Phase 7 · T7.2 — "Save as Skill" drawer.
 *
 * Seeds a chat session with one user + one assistant turn so the
 * header button lights up, then walks the full drawer flow:
 * open → tweak name → save → success chip visible → ~/.hermes/skills/
 * mock slot reflects the write.
 */
test.describe('save-as-skill (T7.2)', () => {
  test('enabled after assistant reply; writes file to mock', async ({ page }) => {
    // Seed a session with one completed assistant turn before the app
    // hydrates. `db_load_all` returns this list and the chat store
    // picks the first session as current.
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            on: (cmd: string, h: () => unknown) => void;
            state: { skills: Record<string, unknown> };
          };
        }
      ).__CADUCEUS_MOCK__;
      mock.on('db_load_all', () => [
        {
          id: 's1',
          title: 'Timezone math',
          model: 'gpt-4o',
          adapter_id: 'hermes',
          created_at: 1_700_000_000_000,
          updated_at: 1_700_000_060_000,
          messages: [
            {
              id: 'm1',
              session_id: 's1',
              role: 'user',
              content: 'How do I convert a UTC timestamp to Tokyo time in Python?',
              error: null,
              position: 0,
              created_at: 1_700_000_000_000,
              tool_calls: [],
            },
            {
              id: 'm2',
              session_id: 's1',
              role: 'assistant',
              content:
                'Use `datetime.astimezone(ZoneInfo("Asia/Tokyo"))`. Example:\n```py\nfrom datetime import datetime, timezone\nfrom zoneinfo import ZoneInfo\nnow_utc = datetime.now(timezone.utc)\nnow_tokyo = now_utc.astimezone(ZoneInfo("Asia/Tokyo"))\n```',
              error: null,
              position: 1,
              created_at: 1_700_000_030_000,
              prompt_tokens: 18,
              completion_tokens: 40,
              tool_calls: [],
            },
          ],
        },
      ]);
    });

    await page.goto('/chat');

    // Header button is present + enabled now that the seeded session
    // has a completed assistant reply.
    const btn = page.getByTestId('chat-save-as-skill');
    await expect(btn).toBeEnabled();
    await btn.click();

    // Drawer opens with a pre-filled name + body derived from the
    // first user message.
    const drawer = page.getByTestId('save-as-skill-drawer');
    await expect(drawer).toBeVisible();

    const nameInput = page.getByTestId('save-as-skill-name');
    // Default slug is derived from the first user line (lowercased,
    // dashes). Just confirm it's non-empty — the exact slug depends
    // on the seed and we don't want the test brittle to wording.
    await expect(nameInput).not.toHaveValue('');

    const body = page.getByTestId('save-as-skill-body');
    // Body contains both frontmatter + the transcript.
    await expect(body).toHaveValue(/^---\nname:/);
    await expect(body).toHaveValue(/## User/);
    await expect(body).toHaveValue(/## Assistant/);
    await expect(body).toHaveValue(/ZoneInfo/);

    // Override the name to a known slug and save.
    await nameInput.fill('timezone-math');
    await page.getByTestId('save-as-skill-submit').click();

    // Success chip appears with the written path.
    await expect(page.getByTestId('save-as-skill-success')).toBeVisible();

    // Mock state mirror confirms the skill landed.
    const stored = await page.evaluate(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__: {
            state: {
              skills: Record<string, { body: string; updated_at_ms: number }>;
            };
          };
        }
      ).__CADUCEUS_MOCK__;
      return mock.state.skills;
    });
    expect(stored['timezone-math.md']).toBeDefined();
    expect(stored['timezone-math.md']!.body).toContain('ZoneInfo');
    expect(stored['timezone-math.md']!.body).toContain('## User');
  });

  test('button is disabled on a blank session', async ({ page }) => {
    // No init-script seeding — the app opens a fresh session with no
    // messages. The Save-as-Skill button is rendered but disabled.
    await page.goto('/chat');
    const btn = page.getByTestId('chat-save-as-skill');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });
});
