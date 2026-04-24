import { test } from './fixtures/test';

/**
 * Populated-state screenshot audit — same idea as screenshot-audit.spec.ts
 * but seeds the mock with realistic fixtures first, so pages render the
 * "happy path" instead of empty states. This surfaces UX bugs that the
 * empty-state pass can't (e.g. long titles that truncate, tables that
 * wrap ugly, timestamps that overflow).
 *
 * Opt-in:
 *   SCREENSHOT_AUDIT=1 pnpm playwright test screenshot-audit-populated
 */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/chat', name: '02-chat' },
  { path: '/skills', name: '04-skills' },
  { path: '/trajectory', name: '05-trajectory' },
  { path: '/scheduler', name: '09-scheduler' },
  { path: '/runbooks', name: '13-runbooks' },
  { path: '/budgets', name: '14-budgets' },
  { path: '/memory', name: '15-memory' },
  { path: '/mcp', name: '16-mcp' },
];

test.describe('screenshot audit — populated (not part of default run)', () => {
  test.skip(
    !process.env.SCREENSHOT_AUDIT,
    'Set SCREENSHOT_AUDIT=1 to run the populated screenshot sweep.',
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const mock = (
        window as unknown as {
          __CADUCEUS_MOCK__?: { state: Record<string, unknown> };
        }
      ).__CADUCEUS_MOCK__;
      if (!mock) return;
      const s = mock.state as Record<string, unknown>;

      // Skills fixture — nested tree + varied mtimes.
      s.skills = {
        'deploy-staging.md': {
          body: '# Deploy staging\n\nRun ./scripts/deploy.sh staging',
          updated_at_ms: Date.now() - 86_400_000,
        },
        'work/standup.md': {
          body: '# Daily standup\n\nYesterday / today / blockers.',
          updated_at_ms: Date.now() - 3_600_000,
        },
        'work/code-review.md': {
          body: '# Code review template\n\nPoint out: correctness, style, perf.',
          updated_at_ms: Date.now() - 7_200_000,
        },
        'writing/summarize.md': {
          body: '# Summarize\n\nGive me 3 bullets.',
          updated_at_ms: Date.now() - 172_800_000,
        },
      };

      // Runbooks fixture.
      s.runbooks = [
        {
          id: 'rb-summarize-url',
          name: 'Summarize URL',
          description: 'Fetch a URL and produce a 3-bullet summary.',
          body: 'Summarize this URL in 3 bullets: {{url}}',
          parameters: [{ key: 'url', label: 'URL' }],
          scope: { kind: 'any' },
          updated_at_ms: Date.now() - 3_600_000,
        },
        {
          id: 'rb-commit-msg',
          name: 'Commit message from diff',
          description: 'Read the current diff and write a conventional commit message.',
          body: 'Write a conventional commit for:\n\n{{diff}}',
          parameters: [{ key: 'diff', label: 'Diff' }],
          scope: { kind: 'any' },
          updated_at_ms: Date.now() - 86_400_000,
        },
      ];

      // Budgets fixture — mix of scope kinds + states.
      s.budgets = [
        {
          id: 'bg-global-daily',
          scope: { kind: 'global' },
          period: 'day',
          cap_usd: 10,
          action: 'warn',
          projected_usd: 3.42,
          period_start: new Date().toISOString().slice(0, 10),
          updated_at_ms: Date.now() - 3_600_000,
        },
        {
          id: 'bg-model-expensive',
          scope: { kind: 'model', value: 'gpt-4o' },
          period: 'week',
          cap_usd: 25,
          action: 'block',
          projected_usd: 21.8,
          period_start: new Date().toISOString().slice(0, 10),
          updated_at_ms: Date.now() - 7_200_000,
        },
      ];

      // Sessions fixture for Chat + Trajectory.
      const now = Date.now();
      const sess1 = {
        id: 'sess-rust-help',
        title: 'Help me with async Rust',
        adapter_id: 'hermes',
        model: 'deepseek-chat',
        created_at: now - 172_800_000,
        updated_at: now - 3_600_000,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Why does my Tokio task deadlock when I hold a MutexGuard across .await?',
            created_at: now - 172_800_000,
          },
          {
            id: 'm2',
            role: 'assistant',
            content:
              'Holding a sync `std::sync::MutexGuard` across an `.await` is the classic footgun — ' +
              'the guard is `!Send`, but Tokio tasks can migrate between threads, so the compiler ' +
              'rejects it. Use `tokio::sync::Mutex` for async-aware locking.',
            created_at: now - 172_700_000,
            model: 'deepseek-chat',
          },
        ],
      };
      const sess2 = {
        id: 'sess-landing',
        title: 'Draft landing page copy',
        adapter_id: 'hermes',
        model: 'deepseek-chat',
        created_at: now - 86_400_000,
        updated_at: now - 1_200_000,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Write a landing-page headline for a control plane for AI agents.',
            created_at: now - 86_400_000,
          },
        ],
      };
      s.sessions = [sess1, sess2];

      // MCP servers.
      const hc = s.hermesConfig as { mcp_servers?: unknown[] };
      hc.mcp_servers = [
        {
          id: 'filesystem',
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/projects'],
          env: {},
        },
        {
          id: 'postgres',
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/app'],
          env: {},
        },
      ];

      // MEMORY.md + USER.md content.
      const mem = s.hermesMemory as Record<string, unknown> | undefined;
      if (mem) {
        mem.agent = {
          path: '/Users/mock/.hermes/MEMORY.md',
          body:
            '# Running tasks\n\n- Shipping v0.1.0 this week; Windows build still TODO.\n' +
            '- User prefers terse, action-first replies.\n\n' +
            '# Project conventions\n\n- Rust 2021, tokio, rustls.\n- No paid OS signing.\n',
          size_bytes: 220,
        };
        mem.user = {
          path: '/Users/mock/.hermes/USER.md',
          body:
            '# About me\n\nBin, working on Corey — a desktop control plane for AI agents.\n\n' +
            'Preferred tone: direct, terse, pragmatic. Default stack: Rust + Tauri + React.\n',
          size_bytes: 178,
        };
      }

      // Scheduler jobs.
      s.scheduler_jobs = [
        {
          id: 'job-daily-standup',
          name: 'Daily standup summary',
          schedule: '0 0 9 * * *',
          prompt: 'Read yesterday\'s commits and draft a 3-bullet standup.',
          paused: false,
          corey_created_at: now - 604_800_000,
          corey_updated_at: now - 86_400_000,
        },
        {
          id: 'job-hn-digest',
          name: 'HN digest',
          schedule: '0 30 * * * *',
          prompt: 'Summarise the top 5 HN posts and post to Telegram.',
          paused: true,
          corey_created_at: now - 1_209_600_000,
          corey_updated_at: now - 3_600_000,
        },
      ];
    });
  });

  for (const route of ROUTES) {
    test(`${route.name} — ${route.path} (populated)`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForTimeout(800);
      await page.screenshot({
        path: `e2e/screenshots/audit-populated/${route.name}.png`,
        fullPage: true,
      });
    });
  }
});
