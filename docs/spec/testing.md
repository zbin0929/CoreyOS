# 06 · Testing Strategy

## Layers

| Layer                 | Tool                            | Where                                  | Runs on         |
|-----------------------|---------------------------------|----------------------------------------|-----------------|
| Rust unit             | `cargo test`                    | `src-tauri/src/**/tests`               | every push      |
| Rust integration      | `cargo test --features itest`   | `src-tauri/tests/`                     | every push      |
| TS unit               | Vitest + React Testing Library  | `src/**/__tests__/**`                  | every push      |
| Component stories     | Ladle (or Storybook)            | `src/**/*.stories.tsx`                 | every push (build smoke) |
| e2e (desktop)         | Playwright + Tauri webdriver    | `tests/e2e/`                           | pre-release + nightly |
| e2e (web mode)        | Playwright                      | `tests/e2e-web/`                       | every push      |
| Visual regression     | Playwright screenshot + diff    | `tests/visual/`                        | every push      |
| Perf bench            | Custom harness via Playwright traces | `tests/perf/`                     | nightly         |
| Accessibility         | `axe-core` via Playwright       | `tests/a11y/`                          | pre-release     |

## Conformance suite (adapters)

Any `AgentAdapter` implementation must pass `src-tauri/tests/adapter_conformance.rs`:

- Session lifecycle (create → list → rename → delete).
- Delta ordering and bracketing (MessageStart/End).
- Cancellation mid-stream leaves the system in a clean state.
- `capabilities()` matches actual behavior (e.g. if it declares `streaming=false`, `send_message` must not emit `TextChunk` deltas).
- Error taxonomy is respected (no plain `Internal` where a specific variant applies).

Run with `cargo test --features itest adapter_conformance`.

## Fixture-based streaming

SSE fixtures live under `src-tauri/tests/fixtures/sse/*.jsonl`. A tiny hyper server (`tests/helpers/mock_gateway.rs`) replays them at configurable pacing. Every chat-related test uses this instead of the real network.

Capturing new fixtures: `cargo run --example capture_stream -- --url http://… --out fixtures/sse/foo.jsonl` with secrets scrubbed via a filter list.

## Property-based tests

Use `proptest` for:

- YAML/env round-trip: random YAML with comments → read → unchanged-mutate → write → reparse → equal.
- Delta reducer: random `Delta[]` sequences → state invariants hold (e.g. `ToolCallEnd` only after `ToolCallStart`).
- Diff / rollback: random mutate → rollback → initial state.

## Frontend store tests

- Chat reducer (`src/stores/chat.ts`) is a pure function; unit-test with hand-crafted `Delta[]`.
- Palette provider registration; ensure late-registered commands appear.

## e2e scenarios per phase

Minimum must-pass list (names are test IDs):

**Phase 0**
- `shell.boot`, `palette.open-and-navigate`, `theme.toggle`

**Phase 1**
- `chat.send-receives-text`, `chat.tool-call-renders`, `chat.cancel-cleanly`, `chat.reconnect-after-gateway-restart`, `chat.virtualized-10k-scroll`

**Phase 2**
- `models.add-provider-and-probe`, `settings.change-requires-restart-modal`, `logs.tail-and-filter`, `profiles.clone-and-switch`, `changelog.revert-restores`

**Phase 3**
- For each of 8 channels: `channels.<name>.save-writes-env-and-yaml`, `channels.<name>.diff-modal`
- `channels.wechat.qr-mocked-flow`

**Phase 4**
- `compare.four-lanes-concurrent`, `skills.edit-save-rollback`, `trajectory.replay-order`, `budgets.block-over-budget`, `terminal.pty-roundtrip`, `runbooks.invoke-from-palette`

**Phase 5**
- `adapters.enable-claude-code-mock`, `inbox.all-agents-unified`, `analytics.adapter-breakdown`, `capability.hidden-nav-per-adapter`

## Visual regression

- Tool: Playwright screenshot + `playwright-visual` (or Percy if cloud is OK; local diff preferred).
- Snapshots stored in `tests/visual/__screenshots__/` as PNG.
- CI compares pixel-diff with 0.1% threshold by default; higher for animation-prone screens (up to 1%).
- Reviewed changes explicitly re-baselined via PR label `visual-baseline`.

Surfaces snapshotted every PR:

- App shell (dark/light)
- Command palette (open, typing)
- Chat empty state, Chat with tool card
- Analytics full page
- Channels grid, flipped card
- Compare 4-lane
- Trajectory default

## Performance bench

Nightly CI job:

1. Boots the bundle, measures cold start with `performance.now()` marks.
2. Seeds a 10k-message session; scrolls via Playwright; records frame timings.
3. Triggers 4-lane compare with fixture streams; measures main-thread busy time.
4. Fails if:
   - Cold start > 1.2 s on CI runner (adjusted: real-hardware budget is 1.0 s).
   - Scroll mean frame > 20 ms.
   - Any regression > 10% vs. rolling 7-day median.

## Accessibility

- `axe-core` scan on every snapshotted surface; zero serious/critical violations permitted.
- Keyboard traversal test: run each e2e scenario a second time with mouse input disabled; expected identical outcome.
- Screen reader smoke: VoiceOver (macOS) manual pass before each release; document findings in release checklist.

## Security

- `cargo audit` weekly + on dependency bumps.
- `npm audit --audit-level=high` on every CI.
- `pnpm dlx license-checker` to ensure no GPL/AGPL creep (we're MIT; avoid incompatible deps).
- Secrets redaction: CI scans logs for patterns like `sk-…`, `xoxb-…`, `ghp_…`; any match fails the build.

## Flake policy

- A test that fails intermittently is quarantined to `tests/quarantine/` within 24 h of first observation.
- Quarantined tests don't block release but must be fixed within 1 week or deleted with a tracking issue.

## Coverage targets

- Rust: 70% line coverage on `adapters/` and `ipc/` modules (measured with `cargo llvm-cov`).
- TS: 60% line coverage on `stores/` and `lib/`.
- No target on `features/` components — covered by e2e and visual instead.
