# 06 · Backlog (post-Phase-4)

Living list of everything we consciously **deferred** out of Phases 0–4.
Each item carries a priority, the reason it's parked, and — when
applicable — the trigger that should re-open it.

The six items we actually closed out before Phase 5 (T1.5c/d/e, T4.4b,
T4.6b, P2 profile revert) are documented in `CHANGELOG.md` and their
respective `docs/phases/phase-N-*.md` files; they're **not** listed
here.

Categories, newest-phase first:

- [P4 follow-ups](#p4-follow-ups)
- [P3 follow-ups](#p3-follow-ups)
- [P2 follow-ups](#p2-follow-ups)
- [P1 follow-ups](#p1-follow-ups)
- [Cross-cutting](#cross-cutting)

---

## P4 follow-ups

### T4.2b · Skill editor — CodeMirror 6 + test-runner + version history
- **Priority**: low
- **Why parked**: `<textarea>` is fully sufficient for Markdown editing;
  CodeMirror is a heavyweight integration (syntax extensions, theming,
  a11y tuning). Test-runner and rollback need a skills-history schema
  that doesn't exist yet.
- **Re-open when**: a user hits a concrete UX wall (slow paste on 10k-
  line skills, need for multi-cursor, or explicit rollback demand).

### T4.5b · Web terminal — multi-tab / WebGL / paste-large / session restore
- **Priority**: low
- **Why parked**: single-tab MVP is adequate for "quick `ls`, `pwd`,
  `git status`" flows. Multi-tab needs a tab container + spawn/kill
  plumbing across IDs; WebGL renderer has a large bundle cost;
  paste-large guard and session restore are quality-of-life, not
  capability.
- **Re-open when**: the terminal starts getting used as a primary shell
  (then tab support moves above Phase 5).

### T4.6b · Runbook extras — JSON export/import, inline preview
- **Priority**: low
- **Why parked**: the scope filter (the primary T4.6b ask) shipped.
  Export/import is rare ops; preview is a polish item.
- **Re-open when**: users start sharing runbooks out-of-band.

### T4.4b · Budget interceptor — per-period windowing + per-model cost
- **Priority**: medium
- **Why parked**: `analyticsSummary` currently returns **lifetime**
  totals only, so honouring `budget.period` (day/week/month) would lie
  more than it helps. Per-model cost needs per-model token counts in
  the same summary.
- **Re-open when**: `analyticsSummary` gains a per-period bucket **and**
  per-model token breakdown. Both are small backend changes; the
  gate in `src/features/chat/budgetGate.ts` already has commented-out
  `// period-windowing` slots.

---

## P3 follow-ups

### Tencent iLink — real QR client
- **Priority**: **blocked**
- **Why parked**: `ILinkQrProvider` would live next to `StubQrProvider`
  and wire through the existing registry, but we have neither live
  credentials nor a documented endpoint. The stub provider covers
  every code path that the real client would hit.
- **Re-open when**: we acquire credentials and a reachable endpoint.

### Explicit "Clear secret" button for env keys
- **Priority**: low
- **Why parked**: current flow (changelog revert or hand-editing
  `~/.hermes/.env`) is adequate. An explicit button ships cleanly
  only once we stop using "token presence" as the single source of
  truth in the UI — that cleanup is a larger refactor.
- **Re-open when**: the settings panel is being rewritten anyway.

### `/health/channels` probe
- **Priority**: low
- **Why parked**: Hermes doesn't expose this endpoint yet; our current
  `channel_status.rs` backend parses logs which works fine for
  present-day Hermes.
- **Re-open when**: Hermes ships `/health/channels`. The backend
  shortcircuit is a ~30-line addition.

### WhatsApp env name (`WHATSAPP_TOKEN` placeholder)
- **Priority**: low
- **Why parked**: we don't know the official Hermes convention yet.
- **Re-open when**: Hermes docs land on the canonical name.

---

## P2 follow-ups

### Profile data restoration on delete-revert
- **Priority**: low
- **Why parked**: `hermes.profile.delete` is `remove_dir_all` — the
  data is *gone*. Restoration needs either pre-delete snapshotting
  or a filesystem-level undo layer. The revert now recreates the
  shell with a seed `config.yaml`; users at least get their Hermes
  install back to a parseable state.
- **Re-open when**: we grow a snapshot/restore subsystem (potentially
  shared with Skills history in T4.2b).

### UI hint for irreversible-data reverts
- **Priority**: medium
- **Why parked**: shippable alongside anything that touches the Logs
  panel; out of scope for the dispatch-only P2 pass.
- **Re-open when**: next Logs panel redesign, OR if a user nukes
  important data by mistake.

### Profile tar.gz import / export
- **Priority**: low
- **Why parked**: needs a Tauri file-picker integration + a
  manifest-preview dialog. Niche until the user has many profiles.

### Per-profile gateway start / stop with port auto-resolution
- **Priority**: medium
- **Why parked**: gateway lifecycle is a cross-cutting concern we
  punted from Phase 3 too — needs a port-broker + process supervisor
  in Rust.
- **Re-open when**: active-profile switching is prioritised.

### Active profile switching
- **Priority**: medium
- **Why parked**: `~/.hermes/active_profile` is Hermes-owned; swapping
  safely requires first quiescing the gateway. Tied to the per-profile
  gateway work above.

### Streaming log tail (notify + SSE)
- **Priority**: low
- **Why parked**: manual refresh is adequate up to single-digit-MB log
  files. Streaming needs a `notify`-based watcher on the backend and
  an SSE/long-poll channel to the frontend.
- **Re-open when**: log volume genuinely warrants it.

---

## P1 follow-ups

### T1.5 advanced — configurable preview cap, lightbox, cache
- **Priority**: low
- **Why parked**: the hard-coded 5 MB cap and remount-per-image IPC
  are fine for current session sizes; upgrading them is strictly
  optimisation.
- **Re-open when**: profiling shows IPC storms, or users request a
  full-size view.

### T1.8 · Reconnect auto-poll
- **Priority**: low
- **Why parked**: the app works on next send after a gateway restart.
  An auto-health-poll that reconnects in the background is polish,
  not capability.
- **Re-open when**: users start running long-lived sessions against
  flaky gateways.

### T1.9 · 10k-message session virtualisation
- **Priority**: low
- **Why parked**: current `overflow-y-auto` with smooth scroll is
  comfortable up to a few thousand messages on an M1. Virtualisation
  is complex (breaks find-in-page, a11y quirks, etc.) and we have no
  user report of a perf wall yet.
- **Re-open when**: a user hits the wall.

---

## Cross-cutting

### Storybook + component catalog
- **Priority**: low
- **Why parked**: deferred from Phase 0.5. Playwright covers our
  actual behaviours; Storybook is documentation infrastructure.
- **Re-open when**: a design-system overhaul warrants visual
  regression tooling.

### Vision-capability backfill from `/v1/models`
- **Priority**: low
- **Why parked**: the T1.5c client-side heuristic works. A real
  backfill needs a per-provider capabilities table in `adapters::*`.
- **Re-open when**: we onboard a non-Hermes adapter that exposes
  trustworthy capability metadata.

### Attachment thumbnail caching across remounts
- **Priority**: low
- **Why parked**: bubble list isn't virtualised yet, so remounts are
  rare and the IPC is cheap.
- **Re-open when**: T1.9 virtualisation lands, OR profiling shows
  attachment previews dominating CPU.

### Runbook scope filter — palette-mode toggle
- **Priority**: low
- **Why parked**: we deliberately pinned the palette to the active
  profile (no "show all" toggle) because palette UX should be
  tight. A future "/scope all" modifier could unlock it.
- **Re-open when**: users start using runbooks cross-profile in
  the palette.

### Icon system batch-refactor (migrate ~80 lucide call sites → `<Icon>`)
- **Priority**: low
- **Why parked**: the unified wrapper landed 2026-04-23
  (`src/components/ui/icon.tsx`) and new code will adopt it. The
  existing ~80 call sites still render correctly with raw
  `<LucideX size={…} strokeWidth={…}/>` — migration is a mechanical
  sweep, not blocking. Keep `docs/icon-audit.md` as the worklist.
- **Re-open when**: a stroke-width / size-token inconsistency shows
  up in review, or we do a second-pass design polish across
  routes.
