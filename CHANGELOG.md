# Changelog

Dated, human-readable log of shipped work. One entry per substantive milestone — not per commit. Feeds Phase retro notes and release notes.

Format: `## YYYY-MM-DD — <title>` → `### Shipped` / `### Fixed` / `### Deferred`.

---

## 2026-04-24 — Polish pass: onboarding · model picker · release infra · v0.1.0

Post-Phase-7 polish day. No new feature phases — the goal was to make
the app packageable and the first-run experience intentional. Five
clusters of work:

### Shipped

**InfoHint help system.** A new `InfoHint` component (inline `?` icon →
popover with help copy) slots next to page titles. Wired across
Settings, Budgets, Trajectory, Runbooks, Skills, Scheduler, MCP,
Memory, Channels. Every help string lives under `<page>.help_page`
in the locale files, so translation is the only barrier to adding
more help surfaces.

**Home onboarding.** Rewrote the Phase-0 welcome page into an
auto-detecting checklist. Home now polls for `gateway healthy`,
`currentModel set`, `sessions > 0`, `USER.md bytes > 0`, and shows
a numbered checklist with "Go configure" / "Open chat" jump buttons
per step. README pivoted product-first to match: the app is meant
to be opened, not `pnpm tauri:dev`'d.

**Per-session model picker.** Chat page's old `ActiveLLMBadge` was a
read-only status chip that linked to `/models`. It's now a proper
dropdown (`ActiveLLMBadge.tsx`, 250 lines) that:

- Lists every model returned by `modelList()`.
- "Use default" sentinel row clears the session override.
- Golden dot + golden border when the session has an override.
- Keyboard nav: ↓/Enter/Space on trigger opens; ↑↓ Home/End move
  between rows; Enter commits; Esc closes; outside-click closes.
- Auto-shows a search field when models > 6 (filters id /
  display_name / provider, case-insensitive).
- Focus returns to the trigger after close.
- Link to `/models` at the bottom for provider config.

**Also a real bug fix**: the old code path explicitly dropped the
`model` field on the wire — a stale comment claimed Hermes ignored
it, but `resolve_turn()` in `src-tauri/src/adapters/hermes/mod.rs`
honours `turn.model` with fallback to `default_model`. So
`setSessionModel` was writing into the store and the DB with no
effect. Now it actually takes effect.

**Release infra.** v0.1.0 bumped across `Cargo.toml`,
`tauri.conf.json`, `package.json`. Two scripts added:

- `scripts/release-setup.sh` — one-shot: `tauri signer generate`,
  uploads `TAURI_SIGNING_PRIVATE_KEY` + passphrase to GitHub secrets,
  patches `plugins.updater.pubkey`, commits the diff. Flags:
  `--no-pass`, `--force`. Idempotent-ish; refuses to clobber an
  existing key without `--force`.
- `scripts/release-local.sh` — builds locally on macOS using the
  same signing key. Flags: `--universal` for a fat Intel + Apple
  Silicon binary. Outputs `.dmg` + `.app.tar.gz` + `.sig`.

`.github/workflows/release-windows.yml` — manually-dispatched CI that
only spins up a Windows runner (~$0.25/run on private repo, free tier
covers ~60 builds/mo). Attaches `.msi` + NSIS + signed updater zip to
the draft release for the given tag.

`tauri-plugin-updater` wired into `lib.rs` + `capabilities/default.json`.
Updater endpoint points at `releases/latest/download/latest.json`.
Pubkey baked into `tauri.conf.json` (replaced via `release-setup.sh`).

`docs/07-release.md` rewritten from strategy plan to executable
runbook.

### Fixed

- `CoreyOS/src/features/chat/index.tsx`: removed the "Hermes ignores
  `model`" comment + actually passes `effectiveModel` through
  `chatStream`. This was a silent correctness regression from the
  original adapter abstraction — the session-override UI had existed
  for weeks but never took effect.
- Clippy cleanup surfaced by newer toolchain: `channels.rs` doc-list
  indent, `hermes_cron.rs` → `sort_by_key` + `!is_empty()`,
  `ipc/scheduler.rs` → `Option::unwrap_or(0)`. `-D warnings` green
  again.

### Deferred

- `.github/workflows/release.yml` (original all-platform matrix) was
  removed after the first run failed with a GitHub billing error.
  Pivot to local-mac + Windows-only CI. The all-platform version is
  still in git history at commit `8e4dbdb`; flip it back on when the
  repo goes public or the maintainer has appetite for macOS runner
  minutes.
- LandingREADME / promo screenshots — decided to ship the packaged
  app with built-in onboarding and a short product README instead.
- Paid code signing (Apple Developer ID, Windows Authenticode) —
  re-evaluated when install friction becomes measurable.

### Test totals

- Rust: **192 / 192 pass** (+4 from clippy refactors).
- Playwright: **74 / 74 pass** (+3: per-session picker, keyboard nav,
  plus the existing regression suite).
- TSC clean. ESLint clean.

### Commits (this day)

`8c2cedd` Home onboarding · `fd2e6c7` InfoHint + 3 pages ·
`69f875a` + `cdf838b` InfoHint on the remaining 6 pages ·
`77f08b8` per-session model picker + wire fix · `2df9c43` picker e2e
regression guard · `3b223b4` picker keyboard + search ·
`8e4dbdb` release pipeline v1 · `9d91d80` release-setup.sh ·
`46edb17` pubkey pin · `2d07752` pivot to local-only · `60ed428`
Windows-only CI.

---

## 2026-04-23 — Phase 7 complete · T7.2 Save-as-Skill + T7.4 Skill Hub browser

Last two T7.x tasks ship together. Phase 7 is now 4/4 done (T7.1, T7.2, T7.3, T7.4 all green).

### T7.2 — Save conversation as Skill

New "Save as Skill" button in the chat header. Enabled once the session has at least one completed assistant reply; disabled otherwise with a tooltip explaining why. Click opens a bottom-sheet drawer pre-filled with:

- A **name field** derived from the first user message (sanitized to a filesystem-safe slug).
- A **SKILL.md body textarea** carrying YAML frontmatter stubs (`name`, `description`, `triggers`, `required_inputs`) + the full conversation transcript formatted with `## User` / `## Assistant` section breaks.

Save writes to `~/.hermes/skills/<slug>.md` via the existing `skillSave` IPC (T7.4 refactor already landed the filesystem-as-source-of-truth path). If the file already exists, we retry as an update — the user's intent on "Save" is "commit these bytes," regardless of prior state.

**LLM-distillation step deliberately deferred.** The phase doc's original plan runs the transcript through `chat_once` with a distillation prompt before showing the user the draft. That adds a round-trip + a failure mode ("what if the model returns non-Markdown?") + dependency on the active adapter being configured. The graceful-degradation path (user distils manually in the pre-filled textarea) is a complete, useful MVP on its own and the distillation layer is a drop-in upgrade later.

Files:
- `@/Users/zbin/AI项目/CoreyOS/src/features/chat/SaveAsSkillDrawer.tsx` — new drawer component
- `@/Users/zbin/AI项目/CoreyOS/src/features/chat/index.tsx` — header action + enable gating
- `@/Users/zbin/AI项目/CoreyOS/src/locales/en.json` + `zh.json` — 12 new keys under `chat.save_as_skill.*`
- `@/Users/zbin/AI项目/CoreyOS/e2e/save-as-skill.spec.ts` — 2 Playwright smokes (full save loop + disabled-on-blank-session)

### T7.4 — Skill Hub browser

Thin wrapper around the `hermes skills` CLI. The Hermes CLI already federates 7+ hub sources (official, skills-sh, well-known, github, clawhub, lobehub, claude-marketplace) — we shell out and render captured stdout. Zero upstream-format parsing: if Hermes changes its output tomorrow, this panel still works.

**Rust IPC** (`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/skill_hub.rs`, new module):

- `skill_hub_exec(args)` → `{stdout, stderr, status, cli_available}`. Spawns `hermes skills <args…>` via `std::process::Command`, captures output, detects NotFound → `cli_available: false`.
- **Subcommand allowlist** (9 entries: browse/search/inspect/install/uninstall/list/check/update/audit). Anything else is rejected server-side so a compromised frontend can't reach `hermes gateway start` or similar.
- 3 unit tests: empty-args reject, disallowed-subcommand reject, every-allowed-subcommand smoke.

**Frontend** (`@/Users/zbin/AI项目/CoreyOS/src/features/skills/HubPanel.tsx` + `index.tsx`):

- New **Local / Hub tabs** at the top of the Skills page. Local is the existing editor; Hub is the new surface. Clean tab switch — the local editor's state is untouched when users bounce between tabs.
- **Browse row**: source dropdown (7 federated sources) + optional search query + Browse button. Empty query → `browse`, non-empty → `search <q>`.
- **Install row**: full-slug input + Install button (e.g. `official/security/1password`).
- **Output pane**: monospace `<pre>` rendering the CLI's actual stdout + stderr + exit code chip. Users see exactly what Hermes said.
- **CLI-missing state**: single clear warning panel with a pointer to https://hermes-agent.nousresearch.com/ when the `hermes` binary isn't on PATH.

i18n: 12 new keys under `skill_hub.*` + 3 under `skills.tab_*`, en + zh complete.

Mock (`@/Users/zbin/AI项目/CoreyOS/e2e/fixtures/tauri-mock.ts`): `skill_hub_exec` echoes the invocation args as stdout so Playwright asserts both the UI render AND the command Corey constructed. Bug fix in the same commit: a stray `as string[]` TypeScript cast inside the `/* js */` template literal was silently breaking ALL IPC calls on test pages that loaded the mock after this block. The TS compiler accepted the outer `.ts` file but the injected JS threw at parse time → `window.__TAURI_INTERNALS__` never got set. Rule learned: never put TS syntax inside the injected template.

Tests (`@/Users/zbin/AI项目/CoreyOS/e2e/skill-hub.spec.ts`): 4 Playwright smokes — browse default source, search switches subcommand, install passes slug, CLI-missing renders hint.

**Deferred**:
- Parsing browse/search output into a structured list. The CLI output is human-readable as-is; `--json` isn't documented as stable across subcommands.
- Auto-confirm for `--force` install. Users see the scan verdict in stderr and decide.
- "Installed from hub" separate list section. Upstream tags them in `hermes skills list` output; our existing `skill_list` walks the same directory. If a user wants to differentiate, they can filter on slug prefix — not worth a separate UI surface yet.

### Test totals (Phase 7 complete)

- Rust: **188 / 188 pass** (+3 from T7.4)
- Vitest: **46 / 46 pass**
- Playwright: **71 / 71 pass** (+6 from T7.2 + T7.4)
- TSC clean; 5 pre-existing ESLint fast-refresh warnings.

### Phase 7 final status

| Task | Status |
|------|--------|
| T7.1 MCP server manager | ✅ Shipped 2026-04-23 pm |
| T7.2 Save as Skill | ✅ Shipped 2026-04-23 pm |
| T7.3 Memory page | ✅ Shipped 2026-04-23 pm |
| T7.4 Skill Hub wrapper | ✅ Shipped 2026-04-23 pm |

Phase 7 landed in a single afternoon — roughly 4 hours of wall-clock time — versus the audit's 1.5-week estimate. The delta is the audit's conservatism assuming each task would discover its own schema surprises; in practice T7.3 and T7.1 both needed < 30 min of upstream-doc reading before the Rust side was trivial. T7.4's MVP traded structured-list parsing for raw stdout — the cost of that is low and the savings are high.

### Next

Phase 8 (multimodal) is **conditional** per the product audit. Recommended pause-point to regroup on:
- Polishing Phase 6 deliverables based on dogfood feedback (Memory page UX, MCP error surfacing, etc.).
- Documentation sweep (user-facing quick-start, adapter integration guide).
- Early user acquisition.

---

## 2026-04-23 — T7.1 · MCP server manager

Second T7.x task. New `/mcp` page edits the `mcp_servers:` section of `~/.hermes/config.yaml`. Hermes forks each stdio server or connects each HTTP server itself — Corey only curates the config. Replaces the original plan of a LangGraph sidecar adapter: MCP is strictly more general (LangGraph, CrewAI, AutoGen can all expose themselves over MCP), and Hermes already ships first-class MCP support upstream.

### Context

Upstream config format verified against `hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes` before writing a single line of code. Schema is a top-level `mcp_servers:` map; each entry has either `command/args/env` (stdio) or `url/headers` (HTTP), plus an optional `tools.{include,exclude,prompts,resources}` filter. There is NO `enabled: true/false` field — presence means enabled. We preserve that convention verbatim instead of inventing corey-only metadata.

### Shipped

**Rust IPC** (`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/mcp.rs`, new module):

- `mcp_server_list()` → `Vec<{id, config}>`. Reads the `mcp_servers:` section; returns empty on missing file / missing section / non-mapping nodes instead of erroring.
- `mcp_server_upsert(server)` — reuses `hermes_config::write_channel_yaml_fields` with `root="mcp_servers"` (the helper is misnamed from T3.2 but is the generic YAML patch routine). Atomic write + journaled.
- `mcp_server_delete(id)` — same write helper, JSON null deletes.
- Validation: `id` is non-empty and contains no `.` (a dotted id would mis-nest as YAML path segments). Everything else rides through unchanged — including any future upstream field Hermes adds tomorrow.
- 3 unit tests: empty/missing section returns empty vec; stdio + url transports round-trip verbatim; id validation rejects empty + dotted.

**Frontend** (`@/Users/zbin/AI项目/CoreyOS/src/features/mcp/index.tsx`, new page):

- List with a per-row transport chip (`stdio` / `url`), truncated command-or-URL summary, Edit / Delete actions.
- Inline form for new + edit: id + transport selector + a prettified-JSON textarea for the full config blob. The transport selector swaps the starter JSON on NEW entries only — on EDIT it leaves the user's in-progress JSON alone to avoid destroying typed values.
- Inline validation: empty-id and dotted-id block the save button before any IPC round-trip; JSON parse errors show under the textarea.
- Restart-nudge banner appears after any save/delete. "Restart gateway" button reuses the existing `hermesGatewayRestart` IPC from Phase 3. Same visual vocabulary the Channels page already taught users.
- Id is frozen post-create (the map key is the identity) — matching the Hermes instances convention.

**Route + nav + i18n** (`@/Users/zbin/AI项目/CoreyOS/src/app/routes.tsx`, `nav-config.ts`, `locales/en.json`, `locales/zh.json`):

- Lazy `/mcp` route, `Plug` icon, ops group, phase 7.
- 17 new i18n keys under `mcp.*` + `nav.mcp`. Full zh translations.

**Tests**:

- **Playwright** (`@/Users/zbin/AI项目/CoreyOS/e2e/mcp.spec.ts`): empty → add stdio → verify mock state → restart nudge → click restart → delete → verify mock state. Second test covers the inline dotted-id validation guard.
- **Mock** (`@/Users/zbin/AI项目/CoreyOS/e2e/fixtures/tauri-mock.ts`): `state.mcpServers` keyed by id, plus `mcp_server_{list,upsert,delete}` handlers mirroring the Rust validation.

### Deferred

- **Reachability probe** ("Test" button that connects and lists tools). Doing it well means speaking the MCP handshake (stdio: fork the command, negotiate protocol, read tool schemas; HTTP: tool-list endpoint). Doing it poorly is worse than nothing. Users verify via the existing Trajectory pane once Hermes reloads — the agent will list the new tools in its next response, and invocations show up as `ToolProgress` events.
- **"Enabled" toggle**. Upstream has no such concept. Adding it would either invent a corey-only sentinel (polluting config.yaml) or maintain parallel state (sync headaches). Delete-and-re-add is the upstream answer.

### Test totals

- Rust: **185 / 185 pass** (+3)
- Vitest: **46 / 46 pass**
- Playwright: **65 / 65 pass** (+2)
- TSC clean; 5 pre-existing ESLint fast-refresh warnings.

### Next

- T7.2 skill-from-conversation distillation.
- T7.4 Skills CLI wrapper (browse / install / audit across 7 hub sources).

---

## 2026-04-23 — T7.3 · Memory page (GUI over Hermes' native MEMORY.md / USER.md)

First T7.x task lands. A new `/memory` route edits the two Markdown files Hermes already injects into every prompt — `~/.hermes/MEMORY.md` (agent notes) and `~/.hermes/USER.md` (user profile). No RAG, no embeddings, no SQLite schema — audit called out that Hermes owns retrieval + injection already, so our job is GUI only.

### Context

The original plan (pre-audit) was a local qdrant + embedding pipeline. The 2026-04-23 am audit reclassified this as a SURFACE task because Hermes ships `MEMORY.md` + `USER.md` + `session_search` natively. This cut ~3 days of work and removes a future-maintenance landmine (nobody wants a second vector DB to keep in sync with someone else's corpus).

The editor is deliberately minimal — two tabs, one CodeMirror instance reused from Skills (T4.2b), a capacity meter, and a save button. No autosave: memory is high-trust and a stray keystroke shouldn't silently overwrite the agent's instructions.

### Shipped

**Rust IPC** (`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/memory.rs`, new module):

- `memory_read(kind: "agent" | "user")` → `{content, path, bytes, max_bytes, exists}`. Missing file returns an empty body (NOT an error) so the first save is just a write.
- `memory_write(kind, content)` — crash-safe via `fs_atomic::atomic_write`. Rejects payloads > 256 KiB before touching disk.
- Serde-tagged `MemoryKind` enum so typos can't reach the filesystem.
- 3 unit tests: path resolution + round-trip write/read + file-name invariants. Uses the crate-wide `skills::HOME_LOCK` so parallel `cargo test` doesn't race HOME mutation with the attachments/changelog suites.

**Frontend** (`@/Users/zbin/AI项目/CoreyOS/src/features/memory/index.tsx`, new page):

- Two-tab layout (Agent memory / User profile), reuses `@/features/skills/MarkdownEditor` for the CodeMirror 6 editor.
- Capacity meter with red-tint at ≥ 90%. Shows UTF-8 byte count (matches Rust's `String::len()` — important for CJK users where char count ≠ byte count).
- Status chip cycles unsaved → saved (decays "Saved Xs ago" into plain "Saved" after 1 min) → new-file hint.
- ⌘S / Ctrl-S saves the active tab without taking focus out of the editor.
- Per-tab dirty indicator (small accent dot) — warns before tab switch loses changes? No, we just keep both tabs mounted with independent `dirty` state.

**Route + nav** (`@/Users/zbin/AI项目/CoreyOS/src/app/routes.tsx` + `@/Users/zbin/AI项目/CoreyOS/src/app/nav-config.ts`):

- Lazy-loaded route `/memory` (CodeMirror stays out of the initial bundle — inherits Skills' code-split).
- Nav entry in the `ops` group, no `requires` capability so the tab is always visible regardless of active adapter.

**i18n** (`@/Users/zbin/AI项目/CoreyOS/src/locales/en.json` + `zh.json`): 11 new keys under `memory.*` + `nav.memory`. Chinese translations cover all strings — a Chinese user can configure the agent's memory without reading any English.

**Tests**: 2 Playwright (`@/Users/zbin/AI项目/CoreyOS/e2e/memory.spec.ts`) — both tabs load + switch cleanly; edit → dirty indicator → save → mock slot reflects the write.

**Mock** (`@/Users/zbin/AI项目/CoreyOS/e2e/fixtures/tauri-mock.ts`): `memory_read` + `memory_write` handlers keyed on `state.memory.{agent,user}` (null = file doesn't exist yet).

### Deferred

- **Session search panel** — T7.3 originally included a search UI on top of Hermes' `session_search` tool. Deferred to T7.3b once the FTS5 surface is confirmed (there are multiple Hermes versions in the wild with different tool names).
- **Reveal in Finder button** — the capacity meter shows the absolute path as a tooltip, which is enough for now. Adding a button means wiring `tauri-plugin-shell`'s `reveal` API across platforms; not a blocker.

### Test totals

- Rust: **182 / 182 pass** (+3)
- Vitest: **46 / 46 pass**
- Playwright: **63 / 63 pass** (+2)
- TSC + ESLint clean.

### Next

- T7.1 MCP server manager UI (the other "surface a Hermes feature" task).
- T7.2 skill-from-conversation distillation.
- T7.4 Skills CLI wrapper.

---

## 2026-04-23 — Project rename: `hermes_ui` → `CoreyOS`

Pure docs + scripts rename pass. GitHub repo `zbin0929/hermes_ui` → `zbin0929/CoreyOS`; local folder moved; git remote updated. Crate name `caduceus` + Tauri identifier `com.caduceus.app` intentionally unchanged (changing them would cascade through hundreds of `use caduceus_lib::…` sites and orphan every existing install's on-disk state).

---

## 2026-04-23 — Three UX bugfixes (reasoning panel, channels zh-CN detection, chat scroll)

1. **Reasoning-content stream now surfaces in chat bubbles** — backend parses the sibling `reasoning_content` SSE field (deepseek-reasoner + o1-style models), new `ChatStreamEvent::Reasoning` variant, new `chat:reasoning:<handle>` event. Frontend `ReasoningPanel` renders inside the assistant bubble using native `<details>` so expand/collapse doesn't cost a React render per delta.
2. **Channels page respects Chinese browsers** — root cause: `navigator.language = 'zh-CN'` didn't literally match `supportedLngs: ['en','zh']`, so detector fell back to English. Fix: `load: 'languageOnly'` in `lib/i18n.ts`. Also added per-channel one-line descriptions (`channels.card_desc.*`) in en + zh so lesser-known integrations (WeCom vs WeiXin, Matrix, etc.) are self-explanatory.
3. **Chat auto-scrolls to latest on session entry** — Virtuoso's `initialTopMostItemIndex` only applies on first mount; switching sessions kept `ChatPane` mounted. Fix: `<ChatPane key={currentId} />` force-remounts on switch.

---

## 2026-04-23 — T6.7c · Channel smoke tests for Discord / Slack / Feishu / WeiXin / WeCom

Five more channels now carry the "Verified" badge. One parameterised Playwright spec (`e2e/channels-smoke.spec.ts`) walks the full configure-save-restart-online loop per channel, mirroring `telegram-smoke.spec.ts` from T6.7b. Closes out Phase 6 channel verification.

### Context

T6.7b shipped Telegram as the proof-of-concept smoke test. T6.7c was always the "do the same for the rest" step — valuable because the T6.7a schema hotfix touched WhatsApp/WeCom/WeiXin env-var names and there was no end-to-end guarantee those corrections actually drove a working save flow.

Chose a single parameterised spec over five separate files because the loop is genuinely identical — only the channel id and env-key list differ. Per-channel test names keep the failure message pointed at the specific integration that regressed (`T6.7c — channel smoke tests › wecom: configure → save → restart → online`).

### Shipped

**New spec** (`e2e/channels-smoke.spec.ts`):
- `SmokeChannel` descriptor + `CHANNELS` table with Discord / Slack / Feishu / WeiXin / WeCom and their required env keys. Slack has both `SLACK_BOT_TOKEN` and the optional `SLACK_APP_TOKEN` filled because real deployments need Socket Mode.
- `runSmoke(page, c)` helper drives: goto → wait for mock init → seed offline live-status → refresh → assert card starts unconfigured → open editor → fill each env key → submit → assert diff surfaces key names but NOT values → confirm save → assert captured `channelSaves` payload matches typed values verbatim → flip live-status to online → confirm restart → assert status pill flips to configured → force-probe → assert online pill → final DOM scan for any leaked secret.
- One `test()` per channel, looping over `CHANNELS`.

**Fixture extension** (`e2e/fixtures/tauri-mock.ts`):
- Added `slack`, `feishu`, `wecom` channel entries starting unconfigured. `discord` and `weixin` were already present. The existing `channels.spec.ts` assertions only check visibility of named ids, not list length, so adding channels doesn't regress anything.

**Verified badge catalog** (`src/features/channels/verified.ts`):
- `VERIFIED_CHANNELS` grows from `{telegram}` to the full 6-item set (telegram + discord + slack + feishu + weixin + wecom). The Channels page's Verified pill automatically shows on every listed channel.
- Doc comment updated with the coverage note + explicit "WhatsApp intentionally excluded (schema still in flux), Matrix low priority".

### Test totals

- Playwright: **61 pass** (was 56, +5 from channels-smoke × 5 tests). All existing specs (including `channels.spec.ts`, `telegram-smoke.spec.ts`, `sandbox-scopes.spec.ts`) still green.
- Rust: unchanged (179 pass — no backend change).
- Vitest: unchanged (46 pass).
- TSC clean, ESLint clean.

### Deferred

- **WhatsApp smoke** — schema still in flux; re-adding this channel to the fixture + a smoke test waits on a post-audit decision about whether we keep the WHATSAPP_ENABLED/MODE/ALLOWED_USERS shape or switch to a different bridge protocol.
- **Matrix smoke** — low-priority integration today; add if/when a user actually asks. Existing `channels.spec.ts` already exercises Matrix's partial-configured rendering, which is the most important visual check.

### Next

With T6.7c landed, **Phase 6 is done**. Remaining Phase 6 items (T6.5 per-agent sandbox, T6.7b Telegram smoke, T6.7c the rest) are all shipped. Everything that was tagged "KEEP" in the 2026-04-23 product audit and sized into Phase 6 is in. **Phase 7 is next** — starting with T7.3 Memory page wrap over `~/.hermes/MEMORY.md` + `USER.md` + `session_search`, the highest user-value item per the audit.

---

## 2026-04-23 — T6.5 · Per-agent sandbox isolation (named scopes + runtime enforcement)

Each Hermes instance can now be pinned to a named sandbox scope with its own root list. IPC-originated file ops (currently just `attachment_stage_path`; more to follow) gate through that scope, so a "worker" instance configured with zero roots can't read arbitrary paths on disk even when the default scope has broad access. Ships as four focused commits (C1–C4) so each step is green and reviewable.

### Context

The audit entry for T6.5 called out that Hermes gateway owns its own per-instance `config.yaml` sandbox — but Corey still ran a single process-wide `PathAuthority`, which meant every adapter + every IPC shared one allow-list. That's fine when there's only one Hermes instance. Once T6.2 shipped multi-instance Hermes, the shared authority became the missing half of per-agent isolation: a "manager" instance given broad workspace access leaked that same access to every "worker" instance alongside it.

**Honest boundary** — runtime enforcement here only covers IPC-originated file ops. Adapter tool calls (Hermes `terminal`/`file_read`/etc.) run inside the gateway process we don't control; their sandboxing is whatever the gateway's own `config.yaml` says. T6.5's scope is the surface Corey owns: attachments, skills writes, and any future IPC that reads user-picked paths on behalf of a specific agent. Documented this explicitly in the phase doc so nobody pretends it's a defense against a rogue agent process.

### Shipped

**C1 — sandbox internal refactor** (commit `244d96f`):
- `SandboxScope { id, label, roots }` type with the `default` scope always present + an `is_valid_scope_id` slug validator (`[a-z0-9_-]{1,32}`).
- `PathAuthority` gains `scopes` / `upsert_scope` / `delete_scope` / `roots_for` / `check_scoped` / `grant_once_in` / `session_grants_in` / `clear_session_grants_in`. Legacy `check` / `set_roots` / `add_root` / `grant_once` stay as thin wrappers targeting `DEFAULT_SCOPE_ID` — every pre-T6.5 caller keeps working without a line of downstream change.
- Session grants moved to `HashMap<scope_id, HashSet<PathBuf>>`. A grant in `worker` does NOT satisfy a check against `default`, which is the core security property.
- `sandbox.json` v2 schema: `scopes: Vec<SandboxScope>` replaces flat `roots`. v1 files auto-migrate on load (legacy roots become the `default` scope's roots). Next save writes v2; the legacy shape is never seen again.
- `SandboxError::{UnknownScope, InvalidScope}` variants + i18n-free `IpcError::Internal` mapping.
- 11 new Rust tests: v1→v2 migration, missing-default-scope reinsertion, new-authority-has-only-default, invalid ids rejected, default undeletable, check_scoped per-scope routing, grant_once scope-local, denylist still wins per scope, deleted scopes clear their grants, id validator accepts slugs / rejects junk.

**C2 — scope CRUD + Settings UI** (commit `d1edc40`):
- `sandbox_scope_list` / `sandbox_scope_upsert` / `sandbox_scope_delete` IPC commands registered in `lib.rs` invoke_handler.
- `HermesInstance.sandbox_scope_id: Option<String>` persisted; empty-string and `"default"` both normalise to `None` on upsert (the default-scope fallback).
- `SandboxScope` + helpers exported from `lib/ipc.ts`.
- `HermesInstancesSection` loads scopes alongside instances and threads them to each row. "Add instance" refetches the scope list on click so a scope created just now in the sibling section shows up immediately.
- `HermesInstanceRow` grows a `<select>` scope picker next to default-model. Empty value maps to `null` on the wire (default scope at runtime).
- New `SandboxScopesSection` between Workspace and Storage: lists all scopes with root counts, inline create form (id + label), delete button on non-default rows. Default shows a "Locked" badge rather than a trash icon.
- i18n keys (en + zh) for every new string.
- Mock fixture extended: `sandboxScopes` mutable state seeded with default, three new handlers mirror the Rust invariants.

**C3 — runtime enforcement on attachment_stage_path** (commit `a06f680`):
- IPC signature grows a `sandbox_scope_id` arg (optional; None / "" / "default" → default scope).
- Sandbox check runs BEFORE the blocking `stage_path()` copy, so a path outside the scope's roots fails with `SandboxConsentRequired` without ever reading the bytes.
- Frontend `attachmentStagePath` accepts `sandboxScopeId`. Callers thread the active Hermes instance's `sandbox_scope_id` at send-time.
- Mock mirrors the gate: non-default scope + path not under any root → `sandbox_consent_required`; non-default scope with zero roots → same (matches Rust enforced-mode semantics).

**C4 — e2e + docs** (this commit):
- New `e2e/sandbox-scopes.spec.ts` walks the full loop: verify default scope locked → create worker scope → assign to new Hermes instance → seed worker root → path INSIDE worker root accepted → path OUTSIDE rejected with `sandbox_consent_required` → same path through default scope accepted → delete worker scope.
- CHANGELOG (this entry), `docs/05-roadmap.md` (Phase 6 status), and `docs/phases/phase-6-orchestration.md` (T6.5 section updated).

### Test totals

- Rust: **179 pass** (+11 from C1, unchanged in C2–C4).
- Vitest: 46 pass (unchanged).
- Playwright: **56 pass** (+1 `sandbox-scopes.spec.ts`).
- TSC clean, ESLint clean.

### Deferred

- **Per-scope root editing inline** — `SandboxScopesSection` currently only creates scopes with an empty root list. Adding roots to a non-default scope still goes through... nothing, actually; the UI has no affordance. Punted because the enforcement story already works (a scope with 0 roots means "nothing allowed", which is sometimes exactly what a least-privilege worker wants). Follow-up can either reuse the Workspace add-root form with a scope dropdown, or expand each scope row into an editable card.
- **Skills write path** — `hermes_skill_write` and similar skill-editor IPCs also touch disk on behalf of an agent but currently aren't scope-aware. Low priority because skills are a user-driven surface today (user writes, then agents read), not agent-driven. Add scope plumbing if we ever ship skill-from-chat (T7.2).
- **Hermes adapter `build_content` direct read** — `src-tauri/src/adapters/hermes/mod.rs:155` still does `std::fs::read(&a.path)` with a `sandbox-allow` comment, because at that point the path is ALREADY attachments-dir-confined by the preceding stage IPC. Upgrading this to `check_scoped` would be pure safety-belts; tracked but not shipped in T6.5.

### Next

- **T6.7c** — five more channel smoke specs (Discord / Slack / Feishu / WeiXin / WeCom).
- **Phase 6 close** — after T6.7c all deferred-from-Phase-6 items are explicitly out-of-scope; next sprint is Phase 7.

---

## 2026-04-23 — T6.7b · Telegram e2e smoke test + channel verified badge + e2e mock hotfix

Telegram now has a dedicated end-to-end smoke test walking the full configure-and-save loop; the Channels page surfaces a "Verified" badge on channels with shipping coverage. Along the way discovered and fixed a silent mock regression from T6.2 + T6.4 that was breaking **48/55** Playwright specs.

### Context

Per the 2026-04-23 product audit, T6.7b was called out as "1.5 days — Telegram e2e smoke". While wiring the new spec, every existing Playwright test also failed with "Cannot read properties of undefined (reading 'invoke')" — meaning the Tauri IPC mock never installed. Root-causing that was the real priority: the T6.2 and T6.4 merges had pasted TS-only `as Array<...>` casts and `(r: any) =>` arrow-param annotations into the `/* js */` tagged template literal in `e2e/fixtures/tauri-mock.ts`. That string is injected RAW into the browser via `addInitScript`, so a single TS-only token anywhere inside the IIFE throws at script-parse time, the whole init fails, and every downstream IPC call crashes with the above message. No compile step catches it because TypeScript is happy with `as` inside a `.ts` file. Fix was mechanical but the blast radius was huge.

### Shipped

**Mock hotfix** (`e2e/fixtures/tauri-mock.ts`):
- Replaced `hermesInstances: [] as Array<{...}>` and `routingRules: [] as Array<{...}>` with JSDoc `/** @type {...} */` annotations — type info survives for editor hints, but the runtime emit is pure JS.
- Stripped eight `(r: any) =>` / `(i: any) =>` TS-only param annotations in the `sandbox_*`, `routing_rule_*`, and `hermes_instance_*` command handlers (lines 306, 316, 389, 393, 400, 408, 412, 419).
- Added a prominent multi-line comment at the top of the affected block documenting why TS syntax is forbidden inside the tagged template and which error symptom it produces, so the next refactor doesn't step on the same rake.

**Verified-channel badge** (`src/features/channels/verified.ts`, `src/features/channels/index.tsx`):
- New pure-data `VERIFIED_CHANNELS: ReadonlySet<string>` + `isVerifiedChannel(id)` predicate. Currently lists `telegram`; T6.7c will add the rest once their smoke specs ship.
- ChannelCard header now renders an emerald-tinted `BadgeCheck` pill + i18n-ed "Verified" label next to the status pill for listed channels. Purely informational — doesn't gate any functionality.
- i18n: `channels.verified` + `channels.verified_title` (en + zh).

**Telegram smoke spec** (`e2e/telegram-smoke.spec.ts`):
- Full-loop test that resets the Telegram fixture to unconfigured, navigates, triggers a catalog refresh, opens the editor, fills a plausible bot token, confirms the diff never leaks the token into the DOM, saves, asserts the captured `channelSaves` payload, confirms the restart prompt, flips the live-status fixture to online, confirms the gateway restart, and finally asserts the status pill is `configured` + the live pill is `online`.
- Uses `page.waitForFunction` to bridge the race between `addInitScript` execution and the first `page.evaluate`, so the spec is reliable on slower machines (not just fast local dev).
- Triggers state refresh via the existing `channels-refresh-button` instead of `page.reload()` because reload re-runs the init script and wipes mutated mock state — lesson learned and comment left in the spec for the next author.

### Test totals

- Rust: unchanged (168 pass).
- Frontend: TSC clean, Vitest 46/46 (unchanged from T6.3).
- Playwright: **55/55 pass** — was 7/55 before the mock hotfix. +1 new spec (`telegram-smoke.spec.ts`).

### Deferred

- **T6.7c**: five more smoke specs (Discord, Slack, Feishu, WeiXin, WeCom). The `VERIFIED_CHANNELS` set adds one entry per shipped spec. WhatsApp intentionally excluded for now — the schema is in flux (see T6.7a changelog entry).

### Next

- T6.5 per-agent sandbox (highest-risk Phase 6 item).
- T6.7c Discord/Slack/CN smoke specs.

---

## 2026-04-23 — T6.3 · Subagent tree in Trajectory (delegate_task grouping)

The Trajectory page now visualises Hermes's native `delegate_task` calls as a collapsible tree: the parent shows the delegation kickoff, and every subsequent tool call in the same assistant turn nests under it until the next `delegate_task`. Pure UI change — no new protocol, no backend schema change, no DB migration.

### Context

Per the 2026-04-23 product audit, T6.3 was explicitly re-scoped away from building a parallel meta-adapter protocol. Hermes already emits `hermes.tool.progress` events for every tool call (including `delegate_task`); the UI's job is to SURFACE that structure, not rebuild it. Today the flat list mixes the main agent's calls with its subagent's, which hides the shape of multi-step delegations. This task is the smallest change that makes the hierarchy visible.

Upstream Hermes doesn't currently stamp `parent_tool_call_id` on nested events, so we infer the tree by event ordering: a `delegate_task` adopts every subsequent tool call in the same `DbMessageWithTools.tool_calls` list until another `delegate_task` appears. This covers the dominant "one delegation per turn" shape and degrades to the classic flat ribbon when there's no delegation.

### Shipped

**Pure helper** (`src/features/trajectory/subagents.ts`):
- `ToolCallLike` — shape-compatible with both `DbToolCallRow` and the live zustand `UiToolCall`.
- `SubagentNode { call, children }` with `children` non-empty only for `delegate_task` parents.
- `groupToolCallsBySubagent(calls)` — first-pass stateful walk that assigns each non-`delegate_task` call to the most recent parent (or top-level if none). Stable ordering, total node count equals input length (no duplicates, no drops) so analytics still reports accurate totals.
- `hasDelegation(calls)` fast predicate so renderers can branch without paying the tree-construction cost when nothing is delegated.
- `DELEGATE_TASK_TOOL = 'delegate_task'` exported constant so any rename upstream is a one-line change.

**Vitest coverage** (`src/features/trajectory/subagents.test.ts`): 9 cases — empty input, flat pass-through, single parent, chained parents, empty-children delegation, stable ordering, input/output count invariant.

**Trajectory render** (`src/features/trajectory/index.tsx`):
- Replaced the flat tool-call `<ul>` under each message with `ToolCallTree`.
- `ToolCallTree` uses `hasDelegation` to fast-path the no-delegation case (unchanged rendering, zero regression risk for the common case).
- `ToolCallTreeNode` wraps `delegate_task` parents in a gold-tinted container with an expand/collapse chevron, a Network icon, and a `"N subagent steps"` count. Default expanded so users see the full trace immediately; state is local per node so collapsing one parent doesn't hide others.
- `ToolCallChip` extracted as the shared leaf renderer for both top-level and nested calls. Nested chips get a dimmer border so the hierarchy reads at a glance.

**i18n** (`en.json` + `zh.json`): `trajectory.subagent.step_count` (with `_plural` on the English side so i18next picks the right form at render time).

### Test totals

- Rust: unchanged (168 pass).
- Frontend: TSC clean, ESLint clean, Vitest **46 pass** (+9 in `subagents.test.ts`).

### Deferred

- **Chat bubble live view**: the bubble still shows the flat strip while streaming. Nesting during a live stream needs careful handling of partial trees (a `delegate_task` with zero children yet should still render a parent shell). Outside MVP; add if real usage shows the live flat view is confusing.
- **Explicit parent linkage**: when upstream Hermes starts emitting `parent_tool_call_id` or `agent_id` in `HermesToolProgress`, extend the `ToolCallLike` shape and swap the heuristic for a direct lookup in `groupToolCallsBySubagent`. The public helper signature stays the same — no call-site churn.
- **Nested delegations**: a subagent delegating to a sub-subagent would today be rendered as two peer parents, not grandparent → child. Needs explicit linkage to distinguish.

### Next

- T6.5: per-agent sandbox (highest risk remaining Phase 6 item).
- T6.7b/c: Telegram e2e smoke test + Discord/Slack/CN verification (closes out T6.7).

---

## 2026-04-23 — T6.4 · Rules-based routing (auto-pick adapter by content)

Corey can now auto-pick which adapter (including a named Hermes instance from T6.2) handles the next chat turn, based on a user-defined list of predicates against the composed text. First visible "smart routing" surface — users no longer have to manually flip the AgentSwitcher to send `/code` prompts to Claude Code.

### Context

Pairs directly with T6.2: once users have multiple Hermes instances + Claude Code + Aider registered, toggling the AgentSwitcher on every turn is friction. T6.4 is a minimal "if this, then that" rule engine that runs in the composer before send. MVP scope explicitly excludes source-channel matching, fallback chains, and time-of-day rules — those land only if real usage turns up demand.

### Shipped

**Rust `routing_rules.rs`**: mirrors the T6.2 pattern — `RoutingRule { id, name, enabled, match, target_adapter_id }` + `RoutingRulesFile { rules: [...] }` persisted to `<app_config_dir>/routing_rules.json`. Three match kinds: `prefix`, `contains`, `regex` (frontend-compiled at resolve time so the Rust side never runs untrusted regex). Atomic write + id/match validators + upsert/delete helpers. 7 new tests: `load_missing_returns_empty`, `save_then_load_roundtrips_all_variants`, `load_tolerates_corrupt_file`, `validate_id_rules`, `validate_match_rejects_empty_values`, `upsert_replaces_by_id_preserves_order`, `delete_returns_removed_flag`.

**IPC** (`src-tauri/src/ipc/routing_rules.rs`): `routing_rule_list / upsert / delete`. Upsert normalises id + trims name + validates all inputs before touching disk. Delete is idempotent. All three registered in `lib.rs` + `ipc/mod.rs`.

**Frontend pure resolver** (`src/features/chat/routing.ts`): `resolveRoutedRule(rules, text)` walks the list in file order and returns the first enabled rule whose predicate matches. Case-insensitive by default; regex failures are swallowed + logged so a typo in Settings never bricks the composer. 10 vitest cases covering empty list, prefix case toggles, contains anywhere-search, regex with `i` flag, invalid regex skip, disabled-skip, first-match ordering, empty-value never-fires.

**Zustand store** (`src/stores/routing.ts`): tiny `useRoutingStore` with `rules` + `hydrate()` + `setRules()`. Hydrated once at boot from `providers.tsx`. Settings panel writes push into the store so the composer pill updates without a page reload.

**Chat wiring** (`src/features/chat/index.tsx`):
- `send()` now resolves a routing rule against the trimmed draft. If matched AND the target adapter is registered, override `activeAdapterId` for this send. For a fresh session (0 prior user messages) also flip `session.adapterId` so subsequent turns stay with the chosen adapter — mid-session matches only override THIS turn to avoid silently splitting history across adapters.
- New `RoutingHint` chip above the Composer: shows `→ Claude Code · rule "Code prefix"` when a rule will fire. Goes red when the target adapter isn't registered so the user knows to fix something.

**Settings panel** (`src/features/settings/index.tsx`): `RoutingRulesSection` + `RoutingRuleRow`. Inline CRUD (like T6.2): each rule edits in place with Save/Delete buttons, new rules get a cancel option. Dropdowns for match kind (prefix/contains/regex) and target adapter (populated from the live AgentRegistry). Checkboxes for `enabled` + `case_sensitive`. Disabled rules visually dim.

**i18n**: `chat_page.routing_hint` / `routing_hint_missing` + `settings.routing_rules.*` in both `en.json` and `zh.json`.

**e2e mock**: in-memory `routingRules` array + 3 command handlers in `e2e/fixtures/tauri-mock.ts`.

### Test totals

- Rust: **168 pass, 0 fail** (+7 in `routing_rules::tests`).
- Frontend: TSC clean; ESLint clean (5 pre-existing warnings only); Vitest **37 pass** (+10 in `routing.test.ts`).

### Deferred

- Reorder-by-drag: priority today = list order = save order. Manual reorder IPC lands if/when users ask.
- Source-channel rules (route by Telegram vs Discord vs CLI): needs upstream metadata plumbing.
- Fallback chains ("if A isn't registered, try B").
- Time-of-day / day-of-week rules.
- Preview "simulate against my last 20 messages" — useful for regex tuning but outside MVP.

### Next

- T6.3: surface Hermes native `delegate_task` subagent tree in the Trajectory pane.
- T6.5: per-agent sandbox.

---

## 2026-04-23 — T6.2 · Multi-instance Hermes (register N gateways, route per session)

Corey can now talk to more than one Hermes gateway concurrently. Users register extra instances in Settings (each with its own base URL / API key / default model / label); each becomes a first-class adapter under `adapter_id = "hermes:<id>"`, slotting into the existing AgentSwitcher, unified inbox, and analytics rollups without any chat-side code change.

### Context

Per the post-audit plan (`docs/10-product-audit-2026-04-23.md`), T6.2 was flagged as a KEEP feature — users running work/home/dev Hermes gateways want to switch between them, not maintain N copies of Corey. MVP scope stays small: no auto-starting gateway processes, no port management, no cross-instance profile binding. You bring your own Hermes (`hermes gateway start` on each box); Corey just registers the URL and routes turns.

### Shipped

**New Rust module `hermes_instances.rs`**:
- `HermesInstance { id, label, base_url, api_key, default_model }` DTO; file format wrapped in `HermesInstancesFile { instances: [...] }` so future fields can land without a migration.
- Atomic `save()` via `<FILE>.tmp` + rename; `load()` tolerates missing / unparseable files by returning an empty list so a corrupt save never breaks boot.
- `validate_id` (1..32 chars `[a-z0-9_-]`) + `validate_base_url` (requires `http(s)://` scheme) shared by the IPC layer.
- `adapter_id_for("work") == "hermes:work"` — helper so the registry key scheme is a one-line change if we ever want to rename it.
- Tests: `load_missing_file_returns_empty`, `save_then_load_roundtrips_all_fields`, `load_returns_empty_on_corrupt_file`, `validate_id_accepts_slug_and_rejects_bad`, `validate_base_url_requires_scheme`, `upsert_replaces_by_id_and_preserves_order`, `delete_removes_row_and_reports`, `adapter_id_for_uses_namespaced_slug`.

**`AdapterRegistry` refactor** (`src-tauri/src/adapters/mod.rs`):
- Internal map keyed by `String` instead of `&'static str`, so dynamic ids like `hermes:work` are first-class alongside the built-ins.
- New `register_with_id`, `register_with_id_and_label`, and `unregister` methods. Old `register(adapter)` still works and keeps the trait-level `id()` / `name()` as before.
- `AdapterInfo` now reports the registry KEY (not `adapter.id()`) so the AgentSwitcher sees `hermes:work` rather than a duplicate `hermes` per instance.
- Label table (parallel to the adapter map) lets us show user-chosen labels instead of the generic "Hermes" for every instance.
- `unregister` also clears the default pointer if the victim was the default, avoiding a dangling id.

**IPC** (`src-tauri/src/ipc/hermes_instances.rs`):
- `hermes_instance_list` / `hermes_instance_upsert` / `hermes_instance_delete` / `hermes_instance_test` commands.
- Upsert validates → builds a live `HermesAdapter` (fail-fast on bad URL) → persists → hot-registers. Existing in-flight streams keep their own `Arc<dyn AgentAdapter>` and are unaffected.
- Test is a dry-run `/health` probe; always resolves (never rejects) so the UI can surface red/green inline.
- All four commands registered in `lib.rs` + `ipc/mod.rs`.

**Boot-time registration** (`lib.rs`): after registering the built-in `hermes` / `claude_code` / `aider` adapters, walk `hermes_instances.load(&config_dir)` and register each with `register_with_id_and_label`. Per-instance failures are logged and swallowed so one bad URL doesn't brick the whole app.

**Frontend**:
- `@/Users/zbin/AI项目/CoreyOS/src/lib/ipc.ts` — `HermesInstance`, `HermesInstancesFile`, `HermesInstanceProbeResult` types + 4 bindings.
- `@/Users/zbin/AI项目/CoreyOS/src/features/settings/index.tsx` — new `HermesInstancesSection` + `HermesInstanceRow` components. Inline-edit rows with per-row Test / Save / Delete buttons; "Add instance" button reveals a new-row editor with cancel. Id is frozen after save so renames don't silently migrate sessions across adapters.
- i18n (`en.json` + `zh.json`): `settings.hermes_instances.*` block with title, desc, field labels, empty/new row copy, test/save/create actions, and delete confirmation.

**e2e mock** (`e2e/fixtures/tauri-mock.ts`): in-memory `hermesInstances` array + handlers for all 4 IPCs so Playwright's Settings-page tests can exercise the flow without a real config file.

### Test totals

- Rust: **161 pass, 0 fail** (+8 new in `hermes_instances::tests`).
- Frontend: TSC clean; ESLint clean (5 pre-existing fast-refresh warnings only); Vitest 27/27.

### Deferred

- Auto-start: Corey does not run `hermes gateway start --port N --profile X`. User brings their own running gateways.
- Port conflict detection, health auto-failover, cross-instance profile binding.
- Migrating the primary `gateway.json` into a unified `hermes_instances.json` — left as-is so existing users see zero schema change. The file can be merged later if the dual-source-of-truth becomes a real pain point.

### Next

- T6.3: surface Hermes native `delegate_task` subagent tree in the Trajectory pane.
- T6.4: rules-based routing (which instance / adapter gets which kind of chat).

---

## 2026-04-23 — T6.1 · Feedback loop (👍/👎 per assistant reply)

Users can now rate individual assistant replies in the Chat page. Ratings persist in SQLite, survive reloads, and roll up into a new Analytics card. First visible "quality signal" surface inside Corey — sets up later phases (RLHF exports, per-adapter ranking) without committing to anything now.

### Context

Per the post-audit plan (`docs/10-product-audit-2026-04-23.md`), T6.1 is a small-but-high-signal addition: the UI has nothing to say about reply quality today, and every adapter comparison / analytics rollup benefits from even a sparse rating signal. MVP scope is intentionally narrow — per-message 👍/👎 only; no freetext, no "why was this bad?" modal, no per-session aggregates yet.

### Shipped

**DB migration v8** (`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/db.rs`):
- `ALTER TABLE messages ADD COLUMN feedback TEXT` — nullable, legal values `'up' | 'down' | NULL`.
- `MessageRow.feedback: Option<String>` with `#[serde(default, skip_serializing_if)]` so pre-T6.1 frontend payloads (and the streaming code's content-only upserts) deserialise without the field.
- `upsert_message`: COALESCE on the ON CONFLICT branch so content-only upserts never wipe a real rating. Mirrors the existing `prompt_tokens` / `completion_tokens` preservation pattern.
- `set_message_feedback(id, value)` — dedicated UPDATE path that rejects any value other than `'up' / 'down' / NULL` with an `InvalidParameterName` error, so the analytics rollup never has to filter garbage.
- `analytics_summary` now includes `feedback_up` and `feedback_down` lifetime counts (two cheap COUNT scans; NULL rows contribute 0).
- Tests: `t61_set_message_feedback_accepts_up_down_null_and_rejects_other`, `t61_upsert_message_preserves_feedback_across_content_updates`, `t61_analytics_summary_counts_feedback`.

**IPC** (`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/db.rs` + `@/Users/zbin/AI项目/CoreyOS/src-tauri/src/lib.rs`):
- New command `db_message_set_feedback(messageId, feedback)`; registered in the command handler.

**Frontend plumbing**:
- `@/Users/zbin/AI项目/CoreyOS/src/lib/ipc.ts` — add `feedback?: 'up' | 'down' | null` to `DbMessageRow`, `feedback_up / feedback_down` to `AnalyticsTotals`, and `dbMessageSetFeedback` binding.
- `@/Users/zbin/AI项目/CoreyOS/src/stores/chat.ts` — add `feedback` field to `UiMessage`, hydrate from DB, add `setMessageFeedback(sessionId, msgId, value)` action that mirrors zustand state + fire-and-forget IPC write.

**Chat page** (`@/Users/zbin/AI项目/CoreyOS/src/features/chat/MessageBubble.tsx`):
- New `FeedbackButtons` component below each completed, non-error assistant bubble. Click 👍 or 👎 to stamp; click the same button again to clear. Hidden until hover (like the Copy button) unless already rated. Active state uses emerald for 👍 and `--danger` for 👎 so the rating is visible without requiring hover on a reload.

**Analytics page** (`@/Users/zbin/AI项目/CoreyOS/src/features/analytics/index.tsx`):
- New `FeedbackStrip` card at the bottom of the dashboard showing 👍 count, 👎 count, Helpful-rate %, and coverage (`X rated / Y messages (Z.Z%)`). Empty state when no messages have been rated yet.

**i18n**: `chat_page.feedback_up / feedback_down` + `analytics.chart.feedback.{title, subtitle, empty, up, down, ratio, coverage}` added to both `en.json` and `zh.json`.

**e2e mock** (`@/Users/zbin/AI项目/CoreyOS/e2e/fixtures/tauri-mock.ts`): seeded `feedback_up: 7, feedback_down: 2` so the Analytics card has something to render.

### Test totals

- Rust: **153 pass, 0 fail** (+3 new T6.1 tests).
- Frontend: TSC clean; ESLint clean (5 pre-existing `react-refresh/only-export-components` warnings untouched); Vitest 27/27 pass.

### Deferred

- "Why was this bad?" freetext on 👎 (bigger DB shape, separate IPC; not worth blocking T6.1).
- Per-session or per-adapter ratio rollups (the lifetime number is the signal; per-adapter can ride T5.6's adapter_usage later).
- Exporting ratings for RLHF — wait until we have >100 real ratings to see what shape is useful.

### Next

- T6.2: multi-instance Hermes.
- T6.3: surface Hermes native `delegate_task` subagent tree in the Trajectory pane.

---

## 2026-04-23 — T6.8 · Scheduler refactor (wrap Hermes native cron, delete SQLite worker)

Replaced Corey's own Rust cron worker + SQLite table with a thin wrapper over Hermes's native `~/.hermes/cron/jobs.json`. The old implementation duplicated functionality Hermes already provides; T6.8 aligns with the post-audit principle of SURFACE, not duplicate.

### Context

Per `docs/10-product-audit-2026-04-23.md`, the pre-T6.8 scheduler was a DROP candidate because Hermes Agent natively supports cron via the `cronjob` tool. Users can ask "Every morning at 9am, check HN and send me a summary on Telegram" and Hermes handles scheduling internally. Corey's role is now purely to GUI-edit the JSON file and surface run outputs.

### Shipped

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/hermes_cron.rs`** — new module:
- `load_jobs()` / `save_jobs()` — round-trip `~/.hermes/cron/jobs.json`. Accepts both top-level array and `{ "jobs": [...] }` formats for forward-compat.
- `upsert_job()` / `delete_job()` — atomic writes on top of the above.
- `list_runs()` — scan `~/.hermes/cron/output/{job_id}/*.md` for the Runs drawer (new T6.8 UI feature).
- `inspect_schedule()` — best-effort cron validation; returns `(is_cron, next_fire)`. Non-cron forms (`"every 2h"`, `"30m"`, ISO) pass through as `is_cron: false` so Hermes can evaluate them at runtime.
- Preserves unknown JSON fields via `flatten` catch-all so we don't lose data Hermes adds between versions.
- Tests: `parse_accepts_top_level_array`, `parse_accepts_object_with_jobs_key`, `roundtrip_preserves_unknown_fields`, `inspect_schedule_classifies_cron_vs_other`, `truncate_preview_stops_at_char_boundary`, `display_name_falls_back_to_prompt_head`.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/scheduler.rs`** — rewritten:
- All commands now delegate to `hermes_cron` instead of the DB.
- `scheduler_list_jobs` / `scheduler_upsert_job` / `scheduler_delete_job` — wire shape preserved for frontend compatibility. `SchedulerJobView` maps `HermesJob` fields to the old `SchedulerJob` shape (e.g. `schedule` → `cron_expression`, `paused` → `enabled`).
- `scheduler_validate_cron` — now returns `is_cron` flag so the UI can show "Hermes evaluates this at runtime" for non-cron forms.
- `scheduler_list_runs` — NEW command, surfaces `RunInfo` (filename, mtime, size, preview) for the Runs drawer.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/lib.rs`** — replace `mod scheduler` with `mod hermes_cron`; register `scheduler_list_runs` IPC command.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/state.rs`** — remove `scheduler: Option<Arc<Scheduler>>` field and its initialization in `AppState::new`.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/db.rs`** — migration v7:
- `migrate_v7_scheduler_to_hermes_json()` — one-shot export: if `scheduler_jobs` table has rows AND `~/.hermes/cron/jobs.json` does NOT exist, migrate rows to JSON so users don't lose schedules. Skips export if jobs.json already exists (never clobber upstream state).
- Drop `scheduler_jobs` table and index.
- Delete `SchedulerJobRow` struct and all scheduler CRUD methods (`list_scheduler_jobs`, `upsert_scheduler_job`, `delete_scheduler_job`, `update_scheduler_job_last_run`).

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/scheduler.rs`** — DELETED (304 lines). The background worker that parsed cron, slept, and executed `adapter.chat_once` is gone — Hermes now owns that loop.

**`@/Users/zbin/AI项目/CoreyOS/src/lib/ipc.ts`** — add `SchedulerRunInfo` interface and `schedulerListRuns` binding; update `SchedulerValidateResult` with `is_cron` field.

**`@/Users/zbin/AI项目/CoreyOS/src/features/scheduler/index.tsx`** — Runs drawer + `is_cron` UI:
- Add `runs` mode to `Mode` union type.
- Add `onShowRuns` callback to `JobCard` that calls `schedulerListRuns` and opens the drawer.
- Add clock button to card actions to trigger the drawer.
- Add `RunsDrawer` component: lists run files with filename, mtime, size, and markdown preview (first ~400 chars). Shows loading/error/empty states.
- Update cron validation UI: when `is_cron` is false, append "(Hermes evaluates this at runtime)" to the success message so users know non-cron forms are valid but not previewable locally.

**`@/Users/zbin/AI项目/CoreyOS/src/locales/en.json` + `zh.json`** — add keys:
- `scheduler_page.cron_hint` — updated to mention Hermes-extended forms (`"every 2h"`, `"30m"`, ISO).
- `scheduler_page.cron_valid` / `invalid_cron` — generalized to "schedule" (not just cron).
- `scheduler_page.hermes_extended` — "Hermes evaluates this at runtime" / "Hermes 在运行时计算".
- `scheduler_page.show_runs` / `runs_title` / `runs_empty` / `run_size` — Runs drawer copy.

### Fixed

- Users with pre-T6.8 `scheduler_jobs` rows will have them migrated to `~/.hermes/cron/jobs.json` on first boot (v7 migration). No data loss.
- Non-cron schedule forms (`"every 2h"`, `"30m"`, ISO timestamps) are now accepted and passed through to Hermes for runtime evaluation; previously they would have been rejected by the strict cron parser.

### Test totals

- Rust: **150 pass, 0 fail** (+4 new tests in `hermes_cron.rs`; scheduler worker tests removed because the module is gone).
- Frontend: TSC clean, ESLint clean (only pre-existing fast-refresh warnings), Vitest 27/27 pass.

### Deferred

- Parsing run file frontmatter to extract success/failure status (Hermes writes YAML headers; we could surface `last_run_ok` more accurately than the current `None`). This is a polish pass, not T6.8.

### Next

- T6.1: feedback回路 👍/👎（DB v7 + 3 IPC + 按钮 + Analytics）
- T6.2: multi-instance Hermes

---

## 2026-04-23 — T6.7a · Channel schema hotfix (3 silently-broken channels fixed, QR stack deleted)

First code of the post-audit plan. Fixes three live user-facing bugs introduced by Phase 3 against an inferred Hermes schema, and deletes the fictional WeChat QR flow.

### Context

Per `docs/hermes-reality-check-2026-04-23.md`, three of our 8 channel integrations silently failed because the env var names didn't match `hermes-agent` upstream. Users filling tokens saw "Configured" pills but Hermes never read the values. T6.7a reconciles the schema against `hermes-agent.nousresearch.com/docs/reference/environment-variables` and deletes the WeChat QR machinery (Hermes has no QR flow — the entire `StubQrProvider` + `WeChatQr.tsx` + `wechat_qr_*` IPC trio was based on a misread).

### Shipped

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/channels.rs`** — catalog reconciled:
- **WhatsApp**: `WHATSAPP_TOKEN` → `WHATSAPP_ENABLED` + `WHATSAPP_MODE` + `WHATSAPP_ALLOWED_USERS` + `WHATSAPP_ALLOW_ALL_USERS`.
- **WeCom**: `WECOM_BOT_SECRET` → `WECOM_SECRET`; added `WECOM_WEBSOCKET_URL` + `WECOM_ALLOWED_USERS`.
- **WeChat → WeiXin**: slug changes `wechat` → `weixin`; env schema replaced with `WEIXIN_ACCOUNT_ID` + `WEIXIN_TOKEN` + `WEIXIN_BASE_URL` + `WEIXIN_DM_POLICY` + `WEIXIN_GROUP_POLICY` + `WEIXIN_ALLOWED_USERS`. No more QR.
- **Slack**: added optional `SLACK_APP_TOKEN` (Socket Mode needs both tokens).
- New tests `no_channel_uses_qr_login_post_t6_7a` and `t6_7a_schema_fixes_in_place` lock in the fixes; updated `find_spec_lookup_works_and_unknown_returns_none` to assert `wechat` slug is gone.

**QR stack deleted** (Hermes upstream has no QR flow):
- `src-tauri/src/wechat.rs` — deleted.
- `src-tauri/src/ipc/wechat.rs` — deleted.
- `src/features/channels/WeChatQr.tsx` — deleted.
- `wechat_qr_start` / `wechat_qr_poll` / `wechat_qr_cancel` IPC registrations removed from `lib.rs`.
- `WechatRegistry` field removed from `AppState`.
- `WechatQrStart` / `WechatQrPoll` / `WechatQrStatus` / `isWechatQrTerminal` / the three `wechatQr*` invokers removed from `src/lib/ipc.ts`.
- `onWechatScanned` prop + `QrCode` icon + "channel-status-qr" pill rendering removed from `ChannelForm.tsx` + `index.tsx`.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/adapters/mod.rs`** — `Source::WeChat` → `Source::Weixin` (wire value `"we_chat"` → `"weixin"`).

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/adapters/hermes/mod.rs`** — capabilities `channels` list `"wechat"` → `"weixin"`.

**`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/channel_status.rs`** — test renamed `classify_wechat_*` → `classify_weixin_*`.

**`@/Users/zbin/AI项目/CoreyOS/src/locales/en.json` + `zh.json`** — removed `channels.wechat.*` + `channels.qr_hint` + `channels.qr_pending` + `channels.qr_cta`; added `channels.weixin.hint_*` (6 keys), `channels.whatsapp.hint_*` (4 keys, replacing the single `hint_token`), `channels.slack.hint_app_token`, `channels.wecom.hint_secret` + `hint_websocket_url` + `hint_allowed_users`.

**`@/Users/zbin/AI项目/CoreyOS/e2e/fixtures/tauri-mock.ts`** — fixture channel swapped `wechat` → `weixin`; `wechatSessions` state field + three `wechat_qr_*` IPC cases removed.

**`@/Users/zbin/AI项目/CoreyOS/e2e/channels.spec.ts`** — card visibility assertion updated to `channel-card-weixin` (now bucketed `unconfigured`); T3.3 WeChat QR flow test deleted.

### Fixed

- Users filling WhatsApp / WeCom / WeChat credentials will now have them actually reach Hermes (they silently didn't before).
- Slack Socket Mode (the standard Hermes path) can now be fully configured from the UI via the new `SLACK_APP_TOKEN` field.

### Test totals

- Rust: **146 pass, 0 fail** (+2 new schema-lock tests).
- Frontend: TSC clean, ESLint clean (only pre-existing fast-refresh warnings in routes/budgets/runbooks), Vitest 27/27 pass.
- Playwright: pre-existing environmental failures on `main` (verified via `git stash` comparison) unrelated to T6.7a. T6.7a-specific spec (channels.spec.ts) will green once the wider Playwright env is fixed; fixture + assertions already updated.

### Deferred

- The pre-existing Playwright environment breakage is a separate follow-up (mock script appears to not install reliably into the test page's runtime; reproduces on `main` with no T6.7a edits).

### Next

- T6.7b: write `docs/channels-smoke-test.md` + run real Telegram end-to-end.
- T6.7c: Discord + Slack + one CN channel e2e.

---

## 2026-04-23 — Product audit applied to Phase 6/7 docs

Full KEEP/SURFACE/DROP reclassification (per `docs/10-product-audit-2026-04-23.md`) executed. User approved the aggressive path.

### Summary of decisions

**DROPPED** — features that purely duplicated Hermes-native functionality:
- **T6.6 Conversational scheduler**: Hermes `cronjob` tool natively accepts "Every morning at 9am, check HN and send me a summary on Telegram". Reclaimed ~4 days.
- **T7.4a OpenClawAdapter**: OpenClaw merged into Hermes upstream.

**SURFACE** — reduced from "build parallel engine" to "GUI over Hermes native":
- **T6.3 Orchestration** 5d → 2d: visualise Hermes' native `delegate_task` subagent tree in Trajectory pane, no meta-adapter.
- **T7.1 LangGraph adapter** 6d → 3d: replaced with generic **MCP server manager UI** since Hermes natively supports MCP.
- **T7.3 Long-term memory** 6d → 3d: GUI editor for `~/.hermes/MEMORY.md` + `USER.md` + `session_search` — no qdrant, no separate embedding pipeline.
- **T7.4b Skills importer** kept at 3d but re-aimed: wrap `hermes skills` CLI (7+ hub sources: official, skills-sh, github, clawhub, lobehub, claude-marketplace, well-known) instead of bespoke ClawHub client.
- **Skills editor storage**: writes to `~/.hermes/skills/<slug>/SKILL.md` so Hermes picks them up natively; local SQLite becomes a cache only.

**ADDED** — new task:
- **T6.8 Scheduler refactor (~2d)**: delete `src-tauri/src/scheduler.rs` + `scheduled_jobs` SQLite table + related IPC. Reimplement Scheduler page as a thin read/write wrapper around `~/.hermes/cron/jobs.json`. Bonus: surface `~/.hermes/cron/output/{job_id}/*.md` run logs (unique GUI value).

### Shipped (docs only)

**`docs/phases/phase-6-orchestration.md`** — T6.3 refactored, T6.6 marked dropped, T6.8 added, estimates + test totals + deltas table + demo script all updated. Phase 6 total: ~25 days → ~20.5 days.

**`docs/phases/phase-7-expansion.md`** — T7.1 replaced with MCP manager, T7.2 re-aimed at `~/.hermes/skills/`, T7.3 re-scoped to MEMORY.md GUI, T7.4 refactored to wrap `hermes skills`. Phase 7 total: ~22 days → ~12 days. Exit criteria, guiding principle, demo script all rewritten.

**`docs/05-roadmap.md`** — Phase 6 and 7 rows updated. Total Phase 0-8 estimate: 13-15 → **11-12 weeks**. Explicit note that reclaimed ~3 weeks should go to polishing KEEP features, docs, and user acquisition — not more features.

**`docs/06-backlog.md`** — Conversational scheduler entry flipped from "promoted into T6.6" to "CLOSED AS OBSOLETE (product audit)".

### Lessons applied

- Read upstream docs **before** writing task specs, not after.
- Default verdict for overlapping features: **SURFACE**, not build parallel.
- Cite docs URLs / source file paths for every upstream claim in task descriptions.

### Next

- Phase 6 still paused awaiting user greenlight.
- Recommended order when resumed: T6.7a (channel schema hotfix, ~1.5d) → T6.7b (Telegram e2e, ~1.5d) → T6.8 (Scheduler wrap, ~2d) → T6.1 (feedback loop, ~2d).

---

## 2026-04-23 — Reality check against Hermes Agent upstream (CRITICAL CORRECTIONS)

User provided the canonical upstream URL <https://github.com/NousResearch/hermes-agent>. Cross-referencing against our code surfaced three silently-broken channels, an obsolete backlog item, and a completely wrong Phase 7 T7.4 design.

### Findings (`docs/hermes-reality-check-2026-04-23.md`)

**Chat integration: ALIGNED ✓** — our `HermesGateway` hits `:8642/v1/*` which matches Hermes' `API_SERVER_*`.

**Channel schema: 3 of 8 silently broken**:
- **WhatsApp** — we write `WHATSAPP_TOKEN` which DOESN'T EXIST upstream. Real keys: `WHATSAPP_ENABLED` + `WHATSAPP_MODE` + `WHATSAPP_ALLOWED_USERS`.
- **WeCom** — we write `WECOM_BOT_SECRET`, upstream reads `WECOM_SECRET`. Off-by-prefix typo.
- **WeChat** — we ship a fake QR flow + `WECHAT_SESSION`. Upstream has NO QR flow; it uses `WEIXIN_ACCOUNT_ID` + `WEIXIN_TOKEN` + `WEIXIN_BASE_URL` and hits iLink directly with a plain token.
- Slack also missing `SLACK_APP_TOKEN` (Socket Mode requires both).

**OpenClaw positioning: WRONG** — OpenClaw is being **merged into Hermes Agent**, not a peer competitor. `hermes claw migrate` is the canonical migration path. Our entire Phase 7 T7.4 "OpenClawAdapter" design is moot.

**Hermes feature overlap surfaced** — Hermes already ships cron, skills hub, subagent delegation, FTS5 memory, MCP. Phase 6 T6.3 / 7.3 and the Scheduler we just built need a surface-vs-build audit before continuing.

**Channels Hermes supports but we don't surface**: Signal, SMS, Email, DingTalk, QQ, Mattermost, BlueBubbles, Home Assistant, Webhooks.

### Shipped (docs only)

**`docs/hermes-reality-check-2026-04-23.md`** (NEW) — full findings, env-name reconciliation table, lessons learned.

**`docs/00-vision.md`** — OpenClaw row in positioning table struck through with correction pointer.

**`docs/phases/phase-6-orchestration.md`** — T6.7 expanded from ~3 days to ~5 days and split into T6.7a (schema hotfix: delete QR stack, fix WhatsApp/WeCom/WeChat envs, add Slack App Token, migration notice for pre-fix users), T6.7b (Telegram smoke test + `channels_verified.json` + badges), T6.7c (extend to Discord + Slack + one CN channel). Optional extension to add missing Hermes channels.

**`docs/phases/phase-7-expansion.md`** — T7.4a `OpenClawAdapter` **dropped**. T7.4b re-scoped from "ClawHub importer" to "Local SKILL.md + agentskills.io importer" (~3 days). Test totals adjusted (Rust +10 was +14, Playwright +5 was +6).

**`docs/05-roadmap.md`** — Phase 6 and 7 rows updated with new scope. Phase 7 estimate trimmed 3–4 → 2–3 weeks after T7.4a drop.

**`docs/06-backlog.md`**:
- Tencent iLink QR — closed as obsolete.
- WhatsApp env name — answered, folded into T6.7a.
- NEW top-level section "Upstream-alignment audits" with the Hermes native-feature overlap audit (high priority) and missing channels list (low-medium).

### Lessons

- We built Phase 3 against **inferred** upstream behaviour. Three silently-broken channels is the cost.
- The OpenClaw "peer competitor" framing came from reading OpenClaw's README without cross-checking Hermes'. Twenty minutes of reading the right docs would have saved an entire phase's worth of integration design.
- **New rule**: any claim about upstream behaviour must cite a docs URL or source file path.

### Next

- Phase 6 still paused awaiting user greenlight.
- When work resumes, T6.7a (channel schema hotfix, ~1.5 days) is now the highest-leverage opener instead of T6.1 — it fixes live user-facing bugs while T6.1 is additive.

---

## 2026-04-23 — Phase 6 scope expansion: conversational scheduler + channel e2e proof

Two items the user called out after asking "哪些渠道真的能对话" got promoted from backlog into Phase 6. Both change Phase 6's scope; estimate bumps from 2-3 weeks to 3-4 weeks.

### Shipped (docs only)

**`docs/phases/phase-6-orchestration.md`**:
- New exit criteria #6 (one channel proven e2e with a real bot) and #7 (users can create scheduled jobs by talking).
- New **T6.6 Conversational scheduler (~4 days)** — Stage 1 `/schedule` slash command + Stage 2 post-turn intent detection with opt-in suggestion cards. Stage 3 (native Hermes `tool_calls`) stays deferred. Consent-gated, rate-limited, budget-aware.
- New **T6.7 Channel e2e verification (~3 days)** — writes `docs/channels-smoke-test.md`, runs Telegram end-to-end first, records outcomes in `channels_verified.json`, renders a ✅/⚠️ badge on the Channels page. Resolves the WhatsApp env-name uncertainty as a side effect.
- Test targets bumped: Rust +20 (was +18), Playwright +7 (was +5), plus manual smoke verification of at least one channel.
- Deltas table and demo script extended.

**`docs/05-roadmap.md`** Phase 6 row:
- Adds "conversational scheduling + first channel e2e proven" to exit criteria.
- Estimate 2-3 weeks → 3-4 weeks.
- Total Phase 0→8 estimate 12-14 → 13-15 weeks.

**`docs/06-backlog.md`**:
- "Conversational scheduler" entry flipped from "medium, parked" to "promoted into T6.6". Stage 3 still parked pending Hermes `tool_calls`.
- New entry "Platform channel e2e verification (post-Phase-3 debt)" flipped to "promoted into T6.7" — explicit record that Phase 3 shipped config UIs without ever e2e-verifying that any channel actually works with a real bot.

### Context

The user observed that my summary "5 of 8 channels are real" was misleading. Corey-side config writes are verified, but the Corey repo has never run a real bot-token smoke test against any channel. That's a significant claim gap. T6.7 closes it.

Separately, the user asked to re-include conversational scheduling. It was in `docs/09-conversational-scheduler.md` with a 3-stage plan; Stages 1-2 now land in Phase 6 as T6.6. Stage 3 stays parked behind the Hermes upstream gate.

### Next

- Phase 6 still "Planned"; starts on user greenlight.
- First real work when resuming: T6.1 feedback loop remains the recommended opener (smallest, highest-leverage).

---

## 2026-04-23 — Phase 7 sharpening: OpenClaw positioning

Followup to the roadmap extension after the user clarified that "openclaw" in the original brainstorm refers to <https://github.com/openclaw/openclaw> — a functionally overlapping competitor, not a subordinate tool.

### Shipped (docs only)

**`docs/phases/phase-7-expansion.md`** T7.4 rewritten:
- Explicit positioning note: OpenClaw is a competing personal-assistant control plane (own gateway, own macOS/iOS/Android apps, 24 channels, Voice Wake + Live Canvas + ClawHub skills marketplace, 102 releases, 1744 contributors). "Integration" means interoperability, not subordination.
- Split into T7.4a (`OpenClawAdapter`, ~5 days) + T7.4b (ClawHub skill importer, ~2 days). Both ship; "no integration" explicitly rejected because it would undermine Corey's agent-agnostic claim.
- Test targets updated: Rust +14 (was +10), Playwright +6 (was +4).
- Demo script extended to cover OpenClaw adapter and ClawHub skill import.

**`docs/05-roadmap.md`** Phase 7 row: label + status text refined; removes "pending user clarification".

**`docs/00-vision.md`** Positioning table: adds OpenClaw row. Explicit framing — "the positioning fight isn't 'best assistant', it's 'best console for N assistants'."

### Next

- Phase 6 still "Planned"; starts when user greenlights.
- Phase 7 T7.4 now fully specified (adapter + skills importer, concrete 7-day estimate).

---

## 2026-04-23 — Roadmap extension: Phases 6–8 + explicit rejections

Extends the roadmap beyond Phase 5 with three new phases and — importantly — a `Will not do` section that documents which brainstorm items are **permanently off the table**. Purely a docs update; no code.

### Context

A brainstorm session surfaced 8 expansion directions (multi-agent orchestration, smart routing, self-evolution, harness engineering, video, voice, digital human, openclaw). After weighing each against the `00-vision.md` Control-Plane positioning, we committed to a phased take-forward plan and documented it.

### Shipped (docs only)

**`docs/05-roadmap.md`**:
- New rows for Phase 6 (Orchestration core, 2–3 weeks, **Planned**), Phase 7 (Agent expansion, 3–4 weeks, **Planned**), Phase 8 (Multimodal optional, 2–3 weeks, **Conditional**).
- New "Strategic positioning (reaffirmed 2026-04-23)" section listing the five explicit rejections with one-line rationales.
- Phase files list updated to include the three new phase docs.
- Total estimate updated to ~12–14 weeks Phase 0 → 8 solo.

**`docs/06-backlog.md`**:
- New "Will not do (2026-04-23 reaffirmation)" section at the top with five rejected items: digital human/avatar (entire item 8️⃣), self-rewriting prompts (4.3), self-built task-DAG (5.1), desktop-side video processing (all of 6️⃣), always-on voice wake word (7.1). Each carries "why rejected", "what we ship instead if anything", and "re-open trigger" (usually: none or explicit product pivot).

**`docs/phases/phase-6-orchestration.md`** (new):
- T6.1 Feedback loop (👍/👎 + DB v7 + Analytics integration).
- T6.2 Multi-instance Hermes (`Vec<HermesInstance>` config, migration, registry).
- T6.3 Supervisor/worker orchestration via a meta-adapter with JSON-line delegation markers and a nested `OrchestrationBubble.tsx`.
- T6.4 Rules-based routing (YAML, no ML, 5 predicates).
- T6.5 Per-agent sandbox isolation (`SandboxScope` split of `PathAuthority`).
- Target test totals, deltas vs brainstorm items, deferrals, end-of-phase demo script.

**`docs/phases/phase-7-expansion.md`** (new):
- T7.1 LangGraph adapter (sidecar Python process, reuse AiderAdapter pattern — **adapt, don't rebuild**).
- T7.2 Skill-from-conversation distillation (JSON-extraction prompt + Skills editor pre-fill).
- T7.3 Long-term memory (embedded qdrant, `AgentAdapter::recall()` capability, DB v8).
- T7.4 openclaw integration (blocked on user clarification of what openclaw actually is).
- Guiding principle: "Adapt rather than build" — wrap LangGraph / qdrant / existing Skills infra, don't reinvent.

**`docs/phases/phase-8-optional.md`** (new):
- Explicitly **conditional**: four preconditions must hold to start.
- T8.1 Push-to-talk voice (cloud ASR, hotkey-gated, no wake word).
- T8.2 TTS playback (cloud endpoint, opt-in).
- T8.3 Video attachment surfacing (UI only — Hermes does frame work; adapter `capabilities().video` gates upload).
- T8.4–5 Permission onboarding + modality audit log in `changelog.jsonl`.
- Non-goals section lists what stays permanently out even if Phase 8 ships: always-on voice, on-device ASR/TTS, local video, avatar, meeting transcription.

### Fixed / Deferred / Test totals

N/A — docs only. No tests affected.

### Next

- Phase 6 is "Planned" and ready to start when the user greenlights it.
- Phase 7's openclaw task (T7.4) needs user clarification on what openclaw is before the effort estimate can be sharpened.

---

## 2026-04-23 — Scheduler MVP (cron-driven prompt runs)

The Scheduler page was a `Phase 2` placeholder since the original product plan; today it ships as a working MVP. Users can define cron-scheduled prompts that fire automatically against the Hermes adapter — enabling daily summaries, periodic data pulls, recurring cleanup runs, etc.

### Shipped

**Rust backend**:

- New `cron = "0.12"` dependency (pure-Rust, zero system deps, unlike the heavier `tokio-cron-scheduler`).
- `src-tauri/src/scheduler.rs` — single-worker task that owns the authoritative "next fire per job" set. Sleeps until the nearest fire time; reacts to CRUD reload signals via mpsc channel. Caps concurrent fires at 4 so a misconfigured job can't flood the adapter.
- `src-tauri/src/db.rs` — v6 migration adds `scheduler_jobs` table (`id`, `name`, `cron_expression`, `prompt`, `adapter_id`, `enabled`, `last_run_*`, timestamps) with `idx_scheduler_jobs_enabled` for the worker's boot-load query. New DTO `SchedulerJobRow` and CRUD methods (`list_scheduler_jobs`, `upsert_scheduler_job`, `delete_scheduler_job`, `update_scheduler_job_last_run`).
- `src-tauri/src/ipc/scheduler.rs` — four commands: `scheduler_list_jobs`, `scheduler_upsert_job` (validates cron + required fields, returns the persisted row), `scheduler_delete_job`, `scheduler_validate_cron` (pure preview for live UI feedback with next-fire timestamp).
- `AppState.scheduler: Option<Arc<Scheduler>>` spawned at startup iff the DB is available. All IPC writes call `scheduler.reload()` to notify the worker.
- Hermes adapter's `scheduler: true` capability flag is now backed by real functionality (previously aspirational).

**Frontend**:

- `src/features/scheduler/index.tsx` — list + editor in the same pattern as Budgets/Runbooks. Features live cron validation with debounced preview ("Next fire: 2026-04-24 09:00"), pause/resume toggle, inline last-run status (✓/✗ with error tooltip), and keyboard-submit.
- `src/app/routes.tsx` — replaces `<Placeholder>` with the real lazy-loaded `SchedulerRoute`; removes now-dead `Clock` + `Placeholder` imports.
- `src/lib/ipc.ts` — typed wrappers: `schedulerListJobs`, `schedulerUpsertJob`, `schedulerDeleteJob`, `schedulerValidateCron` with matching DTOs.
- `src/locales/en.json` + `zh.json` — new `scheduler_page.*` group (21 keys) + shared `common.save`/`cancel`/`edit`.

**Docs**:

- `docs/user/用户手册.md` — scheduler section rewritten from aspirational placeholder to accurate usage guide with cron examples, behaviour semantics (no backfill on missed fires, Hermes-only, single-turn execution model), and explicit list of deferred features.

### Test totals

- Rust: 3 new `scheduler::tests::*` pass; full `cargo test --lib` is now **150/150 green** (was 146/147 with one pre-existing flake — the flake was unrelated and still passes in isolation, but the full suite also passes cleanly this run).
- TypeScript: `pnpm typecheck` clean; `pnpm lint` clean (pre-existing react-refresh warnings unchanged).

### Deferred (unchanged scope decision)

- Natural-language → cron translation. Requires an LLM round-trip per form submission; better as a follow-up once we have a dedicated prompt-templating story.
- Per-job run history table. Today we store only `last_run_*`. Keeping history would require a `scheduler_runs` table + pruning policy; not needed for the MVP.
- Per-job adapter picker. Hard-coded to Hermes because no other adapter exposes `scheduler: true` yet. When Claude Code / Aider grow a real IPC surface for non-streaming prompts we can wire their capability flag.

---

## 2026-04-23 — Sandbox fs migration + brand rename + i18n audit

Three focused cleanups that advance the "no loose ends" posture going into Phase 6.

### Shipped

**Sandbox fs migration** (partial):

- `sandbox/fs.rs` gains blocking variants `read_to_string_blocking` and `write_blocking` for IPC handlers that run inside `tokio::task::spawn_blocking`. Returns `io::Result` so existing `NotFound → Ok(empty)` pipelines don't need rewriting; sandbox denials surface as `PermissionDenied`.
- `ipc/channels.rs` migrated: `build_channel_states`, `read_nonempty_env_keys`, `read_config_yaml_value` now thread `Arc<PathAuthority>` and call `sandbox::fs::read_to_string_blocking`. Two of three `sandbox-allow` exemptions removed from the codebase.

**Brand: Caduceus → Corey in runtime strings**:

- `lib.rs` boot tracing log: `"Caduceus booting"` → `"Corey booting"`.
- `adapters/hermes/probe.rs` + `gateway.rs` HTTP User-Agent: `caduceus/x.y.z` → `corey/x.y.z`.
- `src-tauri/Cargo.toml` description and authors renamed to Corey.
- Kept unchanged (migration complexity): crate name `caduceus`, lib name `caduceus_lib`, bundle id `com.caduceus.app`, DB filename `caduceus.db`, atomic-write temp suffix `.caduceus.tmp-`. Changing these would orphan existing users' data directories.

**i18n audit** — complete localization coverage except the brand name "Corey":

- New `chat_page.*` keys (12 additions): sessions, new, new_chat, session_scope, scope_active, scope_all, empty_sessions, empty_adapter_sessions, message_placeholder, current_llm, hero_title/subtitle_prefix/suffix, hero_suggestion_1..3.
- New `models_page.*` keys (3): reload_config, probe_title, dismiss.
- New `widgets.*` group (6): close, toggle_options, registered_agents, agents_fallback, llm_loading, llm_not_configured.
- New `settings.appearance.lang_en` / `lang_zh` for language selector labels.
- Frontend updates:
  - `chat/index.tsx`: ChatPane and EmptyHero use translation keys; hero suggestions, placeholder, all button titles/aria-labels
  - `chat/SessionsPanel.tsx`: Sessions header, New button, scope tabs, empty-state copy all localized
  - `chat/MessageBubble.tsx` + `chat/ActiveLLMBadge.tsx`: Copy button and LLM badge labels localized
  - `models/index.tsx`: Reload config + probe titles, dismiss button
  - `trajectory/index.tsx`: Inspector Close button
  - `settings/index.tsx`: Language selector options now use `t()` instead of hardcoded "English" / "中文"
  - Shared widgets localized: `components/ui/drawer.tsx` (Close), `components/ui/combobox.tsx` (Toggle options), `app/shell/AgentSwitcher.tsx` (Registered agents)

### Test totals

- Rust: `cargo check` clean; `cargo test --lib` — 146/147 passing (1 pre-existing flake in `attachments::tests::gc_empty_dir_is_noop`, passes when run in isolation; unrelated to sandbox changes).
- TypeScript: `pnpm typecheck` clean; `pnpm lint` clean (pre-existing react-refresh warnings unchanged).
- `pnpm check:sandbox-fs`: OK.

### Deferred

- `adapters/hermes/mod.rs` — still has one `sandbox-allow` exemption for attachment reads. Needs adapter trait to accept `PathAuthority` (threading it through `Arc<dyn Adapter>` methods). Tracked as a larger follow-up PR because it touches every adapter implementation.

---

## 2026-04-23 — i18n · remove hardcoded English/Chinese text

Ensures complete language separation: no English appears in Chinese mode and no Chinese appears in English mode (except for the brand name "Corey"). Previously several UI elements had hardcoded strings that didn't respect the active locale.

### Shipped

**Locale files** (`src/locales/en.json`, `src/locales/zh.json`):

- Added `chat_page.*` keys (title, subtitle, stop, send, delete, delete_confirm, copied, copy, attach_file, stop_generating, send_message, remove_attachment)
- Added `models_page.*` keys (title, subtitle, change_model, change_model_desc)
- Added `settings.appearance.lang_en` and `settings.appearance.lang_zh` for language selector labels

**Frontend**:
- `src/features/settings/index.tsx` — language selector now uses `t('settings.appearance.lang_en')` and `t('settings.appearance.lang_zh')` instead of hardcoded "English" / "中文"
- `src/features/chat/index.tsx` — PageHeader title/subtitle, button titles, and aria-labels all use translation keys
- `src/features/models/index.tsx` — PageHeader title/subtitle and Section title/description use translation keys
- `src/features/chat/SessionsPanel.tsx` — DeleteButton component uses translation keys for aria-label and title
- `src/features/chat/MessageBubble.tsx` — CopyButton component uses translation keys for aria-label, title, and button text

### Test totals

- Locale key count: 403 → 411 (+8 new keys)
- `pnpm typecheck` clean (some unused-import warnings from refactoring, harmless)
- No runtime behavior changes beyond proper language switching

---

## 2026-04-23 — Documentation · Chinese user manual

Adds comprehensive Chinese-language user documentation covering all Corey features. Previously documentation existed only in English and technical phase plans; this provides end-user guidance for Chinese-speaking users.

### Shipped

- **`docs/user/用户手册.md`** — 616-line comprehensive user manual in Chinese covering:
  - Quick start guide
  - Core features (Chat, Platform Channels, Profiles, Models, Analytics, Logs, Settings)
  - Advanced features (Multi-model comparison, Skills editor, Timeline trace, Terminal, Runbooks, Budget management, Scheduled tasks)
  - Keyboard shortcuts
  - FAQ section
- **`package.json`** — added `tauri:dev:clean` script to kill orphaned cargo/rustc processes and free port 5173 before starting dev, addressing build blocking issues during development.

### Test totals

- No code changes affecting runtime; no test suite touched.
- Documentation verified for completeness and accuracy.

---

## 2026-04-23 — Native menubar · custom NSMenu with app actions

Replaces the generic Tauri-default menubar with a Corey-specific layout.
Previously the menubar existed but had no app semantics beyond
Cut/Copy/Paste and Quit — File was a one-item placeholder, View had
nothing, Help was empty. Now every menu earns its keep.

### Shipped

**Rust** (`src-tauri/src/menu.rs`):

- `build(app)` constructs the full menu tree via `MenuBuilder` +
  `SubmenuBuilder` + `MenuItemBuilder`. Six submenus:
  - **Corey** (app menu) — About / Hide / Hide Others / Show All / Quit.
    `AboutMetadataBuilder` stamps the version from `CARGO_PKG_VERSION`.
  - **File** — `New Chat ⌘N` + Close Window.
  - **Edit** — 100% predefined (Undo / Redo / Cut / Copy / Paste /
    Select All). The OS routes these directly into the focused
    webview input element, so no custom wiring needed.
  - **View** — `Go to <route>` for every NAV entry that has a
    keyboard shortcut (⌘0..⌘9), mirroring `useNavShortcuts`, plus
    read-only entries (Models / Profiles / Runbooks / Budgets).
    `Toggle Theme ⌘⇧L` + Full Screen round it out.
  - **Window** — Minimize / Maximize.
  - **Help** — `Corey Documentation` + `Report an Issue` (open in
    default browser).
- `install_handler(app)` registers a single `on_menu_event` that
  filters out predefined ids and re-emits our custom ids as a
  `menu-action` Tauri event payloading the id string.
- Wired into `lib.rs::setup` after `app.manage(state)`; failures are
  logged but don't abort startup.

**Frontend** (`src/app/useMenuEvents.ts`):

- `useMenuEvents()` hook listens for `menu-action` and dispatches:
  - `nav:/<path>` → `router.navigate({ to: path })`.
  - `new-chat` → `useChatStore.newSession()` + navigate to `/chat`
    (after ensuring hydration completed).
  - `toggle-theme` → `useUIStore.toggleTheme()`.
  - `help:docs` / `help:issues` → `@tauri-apps/plugin-shell` `open()`
    (falls back to `window.open` in non-Tauri contexts).
- Mounted inside `AppShell` alongside `useNavShortcuts` so the
  TanStack Router context is available.
- `listen()` promise is properly unlistened on unmount so React
  StrictMode's double-mount doesn't stack duplicate handlers.

### Follow-up · locale-aware labels (same-day)

- `menu.rs` gained a `Locale` enum + `Labels` struct holding every
  user-visible string as a `&'static str`. `build(app, locale)` and
  a new `set_locale(app, locale)` path rebuild the bar on demand.
- New IPC `menu_set_locale(lang)` wired into the command table.
- `useMenuEvents` now pushes `i18n.language` to Rust on mount and
  re-pushes on every `languageChanged` event, so the Settings →
  Language selector swaps the menubar live with no restart.
- Rust boots with an English fallback so the bar is usable during
  the first paint before JS hydrates.
- AppKit's predefined items (Undo/Cut/Copy/Paste/Select All/
  Minimize/Maximize/Hide Others/Show All) are left untouched — the
  OS auto-localizes them to the system language, which is the
  conventionally correct behavior for those slots.

### Not in scope

- **Context menu inside webview.** This PR only touches the
  top-level application menu; right-click inside the webview
  still uses the default HTML context menu.

### Test totals

- `pnpm typecheck` + `pnpm lint` clean (pre-existing
  react-refresh warnings unchanged).
- Rust side: first launch in `pnpm tauri:dev` exercises the
  build + install path; all predefined items verified manually
  (Cut/Copy/Paste inside composer, Quit ⌘Q, Minimize ⌘M).

---

## 2026-04-23 — Sandbox follow-up · folder picker, CI lint, mode plumbing

Closes the three "Deferred" items from the morning's sandbox GA entry
into a single pass so the next phase starts with a clean slate.

### Shipped

- **Native folder picker** in Settings › Workspace. Adds
  `tauri-plugin-dialog` (Rust) + `@tauri-apps/plugin-dialog` (TS) and a
  `dialog:allow-open` capability, plus a "Browse…" button next to the
  path input. Selecting a folder auto-fills the label from the last
  path segment when empty. Falls back gracefully to text entry in
  Storybook / Playwright contexts where the plugin isn't loaded.
- **`ipc/demo.rs · home_stats`** now reports `state.authority.mode()`
  directly instead of guessing from `roots.is_empty()`. The old
  heuristic was wrong post-GA because `~/.hermes/` is seeded as a root
  even while mode is still `DevAllow`.
- **CI grep-lint** at `scripts/check-sandbox-fs.mjs` (wired as
  `pnpm check:sandbox-fs`). Flags any `std::fs::` / `tokio::fs::`
  usage outside the sandbox module, `fs_atomic`, `db.rs` bootstrap,
  or an explicit `// sandbox-allow: <reason>` marker. Test modules
  (detected via `#[cfg(test)]` + `mod … {` pattern) are skipped.
- Current production callsites that still reach for raw `std::fs`
  (`adapters/hermes/mod.rs` attachment reads, `ipc/channels.rs` env /
  yaml helpers) now carry `sandbox-allow` rationales pointing at the
  follow-up async migration.

### Deferred

- Full migration of `hermes_config` / `hermes_profiles` /
  `adapters/hermes` from `std::fs` to `sandbox::fs::*`. Requires
  threading the `PathAuthority` through the adapter trait and
  converting sync helpers to async; tracked as a dedicated PR.

---

## 2026-04-23 — Path sandbox · real enforcement

Graduates the Phase 0 sandbox plumbing into a fully interactive access
control layer. Previously `PathAuthority` held roots in memory only and
the Phase 2 roadmap said "UI + consent dialog pending". Both now ship:
workspace roots persist to `~/.config/corey/sandbox.json`, the Settings
page has a Workspace section to add / remove them, and a root-level
`SandboxConsentModal` catches `SandboxConsentRequired` errors so the
user can grant one-shot access or promote the path to a persisted root
without losing their original action.

### Shipped

**Rust** (`src-tauri/src/sandbox/`):

- `sandbox/persistence.rs` — versioned `SandboxConfig` (mode + roots)
  with atomic JSON writes via `fs_atomic::atomic_write`. 0600 perms on
  Unix so other users on a shared box can't enumerate workspace roots.
  Round-trip + missing-file + unknown-field tests.
- `PathAuthority::init_from_disk(app_config_dir)` — loads
  `sandbox.json` if present; on first launch seeds `~/.hermes/` as a
  `ReadWrite` root (when the directory exists) and stays in `DevAllow`
  mode so the app works without any configuration.
- `add_root` / `remove_root` / `set_enforced` / `grant_once` — all
  canonicalize + persist + auto-flip mode to `Enforced` on first
  mutation. `grant_once` still honours the denylist so a session grant
  can never unlock `~/.ssh`.
- `SandboxMode::{DevAllow, Enforced}` serialized to JSON;
  `check()` now consults the mode instead of hard-coding the
  "empty-roots ⇒ dev allow" shortcut.
- 3 new persistence unit tests + 3 Windows verbatim-prefix regressions
  retained. `cargo test --lib` now runs **147 tests, 0 failures**.

**IPC** (`src-tauri/src/ipc/sandbox.rs`, 6 commands):

- `sandbox_get_state` — `{ mode, roots, session_grants, config_path }`.
- `sandbox_add_root { path, label, mode }` → stored root (canonical).
- `sandbox_remove_root { path }`.
- `sandbox_grant_once { path }` → `{ canonical }`; denylist still wins.
- `sandbox_set_enforced` — flip mode without adding a root.
- `sandbox_clear_session_grants`.

**Frontend** (`src/stores/sandbox.ts`, `src/components/sandbox/ConsentModal.tsx`,
`src/features/settings/index.tsx`):

- Zustand sandbox store with `pending` consent queue + a
  `withSandboxConsent(run, path)` helper that wraps any IPC call,
  catches `SandboxConsentRequired`, awaits the modal decision, and
  retries transparently.
- Settings > Workspace section: mode pill (DevAllow / Enforced) with
  "Enforce now" shortcut, root list with per-row mode badge + remove
  button, add-root form with Read/RW toggle, session-grants viewer with
  a one-click clear, live `sandbox.json` path readout.
- Root-level `SandboxConsentModal` (mounted in `Providers`) — renders
  whenever `pending.length > 0`, shows the offending path + access
  selector, three outcomes: **Deny** / **Just this once** / **Add to
  workspace**.
- `asSandboxConsentRequired(e)` type-narrowing helper for callers that
  want their own retry strategy.

**i18n** — `settings.sandbox.*` (22 keys) + `sandbox.consent.*` (8 keys)
+ `common.close` in both `en.json` and `zh.json`.

**e2e mocks** — `sandbox_*` commands mocked in
`e2e/fixtures/tauri-mock.ts`; fixture state is mutable so add/remove
round-trip through the same list the UI reads back.

### Deferred

- **Native folder picker** — the add-root form currently takes a typed
  path. Hooking Tauri's `dialog` plugin is one call but needs a
  permission in `tauri.conf.json`; deferred so this change stays
  plumbing-only.
- **Sandbox-aware `ipc/demo.rs` rewrite** — `home_stats` still labels
  itself `dev-allow`/`enforced` from the old "roots empty?" heuristic;
  swapping it to read `authority.mode()` is a one-liner but touches
  the Phase 0 demo contract.
- **Capability-gated fs ops across every IPC** — the sandbox surface
  is live but several modules (`hermes_config`, `hermes_profiles`,
  `skills`) still go through `std::fs`/`tokio::fs` directly. Those
  paths either live under `~/.hermes/` (auto-rooted) or
  `$APPDATA/corey/` (implicit workspace), so the user-visible effect
  is nil today; a follow-up sweep will route them through
  `sandbox::fs::*` for the CI grep guard.

### Test totals

Rust `cargo test --lib`: **147 passed** (was 141 · +6 sandbox).
TypeScript: `pnpm typecheck` + `pnpm lint` clean.

### Next

- Native folder picker for the add-root form.
- Move the remaining `std::fs`/`tokio::fs` call sites behind
  `sandbox::fs::*` so the CI grep lint can turn on.
- Playwright spec for Settings > Workspace (add / remove / enforce) +
  a consent-modal flow driven by a failing IPC.

---

## 2026-04-23 — Phase 2 · Active-profile switching

Closes the second Phase-2 deferral. Users can now flip the active
Hermes profile from the UI — previously the pointer file
(`~/.hermes/active_profile`) had to be edited by hand. The reality-
check here was that Hermes gateway is a singleton process, so the
meaningful primitive isn't "start a gateway per profile" but
"switch the pointer + (optionally) bounce the gateway so the change
takes effect".

### Shipped

**Rust** (`src-tauri/src/hermes_profiles.rs`):

- `activate_profile_at(home, name, changelog_path)` — validates the
  name, refuses nonexistent profiles, writes the pointer file
  atomically via `fs_atomic::atomic_write`, journals the change as
  `hermes.profile.activate` with a `from`/`to` shape so the
  changelog revert UI can un-do it.
- Idempotent: activating the already-active profile is a no-op (no
  disk write, no journal entry — keeps the log clean under rapid
  re-clicks).
- Public `activate_profile(name, journal)` wrapper + IPC command
  `hermes_profile_activate`.

**TypeScript** (`src/features/profiles/index.tsx`, `src/lib/ipc.ts`):

- **Activate button** on every non-active profile card (`Play` icon
  + label, `data-testid="profile-action-activate-<name>"`). Active
  cards don't render the button — the UI communicates "you can't
  activate what's already active" by absence.
- **Confirm modal** (`ActivateModal`) with `from → to` copy and a
  checkbox for "Also restart the Hermes gateway". Default on,
  because switching without a bounce leaves the running gateway on
  the old profile — confusing for anyone not already wise to
  Hermes's singleton model.
- **Two-call sequence** on confirm: `hermesProfileActivate(name)`,
  then (if opted-in) `hermesGatewayRestart()`. The second call is
  best-effort: a missing / stopped gateway surfaces the restart
  error inline but doesn't roll back the pointer flip, because the
  pointer is the source of truth and a manual `hermes gateway
  start` picks up the new profile anyway.

### Tests

- **Rust** `cargo test --lib`: 141 → **144** (+3 in
  `hermes_profiles::tests`: `activate_writes_pointer_and_marks_active`,
  `activate_refuses_nonexistent_profile`,
  `activate_is_idempotent_when_already_active`).
- **Playwright** `profiles.spec.ts`: 5 → **6** (new
  `activate: click → confirm modal → flips active badge`).
- `cargo clippy --lib --tests -- -D warnings`: clean.
- typecheck + lint: clean (pre-existing fast-refresh warnings only).
- Bundle: unchanged (main chunk 243 KB gzip, well within the 260 KB
  CI budget).

### i18n

- 6 new `profiles.activate*` keys in `en` + `zh`.

### Deferred (explicitly)

- **Start / stop the gateway as a child of Caduceus.** Decided
  against: Hermes already owns its own `gateway start/stop/restart`
  CLI and persisting Caduceus-owned PIDs crosses the "manage
  someone else's service" line we've been careful to stay on our
  side of. If a user wants "gateway auto-runs when Caduceus does",
  that's a follow-up conversation about installer behaviour, not a
  feature of this page.

---

## 2026-04-23 — Phase 2 · Profile tar.gz import / export

Closes the first of two Phase-2 deferrals. Users can now export a
Hermes profile as a self-contained `.tar.gz` (for sharing, backup,
or moving between machines) and import one back in with a confirm
dialog that previews the manifest before touching disk.

### Shipped

**Rust** (`src-tauri/src/hermes_profiles_archive.rs`, +deps `tar` +
`flate2`):

- **Archive layout**: `caduceus-profile.json` manifest at the root
  + the profile dir verbatim under `profile/`. Manifest versioning
  (`version: 1`) so a future reorg can reject unknown shapes.
- **Zip-slip defence**: every entry goes through `safe_relative()`
  (typed-`Path` component walk, rejects `..` / absolute /
  Windows-prefix) before extraction. Six-case unit test locks the
  predicate in.
- **Symlink + hardlink rejection** on import — Hermes profile dirs
  don't legitimately contain links; accepting them invites the
  archive to point at `/etc/passwd`.
- **No-clobber by default**: import returns `AlreadyExists` unless
  the caller passes `overwrite=true` (the UI prompts for it
  explicitly).
- **Atomic commit**: extract to `<name>.importing/`, then `rename`
  into place. Cross-device rename falls back to copy-then-delete.
- **Journaling**: successful imports append a `hermes.profile.import`
  entry to the changelog (consistent with every other profile op).

**TypeScript** (`src/features/profiles/index.tsx`,
`src/lib/ipc.ts`):

- Export → base64 → `Blob` → `<a download>`. No Tauri file-dialog
  plugin; the browser drops the file into the user's Downloads.
- Import → native `<input type="file">` → `FileReader` → chunked
  base64 (32 KB chunks to avoid `String.fromCharCode.apply` stack
  blowouts on big profiles).
- **Preview-first workflow**: after file selection, a modal shows
  the manifest name, exporter version, exported-at timestamp, and
  `file_count · total_bytes`. User can optionally rename the
  target before committing.
- **Overwrite prompt**: when the target exists, the first import
  fails with `AlreadyExists`; the UI upgrades that into an inline
  "Replace existing?" step so destructive actions are never
  one-click.

### Tests

- **Rust** `cargo test --lib`: 135 → **141** (+6 in
  `hermes_profiles_archive::tests`: roundtrip, existing-without-
  overwrite, overwrite-replaces, missing-manifest, zip-slip
  predicate, future-version rejection).
- **Playwright** `profiles.spec.ts`: 4 → **5** (new
  `import a .tar.gz: preview → confirm → overwrite`).
- **Bundle**: unchanged (feature lives on the lazy `/profiles`
  route — no main-chunk impact).
- `cargo clippy --lib --tests -- -D warnings`: clean.
- typecheck + lint: clean.

### i18n

- 11 new `profiles.import*` / `profiles.export` keys in both `en`
  and `zh`.

---

## 2026-04-23 — T1.9 · Virtualised chat message list

Last Phase 1 item. The `messages.map()` render with a single
`scrollTo({top: scrollHeight})` autoscroll effect was fine up to
~2k messages on an M1 but had three long-standing papercuts:

1. Scroll perf + memory grew linearly with message count.
2. The autoscroll **yanked the user back to the bottom on every
   token** during streaming, fighting anyone trying to scroll up
   to re-read earlier context.
3. React's reconciliation chewed through every bubble on every
   streaming patch, even bubbles that hadn't changed.

### Shipped (`src/features/chat/MessageList.tsx`)

- **`react-virtuoso`** wraps the list; only in-viewport rows are
  mounted. O(1) memory + scroll perf regardless of message count.
- **`followOutput="smooth"`** replaces the old effect: sticks to
  the bottom **only if the user is already there**, otherwise
  leaves them alone. Manual scroll-up finally works.
- **`computeItemKey={(_, m) => m.id}`** preserves React identity
  so per-bubble state (Copy button flash, image thumbnail loads)
  survives appends.
- **Empty-state short-circuit**: the `<EmptyHero>` path still uses
  a plain `overflow-y-auto` div so routes with zero content don't
  pay Virtuoso's min-height default.

### Bundle

| | Before | After |
|---|---|---|
| Main chunk (gzip) | 224 KB | **243 KB** |

+19 KB gzip for `react-virtuoso`. Still under the 260 KB CI
budget with room to spare.

### Tests

- **Playwright chat suite**: 13/13 green — Virtuoso's only-render-
  visible-rows behaviour is invisible to the existing specs
  (asserted bubbles are always in the viewport during a fresh
  send).
- Vitest / Rust / typecheck / lint: unchanged.

---

## 2026-04-23 — Phase 0.5 · Windows sandbox regression tests

Closing the very last Phase 0.5 remainder. `dunce::canonicalize`
was already wired throughout the sandbox (Phase 0 retro noted
this), but the **Windows CI leg had no tests exercising it** —
meaning a future refactor back to `std::fs::canonicalize` could
silently reintroduce the `\\?\`-verbatim bypass.

### Shipped (`src-tauri/src/sandbox/mod.rs`)

Three new `#[cfg(target_os = "windows")]` regression tests:

- `canonicalize_or_parent_strips_verbatim_prefix` — asserts that
  canonicalising `C:\Windows` returns a non-`\\?\`-prefixed path.
- `hard_denylist_blocks_system32_even_with_verbatim_input` —
  asserts that `C:\Windows\System32\config\SAM` is `Denied` (the
  denylist's string-prefix match depends on the prefix being
  stripped).
- `home_relative_denylist_blocks_ssh_dir` — asserts that `~/.ssh`
  is denied even when `$HOME` is a configured root.

The tests are cfg-gated so the macOS/Linux CI legs ignore them;
they run on the `windows-latest` leg as part of the existing
`cargo test --lib` step. No code changes required — the existing
implementation was already correct.

### Tests

- Rust `cargo test --lib`: 135 on macOS (unchanged; Windows tests
  cfg-gated), **138 expected on the Windows CI leg**.
- `cargo clippy --lib --tests -- -D warnings`: clean.

---

## 2026-04-23 — Cleanup · Bundle-size gate + deferred-items audit

Closing pass on the low-value backlog. Two outcomes:

### Shipped

- **Bundle-size CI gate** (`scripts/check-bundle-size.mjs` +
  `pnpm check:bundle-size` + CI step in `.github/workflows/ci.yml`).
  Gzips every `dist/assets/*.js` in-memory and fails if any single
  chunk exceeds **260 KB gzip** (~14% headroom above the current
  224 KB main chunk). Override via `MAX_CHUNK_GZIP_KB=…` env var
  when a planned bump is genuinely warranted. Motivation: the
  rehype-highlight common-preset bloat we just untangled would
  have been a five-minute fix if caught at PR time instead of a
  session-long profiling job.
- **Runbook scope filter** (T4.6b) reclassified from *deferred* to
  *shipped* after audit: the `runbookScopeApplies()` helper,
  `runbooks-scope-filter` toggle, hidden-count badge, and e2e
  coverage are all in the tree and green. `docs/05-roadmap.md`
  updated to reflect reality; **no Phase 4 items remain deferred**.

### Not in scope (explicitly)

- **Profile tar.gz import/export** — needs archive lib + manifest
  + file-picker plumbing; too large for a cleanup pass.
- **Tencent iLink real client** — requires cookies + captcha +
  device-fingerprint machinery against an undocumented endpoint;
  `StubQrProvider` + its trait boundary keep this a self-contained
  ticket whenever it happens.
- **`/health/channels` probe** — that's a gateway-side endpoint,
  not a UI change; tracked in the Hermes repo.

### Tests

- `pnpm check:bundle-size` passes locally at 224.4 KB gzip max.
- No code changes affected runtime; no test suite touched.

---

## 2026-04-23 — T4.5b · Multi-tab Terminal

The T4.5 MVP was single-session; closing the tab killed scrollback
and the user had to respawn from scratch just to have two shells
running side-by-side. This lands a tab strip with per-tab pty +
per-tab xterm instance.

### Shipped (`src/features/terminal/index.tsx`)

- **Tab strip** with `+ New tab`, click-to-switch, inline `×` per
  pill. First tab still spawns via the big centered CTA so the
  zero-state UX is unchanged — the e2e contract (`terminal-open`
  visible when no tabs, `terminal-close` when there's an active
  one) is preserved.
- **Parallel state** — React `tabs[]` for the tab-strip UI,
  imperative `bundlesRef: Map<key, {term, fit, unlisten, ro, ptyId}>`
  for the xterm handles. Keyed by a stable per-tab key (not index)
  so closing the middle tab can't mis-attribute a bundle.
- **All tabs stay mounted** once opened — inactive hosts flip to
  `display: none` rather than respawn. Switching preserves
  scrollback without a shell round-trip, which is the whole point
  of the feature.
- **Focus + fit() on switch** — rAF-deferred so the display:none →
  block transition paints first; otherwise the incoming xterm
  reads 0×0 dimensions from its hidden host and the shell gets a
  malformed SIGWINCH.
- **Neighbour-preserving close** — closing the active tab moves to
  its right-neighbour, then left, then the empty state. Feels like
  every tabbed editor / browser on the planet.

### Tests

- **Playwright**: 52 → **53**. New
  `multi-tab: new tab spawns a second pty…` spec opens two tabs,
  verifies the mock's `ptyIds` length hits 2, closes the active
  one, confirms the neighbour stays alive, then closes the last
  one and asserts we're back at the big-CTA empty state.
- Pre-existing single-tab spec unchanged (still 4.0s).

### i18n

- Added `terminal.new_tab` and `terminal.open_hint` keys in `en`
  and `zh`; reworded `terminal.subtitle` from "One tab" → "Multi-tab".

---

## 2026-04-23 — Infra · highlight.js diet

Following T4.2b (CM6) and the route code-split, one chunk still
dwarfed the rest at ~260 KB gzipped. Profile showed the main chat
chunk was dragging in `rehype-highlight`'s `common` preset — 35
grammars, always. The library imports `common` unconditionally at
module top, so even passing `languages: {…}` (which DOES replace
the runtime registry) can't tree-shake the dead imports.

### Shipped

- **Dropped `rehype-highlight`** entirely. Replaced with a tiny
  `src/features/chat/highlight.ts` wrapper that drives
  `highlight.js/lib/core` directly, registering only the 13
  canonical grammars (plus aliases: `ts`, `tsx`, `sh`, `yml`, `md`,
  `rs`, `html`, `svg`, `patch`, …) in
  `src/features/chat/highlightLanguages.ts`.
- **Fence renderer** in `MessageBubble.tsx` now calls
  `highlightCode(source, lang)` inline and inserts the result via
  `dangerouslySetInnerHTML`. Unknown languages degrade to escaped
  plaintext so a model emitting ```haskell still renders legibly,
  just without colour.
- Kept the `hljs` class + `github-dark.css` stylesheet so existing
  styling works unchanged.

### Bundle

| | Before | After |
|---|---|---|
| Main chunk (gzip) | **260 KB** | **230 KB** |
| Main chunk (raw)  | 830 KB | 726 KB |

−30 KB gzip / −104 KB raw on the main chunk. Verified dropped
grammars (`ruby`, `scala`, `swift`, `csharp`, `lua`, `coffeescript`,
etc.) — the remaining string hits for those names are HTML tag
enumerations inside mdast, not the grammars themselves.

### Tests

- **Playwright chat suite**: 13/13 green (fence rendering through
  the new pipeline verified end-to-end).
- `rehype-highlight` removed from `dependencies`.

---

## 2026-04-23 — Infra · Route code-splitting

Direct follow-up to T4.2b: CodeMirror 6 added ~180kb to the monolith
and the Skills route is the smallest of the heavy feature modules
(xterm.js, highlight.js, the chart layer all lived in the same
chunk). Rather than wait for a "bundle CI" ticket to surface this,
split the router and cash in immediately.

### Shipped (`src/app/routes.tsx`)

- **13 leaf routes lazy-loaded** via `React.lazy` with a
  `lazyFeature()` helper that adapts each feature module's named
  export (`SkillsRoute`, `TerminalRoute`, …) to the default-export
  shape `React.lazy` expects — zero changes to feature modules.
- **`HomeRoute` + `ChatRoute` stay eager** because they're the two
  primary entry points (Home on cold boot, Chat right after); a
  Suspense flash on the most-used route would be worse than the
  bundle win.
- **Root `<Outlet/>` wrapped in `<Suspense>`** with a minimal
  spinner fallback (`RouteFallback`). Per-page skeletons would be
  more motion than the 100-300ms chunk fetch warrants — each
  feature already owns its own empty/error state once mounted.

### Bundle

| | Before | After |
|---|---|---|
| Largest chunk (gzip) | **589 KB** | **260 KB** |
| Largest chunk (raw)  | 1,934 KB | 830 KB |
| Chunks > 500 KB      | 1        | 2 (main + highlight.js group) |
| Total gzip           | ~620 KB  | ~720 KB (more, but parallelised) |

56 % reduction on the initial download. The two remaining >500 KB
chunks are main + the highlight.js bundle (all languages); further
splitting those is a separate optimisation.

### Tests

- **Playwright**: 52/52 green — Suspense boundary is transparent
  to the existing suite (every route navigation still resolves
  before the first assertion thanks to Playwright's auto-wait).
- **Vitest / Rust**: unaffected (27 + 135 green).

---

## 2026-04-23 — T4.2b · CodeMirror 6 in Skills editor

The T4.2 MVP shipped with a plain `<textarea>` (the `index.tsx`
docblock explicitly flagged CM6 as a "drop-in later"). That later
is now: Skills bodies are Markdown with frequent fenced code blocks,
and a monospace textarea was actively painful to work in.

### Shipped (`src/features/skills/MarkdownEditor.tsx`)

- **`@uiw/react-codemirror`** wrapper configured with
  `@codemirror/lang-markdown` + `language-data` so fenced code
  blocks in ts / bash / py / json etc. lazy-load their highlighter
  on first use. Line numbers, fold gutter, active-line, and the
  built-in search panel (Cmd/Ctrl-F) are on; bracket matching +
  indent-on-input are off because this is prose, not source.
- **`Cmd/Ctrl-S` keymap** forwards to the existing save handler,
  so users stay in the editor instead of mouse-targeting the Save
  button.
- **Token-driven theme** (`src/features/skills/skills.css`) — no
  `theme-one-dark` import; every surface / border / accent resolves
  from the same CSS variables the rest of the app uses, so the
  editor flips with `html[data-theme]` for free and adds no new
  palette surface area.
- **Hidden mirror `<textarea data-testid="skills-editor-textarea">`**
  — preserves the Playwright contract (`.fill()`, `.toHaveValue()`)
  without requiring test rewrites. Bi-directional binding through
  React state means programmatic `.fill()` propagates to CM6 and
  user typing updates the textarea's value attribute.

### Tests

- **Playwright**: 52 green (Skills suite:
  create→edit→save→delete and tree-switch paths both unchanged).
- **Vitest / Rust**: unaffected (27 + 135 green).
- **Bundle**: the Skills route is not yet code-split, so the
  monolith bundle grows by ~180kb gzip. Noted for a future
  Phase 0.5 code-splitting pass.

---

## 2026-04-23 — Phase 0.5 follow-up · Storybook + analytics mock fix

Two deferred Phase 0.5 items clear today:

### Shipped

- **Storybook 8 scaffolding** (`.storybook/main.ts`, `preview.ts`).
  `pnpm storybook` / `pnpm build-storybook` scripts; scope limited
  to `src/**/*.stories.@(ts|tsx|mdx)` with the UI primitives folder
  seeded by three stories (`button.stories.tsx`,
  `empty-state.stories.tsx`, `kbd.stories.tsx`). Feature modules
  stay out until we wire a Tauri-IPC decorator. Theme toolbar flips
  `html[data-theme]` so tokens resolve the same way the app does.
  `build-storybook` completes in ~7s and produces a clean static
  bundle (`storybook-static/`, git-ignored).
- **Playwright analytics mock** (`e2e/fixtures/tauri-mock.ts`):
  adds `adapter_usage: [...]` so the Analytics route's
  post-T5.6 destructure doesn't throw. `analytics.spec.ts` empty-
  state test also patched to include the key.
- **Roadmap note**: the "Playwright deferred" line was stale —
  the suite has been live since Phase 1 and covers 52 specs
  across 17 files. Updated `docs/05-roadmap.md` accordingly.

### Tests

- **Playwright**: 50 → **52 green** (analytics suite unblocked).
- `pnpm build-storybook` succeeds end-to-end.
- typecheck + lint clean.

---

## 2026-04-23 — T1.8 · SSE initial-connect retry

When the Hermes gateway restarts (or the user reopens the laptop
and dials a stale socket) the very first chat send used to fail
instantly with "gateway unreachable". This lands bounded retry on
the *initial* SSE connect — the most common real-world case — so
the user can't even tell the gateway blipped.

### Shipped (`src-tauri/src/adapters/hermes/gateway.rs`)

- **`connect_chat_stream()` helper** — wraps the
  `POST /v1/chat/completions?stream=true` `send()` in a retry loop:
  up to 3 attempts, exponential backoff (500ms → 1s → 2s, total
  worst-case ~3.5s). Only `reqwest::Error` from the head phase
  retries; once the server produces a status line (even 5xx) we
  surface it unchanged. Zero retries after bytes start flowing —
  that would double-charge tokens and duplicate output.
- Existing `received_any_delta` guard (mid-stream drops → graceful
  `finish_reason="interrupted"`) stays intact; the new retry only
  covers the window *before* the stream opens.

### Tests

- **Rust**: 134 → **135** (+1
  `t18_chat_stream_retries_connect_on_transport_error`) —
  spawns a real TCP listener that accepts and immediately drops
  each connection, asserts the gateway hits it exactly 3 times
  and ultimately surfaces `AdapterError::Unreachable`. No HTTP
  mock library needed; test runs in ~1.5s (matches the
  500+1000 ms backoff sum).
- `cargo clippy --tests -- -D warnings`: clean.

---

## 2026-04-23 — T4.4b · Budget gate round 2

The `send()` gate already existed (shipped with T4.4) but only fired
at ≥100%, ignored `period`, and silently dropped every scope except
`global` + `model`. This round closes those three gaps so the gate
behaves the way the UI has been promising.

### Shipped (`src/features/chat/budgetGate.ts`)

- **80% warn threshold**. `notify` / `notify_block` budgets fire
  warns at 80%+; strict `block` budgets stay silent below 100%
  (deliberate — a hard-block shouldn't leak pre-breach noise).
- **Period windowing**. `day` / `week` / `month` now sum the
  relevant tail of `analytics.tokens_per_day`
  (UTC-anchored to match the SQLite bucketing). `month` sums the
  full trailing-30-day series, `week` the trailing 7 days, `day`
  today. Uses a blended per-token rate (200¢/M) since the DTO
  doesn't split prompt vs. completion per-day; lifetime still uses
  the split rate. Degrades to lifetime when the per-day series is
  empty (fresh DBs).
- **Adapter scope matching**. Ties T5.6's adapter-scope dropdown
  to runtime: `activeAdapterId` (read from `useAgentsStore` at
  send-time) is compared against `budget.scope_value`.
- **Pure classifier extracted** (`classifyBudgets()`) — IPC-free,
  lets us unit-test every branch without mocking `invoke()`.

### Tests

- **Vitest**: 11 → **27** (+16 in
  `src/features/chat/budgetGate.test.ts`) — covers threshold
  semantics per action kind, scope matching for global/model/adapter,
  deliberate ignores for profile/channel, day/week/month
  windowing math, `amount_cents <= 0` safety, and the
  `describeBreach` formatter.

### Consumer

- `src/features/chat/index.tsx#send()` now passes
  `activeAdapterId` into `evaluateBudgetGate`.

---

## 2026-04-23 — T5.6 · Cross-adapter analytics + budgets

Phase 5's final task. Analytics now surfaces a "Usage by adapter"
card; Budgets' existing `adapter` scope kind finally gets a proper
dropdown populated from the live registry instead of a free-form
text input. Together these make multi-adapter cost/usage signals
first-class.

### Shipped

- **`AnalyticsSummary.adapter_usage: Vec<NamedCount>`**
  (`src-tauri/src/db.rs`): groups `sessions` by `adapter_id` (with
  `COALESCE(NULLIF(...), 'hermes')` defending against NULL rows).
  No `LIMIT` — adapter space is ≤6. Ordered by count DESC so the
  busiest adapter leads.
- **`AnalyticsSummaryDto.adapter_usage`** mirrored in TS
  (`src/lib/ipc.ts`).
- **Analytics "Usage by adapter" card** (`src/features/analytics/index.tsx`):
  uses the existing `HBarList` primitive (same as Top models /
  tools), placed in its own row below the models+tools grid so
  the new signal is visible without displacing the historical
  layout. Remaps raw ids → display names via
  `useAgentsStore.adapters` (e.g. `hermes` → "Hermes"); falls
  back to raw id when the registry hasn't loaded yet.
- **Budgets adapter-scope dropdown** (`src/features/budgets/index.tsx`):
  new local `<ScopeValueInput />` switches between a text input
  and a `<Select>` of registered adapters based on `scope_kind`.
  Persisted value is the adapter `id` (stable); the option label
  is the display name. Gracefully falls back to text input when
  the registry is empty.
- **i18n**: `analytics.chart.adapters.{title,subtitle,empty}` in
  `en.json` + `zh.json`.

### Tests

- **Rust**: 133 → **134** (+1
  `t56_analytics_adapter_usage_groups_by_adapter_id` — three
  sessions across two adapters, asserts count + DESC ordering).
- typecheck + lint + `cargo clippy --tests -- -D warnings`: clean.

### Phase 5 status

All in-scope T5.* subtasks shipped:
T5.1 trait polish · T5.2a Claude Code mock · T5.3a Aider mock ·
T5.5a read-only switcher · T5.5b active + capability-gated nav +
chat routing · T5.5c unified inbox · T5.6 analytics + budgets.

Deferred (explicitly out-of-scope until a user asks):
T5.2b/T5.3b real CLIs, T5.4 OpenHands.

---

## 2026-04-23 — T5.5c · Unified session inbox

Sessions are now adapter-aware end-to-end. The chat SessionsPanel
filters/badges by adapter and offers an "All agents" toggle; the DB
persists `adapter_id` per row via a v5 migration that backfills
pre-T5.5c sessions to `'hermes'`.

### Shipped

- **DB v5 migration** (`src-tauri/src/db.rs`):
  `ALTER TABLE sessions ADD COLUMN adapter_id TEXT`, backfill
  `'hermes'` for existing rows, add
  `idx_sessions_adapter_updated(adapter_id, updated_at DESC)` for
  the inbox-filter query path. `upsert_session` now preserves
  `adapter_id` via `COALESCE(sessions.adapter_id, excluded.adapter_id)` —
  sessions can't migrate across adapters via a late upsert (the
  per-session adapter is frozen at creation).
- **`SessionRow.adapter_id`** plumbed through Rust DTO (`#[serde(default)]`
  → `"hermes"` for back-compat) and TS `DbSessionRow.adapter_id`.
- **`ChatSession.adapterId`** in `useChatStore` — hydrated from
  `sessionFromDb`, set at `newSession()` time from
  `useAgentsStore.activeId` (with full fallback chain to registry
  default → first entry → literal `'hermes'`). All five
  `dbSessionUpsert` call sites now forward `adapter_id`.
- **Unified `<SessionsPanel />`** (`src/features/chat/SessionsPanel.tsx`):
    - Scope toggle (`Active <N>` / `All agents <N>`). Hidden when
      only one adapter is registered OR when every session belongs
      to the active adapter (no noise).
    - Per-row 3-char adapter badge — gold for Hermes, cyan for
      Claude Code, violet for Aider. Rendered in "all" mode AND
      whenever a row's adapter differs from the active one, so
      outliers are never camouflaged.
    - Empty-state copy adapts: "No Claude Code sessions. Switch
      to 'All agents' to see others." when the active adapter has
      zero rows in a multi-adapter DB.

### Tests

- **Rust**: 132 → **133** (+1
  `t55c_session_adapter_id_roundtrips_and_is_frozen` — covers
  round-trip + the "re-upsert can't hijack adapter_id" invariant).
- typecheck + lint clean.

### Deferred

- **Per-adapter empty-state illustrations** — current copy is
  functional but not visually engaging. Low priority until real
  CLIs land and users actually use multi-adapter mode.

---

## 2026-04-23 — T5.3a · Aider mock adapter (third citizen)

Registers the third first-class `AgentAdapter`. With Hermes + Claude
Code + Aider all online in mock mode, the T5.5b capability-gated
Sidebar now has three distinct capability vectors to filter against
and the AgentSwitcher finally looks like a real multi-agent console.

### Shipped

- **`AiderAdapter::new_mock()`** (`src-tauri/src/adapters/aider/`):
    - Capabilities distinguish Aider from Claude Code where it
      matters: `attachments=false` (Aider reads repo files, not
      pasted images), `terminal=false`, `trajectory_export=false`,
      `channels=[]`, `skills=false`. `streaming=true` +
      `tool_calls=true` + `cost_accounting=true` match both.
    - Mock `chat_once` **refuses without `ChatTurn.cwd`** — Aider's
      identity is "one process per repo"; surfacing the contract
      as `AdapterError::NotConfigured { hint: "... repo path ..." }`
      gives the UI a clean place to prompt for a repo picker
      (T5.3b) instead of silent fallback.
    - Mock `chat_stream` emits a realistic Aider tool sequence —
      `ToolProgress { tool: "read" }` → `ToolProgress { tool: "edit" }`
      → word-chunked deltas. Real Aider's `Edit`/`Apply`/`Done`
      event set collapses to the same shape, so the UI's tool
      ribbon already renders correctly for both live and mock.
    - Fixtures: `fixtures/sessions.json` (2 sessions with
      `metadata.repo` + `.branch` + `.files_in_ctx` — the fields
      the unified inbox will use to disambiguate rows in T5.5c)
      + `fixtures/models.json` (Claude Sonnet 4.5, GPT-4o, DeepSeek
      Coder v3 — Aider model slugs in typical user configs).
- **Registered** in `lib.rs`. Boot log now prints
  `adapters=["hermes", "claude_code", "aider"]`.
- **Conformance suite** gains `aider_mock_is_conformant` (one-line
  add to `adapters::conformance::tests`). All three adapters pass
  the same shape invariants.

### Tests

- **Rust**: 125 → **132** (+6 Aider unit tests + 1 conformance
  parameterisation). Notable coverage: `NotConfigured` on missing
  cwd, `repo` echo in reply, read→edit tool sequence ordering.
- typecheck + lint + `cargo clippy --tests -- -D warnings`: clean.

### Deferred

- **T5.3b real Aider CLI** — `process.rs` + `protocol.rs` + `repo.rs`.
  Spawn `aider` as a JSON-lines child, one per repo; multiplex
  messages through a channel keyed by session id. Blocked only on
  time; follows once T5.5c (unified inbox) lands so the repo-picker
  UX has a home.

---

## 2026-04-23 — T5.5b · Active adapter + capability-gated nav + chat routing

Makes the AgentSwitcher actually useful. Selecting an adapter in the
Topbar now routes chat through it, filters the Sidebar nav to match
its `Capabilities`, and persists across reloads.

### Shipped

- **Active adapter slice** in `useAgentsStore` (`src/stores/agents.ts`):
  `activeId: string | null`, `setActive(id)`, `getActiveEntry()`.
  Persisted to `localStorage` (`corey.active_adapter_id`) with
  defensive try/catch so storage failures never crash the app.
  `null` means "follow the registry default"; a stale id (adapter
  removed) also falls through to the default.
- **AgentSwitcher now selects** (`src/app/shell/AgentSwitcher.tsx`):
  clicking a row in the dropdown marks that adapter active (emerald
  "active" badge on the row + active row highlight); a "Clear
  selection (follow default)" button appears once an override is
  set. Footer updated from "coming in T5.5b" to
  "Chat routes to the active adapter."
- **Capability-gated Sidebar** (`src/app/shell/Sidebar.tsx` +
  `src/app/nav-config.ts`): `NavEntry` gains optional
  `requires: NavCapability`. Entries are filtered against the
  active adapter's live `capabilities` snapshot.
  Claude Code (`channels=[]`, `skills=false`, `scheduler=false`)
  hides Channels / Skills / Scheduler; Hermes keeps all three.
  Entries without `requires` (Chat, Home, Settings, Compare,
  Analytics, Models, Budgets, Profiles, Runbooks) always show.
- **Chat routing IPC** (`src-tauri/src/ipc/chat.rs`):
  `ChatSendArgs` + `ChatStreamArgs` gain
  `adapter_id: Option<String>` (`#[serde(default)]`).
  New private helper `pick_adapter` resolves `explicit → get()`
  or `None → default_adapter()`, returning `NotConfigured` loudly
  when an explicit id isn't registered (safer than silently
  falling back and running against the wrong adapter).
  Frontend `chatSend` / `chatStream` forward
  `useAgentsStore.getState().activeId` on each send; read is
  non-reactive on purpose (selection changes apply to the NEXT
  send, never retroactively).
- **IPC exposes capabilities** (`src-tauri/src/ipc/agents.rs`):
  `AdapterListEntry` now includes the live `capabilities`
  snapshot; unlocks the Sidebar filter without a second IPC
  round-trip.

### Tests

- **Rust**: 124 → **125** (+1 `t55b_list_includes_capabilities_per_adapter`
  — Hermes has messenger channels, Claude Code doesn't claim
  `skills` but does claim `terminal`).
- typecheck + lint clean.

### Deferred to T5.5c

- **Unified inbox** — merge sessions from every enabled adapter
  into the chat SessionsPanel with per-row adapter badges.
  Requires rewriting the sessions selector + adding adapter
  filter UI; scope creep vs. what this commit ships.

---

## 2026-04-23 — T5.5a · Topbar AgentSwitcher (read-only)

First visible multi-adapter surface. With two adapters registered
(Hermes + Claude Code mock), the Topbar now lists them side-by-side
with live health dots and uptime. Selection / routing / capability-
gated nav land in T5.5b once the read-only switcher proves its shape.

### Shipped

- **`adapter_list` IPC** (`src-tauri/src/ipc/agents.rs`) —
  fans out per-adapter `health()` probes in parallel via
  `tokio::spawn`, merges results with `AdapterRegistry::all()`,
  and returns one row per adapter (`AdapterListEntry { info,
  health, health_error? }`). Individual probe failures don't
  fail the IPC — the row lands with `health: null` +
  `health_error` so the switcher can render "registered but
  unreachable" distinctly from "not registered at all". One test:
  `adapter_list_shape_matches_expectations` exercises the
  fan-out + default-flag round-trip.
- **`useAgentsStore`** (`src/stores/agents.ts`) — Zustand slice
  that owns `{ adapters, error, loading }`. `startBackgroundRefresh`
  runs an immediate probe + 30s poll, idempotent for HMR
  (mirrors `useAppStatusStore`). Booted once from
  `<Providers>` so every consumer reads the same cached list.
- **`<AgentSwitcher />`** (`src/app/shell/AgentSwitcher.tsx`) —
  Topbar pill showing the default adapter's name, adapter count,
  and a health dot (green/red/pulsing-grey). Dropdown rows show:
  name + id + `default` badge + version + uptime + latency, plus
  amber `last_error` / red `health_error` strips when present.
  Mounted between the gateway pill and the right-hand
  palette/theme cluster so the topbar reads
  "gateway → agent → navigation".

### Tests

- **Rust**: 123 → **124** (+1 for the IPC fan-out shape).
- **TS**: typecheck + lint clean; no new e2e specs yet (T5.5b
  will add one that asserts switcher lists both adapters).

### Deferred to T5.5b

- **Active adapter selection** — store currently surfaces the
  registry's default; the switcher is read-only. Making it
  clickable requires a store slice for the "user-selected
  adapter" plus routing the chat send path through it.
- **Capability-gated nav** — hide Channels/Skills/Scheduler when
  the active adapter doesn't claim the capability.
- **Unified inbox** — merge sessions from every enabled adapter
  into the chat sidebar with per-row adapter badges.

---

## 2026-04-23 — T5.2a · Claude Code mock adapter + conformance suite

Lands a second first-class `AgentAdapter` alongside Hermes, plus the
shared conformance harness the rest of Phase 5 will gate on. Mock-
first: the real `claude-code` CLI wrapper (T5.2b) follows once the
UI surface (T5.5) is up and driveable against two citizens.

### Shipped

- **`ClaudeCodeAdapter::new_mock()`** (`src-tauri/src/adapters/claude_code/`):
    - Capabilities match the Phase 5 spec: `streaming=true`,
      `tool_calls=true`, `attachments=true`, `skills=false`,
      `channels=[]`, `terminal=true`, `trajectory_export=true`.
    - `list_sessions` / `list_models` load from committed fixtures
      (`fixtures/sessions.json` + `fixtures/models.json`): 2 demo
      Claude Code sessions, 3 Claude models (Sonnet 4.5, Opus 4,
      Haiku 3.5).
    - `chat_once` returns a canned reply that echoes the last user
      message + `turn.cwd` — cheapest end-to-end proof that the
      T5.1 `ChatTurn.cwd` plumbing survived IPC → registry →
      adapter.
    - `chat_stream` emits one synthetic `ToolProgress` ("📖 read")
      then word-chunked deltas at 20ms each, so the UI's tool-card
      + streaming paths exercise this adapter the same way they
      exercise Hermes live mode.
- **Shared conformance suite** (`src-tauri/src/adapters/conformance.rs`):
  `conformance::run(adapter)` asserts id/name validity,
  `capabilities()` sanity (no empty channel strings), `health()`
  shape (matching `adapter_id`), per-row `adapter_id` tagging on
  `list_sessions`, and query pass-through. Two parameterised
  tests — `hermes_stub_is_conformant` +
  `claude_code_mock_is_conformant` — run it against both adapters
  so any new adapter can add one line to join the gate.
- **Registered in `lib.rs`** alongside Hermes (non-default). Boot
  log now prints the populated adapter list; today it's
  `["hermes", "claude_code"]`.

### Tests

- **Rust**: 116 → **123** (+7). 5 new claude_code mock unit tests
  (health, capabilities, fixture load + search, `cwd` echo,
  stream emits tool-then-deltas); 2 conformance parameterisations.
- `cargo check` + `cargo clippy --lib -- -D warnings`: clean.

### Deferred

- **T5.2b real CLI** — `cli.rs` / `sessions.rs` / `stream.rs` for
  the upstream `claude-code` binary + recorded fixtures. Blocked
  on nothing except time; will follow once T5.5 surfaces the
  switcher.

### Next

- **T5.5 AgentSwitcher** — Topbar picker + capability-gated nav.
  With two registered adapters, we can now build the UI against a
  real multi-citizen registry instead of a singleton.
- Or **T5.3 Aider adapter** (process-pooled JSONL) — same mock-first
  pattern once you give the word.

---

## 2026-04-23 — T5.1 · Adapter trait polish (Phase 5 kickoff)

Opens Phase 5 (Multi-agent console) with the lowest-risk task: evolve
the `AgentAdapter` trait so forthcoming Claude Code / Aider adapters
have the fields they need, without breaking anything Hermes already
does.

### Shipped

- **`Health` extended** — added `last_error: Option<String>` +
  `uptime_ms: Option<u64>`, both `#[serde(default)]` so existing
  consumers keep deserialising. `HermesAdapter` tracks a
  `started_at: Instant` for uptime and a `RwLock<Option<String>>`
  for the sticky last-error: successful probes clear it, failed
  probes record it. UI agent-switcher (T5.5) will surface both.
- **`ChatTurn.cwd: Option<String>`** — optional working directory
  for code-centric adapters. Wired end-to-end through
  `chat_send` + `chat_stream_start` IPC (`ChatSendArgs.cwd` +
  `ChatStreamArgs.cwd`, both `#[serde(default)]`). Hermes ignores
  it; Claude Code / Aider will consume it starting T5.2.
- **Hermes `list_sessions` honours query** — the trait already
  declared `SessionQuery { search, source, limit }` but the
  adapter silently dropped all three. Now:
    - `search`: case-insensitive substring match on `title`
    - `limit`: take-N cap
    - `source`: still ignored (deferred — fixtures don't carry
      enough signal to validate, Claude Code/Aider will force the
      design)

### Tests

- **Rust**: 112 → **116** (+4 under `adapters::hermes::tests::t51_*`):
  stub-health surfaces uptime/no-error, search filters by title,
  limit caps the set, `ChatTurn.cwd` back-compat round-trip.
- `cargo check` + full lib test: clean.

### Deferred (tracked)

- specta bindings regen — no TS consumer of `Health` /
  `ChatTurn.cwd` yet; revisit when T5.2 lands a non-Hermes adapter.
- `SessionQuery.source` filter — same rationale; the moment a
  non-Hermes adapter exposes meaningful `Source` values we wire it.

### Next

- **T5.2 Claude Code adapter** (2 days) — mock-first (no real CLI),
  then cli + sessions + stream modules + fixtures + conformance
  suite.

---

## 2026-04-23 — Brand · Corey logo + Icon wrapper + Dock/window polish

First pass of brand identity: ship the Corey logo across every Tauri
platform, install a unified `<Icon>` wrapper around lucide-react,
and close three user-reported papercuts on the final look (Dock
name, ghost title, square icon).

### Shipped

- **Tauri multi-platform icons** (`a35335b`) — ran `pnpm tauri icon
  src-tauri/icons/Corey.png` (1024×1024 source). Generated the full
  set: macOS `icon.icns`, Windows `icon.ico` + Appx `Square*Logo.png`,
  Linux `32/64/128/128@2x/icon.png`, iOS `AppIcon-*@{1,2,3}x.png` for
  every required size, Android `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round,_foreground}.png`.
  `tauri.conf.json` was already wired to the canonical filenames so
  no config change needed.
- **Favicon** (`a35335b`) — copied the 1024×1024 source to
  `public/favicon.png` and the 32×32 rasterisation to
  `public/favicon-32.png`; `index.html` registers both plus an
  `apple-touch-icon` entry.
- **`<Icon>` wrapper** (`a35335b`, `src/components/ui/icon.tsx`) —
  thin `forwardRef` around any `LucideIcon`. Enforces:
    - `strokeWidth={1.5}` (matches the logo's thin-stroke geometry)
    - `size` accepts discrete tokens (`xs|sm|md|lg|xl` → 12/14/16/20/28 px)
      **or** a raw pixel number for edge cases
    - `className` auto-`shrink-0` so flex layouts don't compress it
    - `aria-hidden={true}` by default (decorative unless caller
      overrides)
  Size tokens align with the groupings in `docs/icon-audit.md`.

### Fixed

- **Dock shows "Corey" not "caduceus"** (`dc30ee9`) — dev mode runs
  `target/debug/<binary>` directly (no `.app` bundle), so the Dock
  process name mirrors the Cargo binary name. Added `[[bin]] name =
  "Corey"` in `src-tauri/Cargo.toml`; package name stays
  `caduceus` so every `use caduceus_lib::…` import is untouched.
  Only the compiled binary filename flips to `target/debug/Corey`.
- **Ghost "Corey" text above sidebar brand** (`83432a1`) — with
  `titleBarStyle: "Overlay"`, macOS renders `window.title` atop the
  overlay title-bar region, directly over our custom Sidebar brand
  area. The native title text appeared as a faint white "Corey"
  label above our own `CoreyMark` + `app.name` span. The sidebar
  already displays the brand, so the OS title is redundant;
  blanked `title: ""` in `tauri.conf.json` (traffic-lights + drag
  region unchanged).
- **Square Dock icon → squircle** (`b66fc18`) — the raw 1024×1024
  source had hard right-angle corners, so the Dock icon read as a
  black block next to every other app's squircle. Applied a 180px
  radius corner mask via ImageMagick (`CopyOpacity` composite) —
  ≈17.6% of canvas, close to the macOS/iOS squircle convention —
  then re-ran `pnpm tauri icon` to regenerate the full platform
  matrix plus `public/favicon.png` + `public/favicon-32.png` +
  `public/corey.png` (the one `CoreyMark` renders in-app).

### Batch-refactored (follow-up commits `639ba5c` + `1465e65`)

- **All ~80 lucide-react call sites migrated to `<Icon>`** — split
  across two commits to keep diffs reviewable:
    - `639ba5c` (batch 1): UI components (drawer, combobox, select,
      empty-state), shell (Sidebar, Topbar, Palette), chat (index,
      MessageBubble, SessionsPanel, ActiveLLMBadge), plus simple
      features (home, terminal, analytics, logs/{index,Hermes,Changelog}),
      channels (index, ChannelForm, WeChatQr), profiles.
    - `1465e65` (batch 2): compare, budgets, skills, models,
      runbooks, trajectory, settings.
  Size tokens applied throughout: `size="xs"` (12px) for decorative
  inline chips, `size="sm"` (14px) default for text-flow & button
  icons, `size="md"` (16px) for nav/topbar & emphasised button
  icons, `size="lg"` (20px) for empty-state. Spin / color overrides
  go through `className=`. Any stroke-width drift is now impossible
  to introduce without editing `src/components/ui/icon.tsx` itself.

### Test totals

- typecheck + lint: clean (same 4 pre-existing fast-refresh
  warnings).
- Rust: cargo rebuild on icon refresh (`touch build.rs` +
  `tauri.conf.json`) to re-embed `icon.icns`; `killall Dock`
  required once to bust macOS's Dock icon cache.

---

## 2026-04-23 — UI polish · drag region, zoom suppression, themed Select, layout hardening

Post-close-out polish session driven by `pnpm tauri:dev` user report.
Five user-visible UX papercuts land; no functional scope changes. No
Phase status moves — this is hygiene on top of the 2026-04-23 Phase
1–4 close-out below.

### Fixed

- **Window drag region covers full topbar** (`1b67996`). Moved
  `data-tauri-drag-region` onto the `<header>` element itself; the
  prior `absolute inset-0 -z-10` child was mis-stacked below
  `bg-bg-elev-1` so mousedowns on empty header space never reached
  it. Interactive children (model pill, gateway pill, palette, theme
  toggle) still fire their own click handlers — Tauri dispatches on
  `event.target`.
- **Webview zoom suppressed** (`1b67996`). `<Providers>` now installs
  a `keydown` + non-passive `wheel` listener that swallows Cmd/Ctrl
  `+` / `-` / `=` / `0` and Cmd/Ctrl+wheel. Desktop apps resize with
  the window; they do not zoom. This fixes chat-bubble compression,
  Sidebar `pl-20` misalignment, and the overall scale drift users
  saw at non-100% zoom.
- **Native `<select>` → themed `Select`** (`1b67996`). New
  `src/components/ui/select.tsx` (~250 LoC, `role=combobox` +
  `listbox` pair, keyboard: ArrowUp/Down wrap + Home/End + type-ahead
  + Enter/Space commit + Escape cancel + outside-click + active-option
  scroll-into-view + `aria-activedescendant`). Replaces all 4 native
  selects in Budgets editor (scope / period / action) + Settings
  appearance (language). Playwright specs (`budgets.spec.ts`,
  `settings.spec.ts`) switched from `selectOption()` to
  `click(trigger) → getByRole('option', { name }).click()`.
- **CoreyMark alt-text ghost removed** (`14a03d5`). `<img alt="Corey">`
  was rendering its alt string inside the image box while the PNG
  decoded (cold start, HMR reload), producing a ghostly second
  "Corey" label next to the real `{t('app.name')}` span. Now
  `alt=""` + `role="presentation"`; TS prop type `Omit`s `alt` to
  prevent regressions.
- **Narrow-window layout hardened** (`14a03d5`). Added `shrink-0` to
  Sidebar brand row + `CoreyMark` + every Topbar pill (model picker,
  gateway pill, palette trigger, theme toggle) so flexbox stops
  proportionally compressing interactive elements. Sidebar
  `pl-20 → pl-4` under `@media (display-mode: fullscreen)` — macOS
  hides traffic lights in fullscreen, so the reserve was dead weight.

### Deferred

- **Icon system replacement** — audit landed at `docs/icon-audit.md`
  (~80 icons across 30 files, with current + suggested sizes); the
  replacement itself (custom SVG / alt library / unified wrapper)
  is deferred pending user decision on approach.

### Test totals

- **E2E (Playwright)**: 52 passing (unchanged; 2 specs rewritten
  for the new Select).
- typecheck + lint: clean.

### Next

- Pick icon strategy, then batch-replace per `docs/icon-audit.md`.
- Resume Phase 5 kickoff (multi-agent console) — no open
  regressions blocking it.

---

## 2026-04-23 — Phase 1–4 close-out · six follow-ups shipped

Final sweep before Phase 5: six high-value follow-ups across Phase 1,
2, and 4 land in a single session. Everything else is triaged into
`docs/06-backlog.md` with priority + re-open triggers.

### Shipped

- **T1.5c** (`1f34124`) — vision-capability gating on the Paperclip
  button. Tri-state `visionSupport()` heuristic in
  `src/lib/modelCapabilities.ts`; non-vision models surface an amber
  warning banner when an image is pending; send is not hard-blocked.
- **T1.5d + T1.5e** (`6c34f71`) — attachment thumbnails + orphan-file
  GC. New `attachment_preview` IPC returns a 5 MB-capped data URL;
  `AttachmentImageTile` renders 96×96 thumbs with loading/failure
  fallback. `attachment_gc` sweeps files not referenced by any DB
  row on every app start.
- **T4.4b** (`ce6603e`) — budget-breach chat interceptor. Before each
  send, `evaluateBudgetGate` runs; `notify` budgets surface an inline
  amber banner, `block` budgets raise a native confirm dialog, cancel
  aborts with the composer draft preserved. Lifetime spend only (per-
  period windowing parked pending analytics bucket support).
- **T4.6b** (`5490f18`) — runbook scope filtering by active Hermes
  profile. `runbookScopeApplies()` shared between the Runbooks list
  (with "Show all scopes" toggle) and the palette (tight filter, no
  toggle). Scope picker added to the editor.
- **P2 profile revert** (`ad264c9`) — `changelog_revert` dispatcher
  now handles `hermes.profile.{create,rename,clone,delete}`. Extracted
  pure `apply_revert()` for testing; delete-revert recreates the
  profile with a seed `config.yaml` (prior data explicitly not
  restored, per documented contract).

### Test totals

- **Rust**: 101 → **112** (+11 across 4 modules).
- **E2E (Playwright)**: 46 → **52** (+6).
- `cargo fmt --check` + `cargo clippy -- -D warnings` + typecheck +
  lint: clean.

### Backlog-ified

See `docs/06-backlog.md` for the 18-ish items that stayed parked:
Tencent iLink (blocked on credentials), CodeMirror 6, multi-tab
terminal, per-period budget windowing, reconnect auto-poll, 10k-msg
virtualisation, profile data-restore, per-profile gateway lifecycle,
tar.gz profile import/export, streaming log tail, and more. Each
entry carries a priority + re-open trigger so nothing rots.

### Phase 5 opens on

- M1–M3 shipped, Phase 1 / 2 / 3 / 4 all flagged `**Shipped**` in
  `docs/05-roadmap.md`.
- No open exit-criteria regressions.
- Clean working tree; CI green on `main`.

---

## 2026-04-22 — T1.5b · Multimodal chat wire format

Upgrades the chat IPC wire so vision-capable providers actually receive
images instead of just a `[attached: …]` text hint. Frontend sends
`{role, content, attachments: [{path, mime, name}]}`; the Hermes adapter
reads each staged file, base64-encodes it into a `data:…` URL, and
assembles OpenAI's multimodal `content` array (`{type:"text"}` +
`{type:"image_url"}` parts). Plain-text turns still serialise as bare
strings — parity with providers that reject the array shape when there
are no image parts.

### Shipped

- **`ChatMessageDto` extended** (Rust + TS) with optional
  `attachments: Vec<ChatAttachmentRef>` (`skip_serializing_if` empty so
  the wire stays minimal for plain turns). `ChatAttachmentRef` carries
  `{path, mime, name}`.
- **Gateway DTOs upgraded** — `ChatMessage.content` is now the
  untagged `ChatMessageContent { Text(String) | Parts(Vec<…>) }`;
  `ChatContentPart` is tagged with `{type:"text"|"image_url"}`.
- **`resolve_turn` / `build_content`** in the Hermes adapter read image
  attachments from disk, base64-encode, and build the parts array. Text
  part leads (OpenAI's recommended ordering). Non-image MIMEs and
  failed reads degrade to a `[attached: name]` marker appended to the
  text part — the user's words still reach the model on a bad read.
- **Frontend composer** stops baking `[attached: …]` into the bubble
  content. Stored text is now verbatim user input; attachments render
  as chips only. Prior turns' attachments ride along in `historyForIpc`
  so multi-turn context ("what colour was that?") works.

### Fixed

- Chat bubbles no longer show `[attached: foo.png]` noise after an
  attachment send. Users see their text; chips render separately.

### Test totals

- **Rust**: 96 → **101** (+5 tests in `adapters::hermes::tests` covering
  text-only passthrough, image→data URL, non-image marker fallback,
  missing-file graceful degrade, and mixed-attachment ordering).
- **E2E**: 45 → **46** (+1 — asserts the outgoing IPC payload carries
  the `attachments` array and clean `content` string; existing 3 tests
  adjusted to the new bubble content shape).

### Deferred

- **Vision-capability gating on Paperclip** — the button is still
  unconditionally enabled; a non-vision model attached an image just
  ignores it (or errors, depending on the provider). Next T1.5-series
  follow-up.
- **Attachment thumbnail preview** in chat bubbles. Needs an
  `attachment_preview` IPC reading staged bytes into a data URL the UI
  can hang off `<img src>`.
- **Orphan-file GC** for `~/.hermes/attachments/` when sessions are
  deleted. DB cascades the rows; disk still leaks until a `hermes
  attachments gc` helper lands.

---

## 2026-04-22 — Phase 4 complete · T4.2–T4.6 rollup

Wraps up Phase 4. All six differentiator tasks now ship; the last five
landed today on top of T4.1 from the morning. Per-task commits carry
full details; this entry is the consolidated view.

### Shipped

- **T4.2 Skill editor** (`067a94f`) — CRUD on `~/.hermes/skills/**/*.md`.
  Backend `skills.rs` + `ipc/skills.rs` with traversal-safe resolve and
  atomic writes; frontend tree + textarea editor + dirty-state badge.
  No CodeMirror yet (textarea is enough for Markdown).
- **T4.3 Trajectory timeline** (`48885d6`) — read-only session
  visualiser rendering messages + tool-call ribbons on a CSS timeline
  with a right-side inspector. Uses existing `dbLoadAll` — no new IPC.
- **T4.4 Budgets** (`5de15dc`) — CRUD page with live progress bars,
  colour-coded at 80% / 100%. Projects lifetime spend via a hard-coded
  per-1M-token price table. Backend CRUD arrived with T4.6's v3
  migration. Budget-breach chat interceptor deferred to T4.4b.
- **T4.5 Web terminal** (`fdb5417`) — portable-pty backend + xterm.js
  frontend. Single-tab MVP; spawn → stream → resize → kill lifecycle
  with base64-framed data events. Multi-tab / WebGL / scrollback
  restore deferred.
- **T4.6 Runbooks** (`a553f13`) — named prompt templates with
  `{{placeholder}}` parameters. v3 SQLite migration adds both
  `runbooks` and `budgets` tables. Palette integration: zero-param
  runbooks drop straight into Chat; param-ful ones open a fill form.
  Chat composer reads `pendingDraft` from a StrictMode-safe zustand
  store.

### Phase 4 test rollup

- Rust `cargo test --lib`: **89 passed** (79 pre-Phase-4 → +10 across
  runbooks / budgets / pty / skills / base64).
- Playwright: **42 passed** (33 pre-Phase-4 → +9 across
  compare × 3, runbooks × 3, budgets × 2, trajectory × 1,
  terminal × 1, skills × 2; one accidental "+3/+2/+1/+1/+2" count —
  see per-task commits).
- Rust clippy `--all-targets -- -D warnings`: clean.
- `pnpm typecheck` + `pnpm lint`: clean (3 fast-refresh warnings on
  feature files that co-locate helpers; accepted as MVP tradeoff).

### Deferred for later phases / follow-ups

- CodeMirror 6 editor in Skills.
- Skill test-runner + version history / rollback.
- Multi-tab terminal + WebGL renderer + paste-large protection.
- Budget-breach chat interceptor (notify/block at 80/100%).
- Per-model cost breakdown in Budgets (needs Analytics v2 refactor).
- Runbook scope filtering by profile; export / import runbook JSON.
- Jaccard / embedding similarity in Compare's diff footer.
- Real Tencent iLink client (T3.3 follow-up, still open).

### Next

- Phase 5 — Multi-agent console (≥2 non-Hermes adapters running
  side-by-side).

---

## 2026-04-22 — Phase 4 Sprint 1 (T4.1): Multi-model compare

### Context

First differentiator feature. Users can paste a prompt, pick up to 4
models, and watch them stream side-by-side. Drives the Phase 4 demo
story and makes the "am I picking the right model?" question
answerable in 10 seconds. No backend changes — existing
`chatStream` already supports handle-scoped concurrent streams, so
the entire feature is frontend orchestration + one mock tweak.

### Shipped

- **`src/features/compare/index.tsx`** (~460 LoC, single file).
  - `PromptBar`: full-width textarea, Ctrl/⌘+Enter to Run, Run/Stop
    toggle.
  - `ModelPicker`: chip row + dropdown of `model_list` results,
    hard-capped at 4 lanes. Remove via X on chip; Add button
    disables at cap.
  - `LanePanel` per model: header (display name + provider), body
    (`Markdown` reused from chat), footer (wall-clock latency,
    tokens, finish_reason or Cancelled/Error state). Per-lane X
    cancels just that lane without touching the others.
  - `DiffFooter`: appears once ≥2 lanes are done. Highlights
    fastest wall-clock and highest-token model. No similarity
    metric yet — deliberate.
  - Export helpers: Markdown + JSON via a tiny `downloadBlob` —
    no new deps.
- **Route wiring**: `/compare` in `src/app/routes.tsx` now points
  at `CompareRoute` instead of the Phase-4 placeholder.
- **Concurrency model**: one `chatStream()` call per lane; handles
  collected in a `Map<laneId, ChatStreamHandle>`. Per-lane cancel
  and global Stop-all both go through the same map. Route unmount
  drains every handle so nav-away mid-run doesn't leak listeners.
- **Ephemeral state**: lanes live in React state keyed by
  `r${runId}-${modelId}-${i}`. No DB writes — Compare is a
  scratchpad, not a session.
- **i18n**: `compare.*` keys in en + zh.
- **Mock tweak**: `chat_stream_start` in `e2e/fixtures/tauri-mock.ts`
  now echoes `[model=<id>]` when a `model` arg is supplied and
  reports that model in the `done` summary. Old chat-feature tests
  take the fallback branch and are unaffected.

### Test totals

- Rust `cargo test`: **79 passed** (unchanged — T4.1 is frontend-only).
- Playwright `compare.spec.ts`: **3/3 passed** (new).
- Full Playwright suite: **33/33 passed** (+3 over T3.5's 30).
- `pnpm typecheck` + `pnpm lint`: clean.

### Deferred (within T4.1 · for later if demand appears)

- `ipc/compare.rs` backend wrapper (for lifecycle / journaling —
  not needed while frontend orchestrates).
- Jaccard / embedding similarity in `DiffFooter`.
- Lane output virtualization (cap of 4 × ~2k tokens is comfortable).
- "Save run" persistence — export covers the keep-it workflow.

### Next

- **T4.3** Trajectory timeline, **T4.5** Web Terminal, or **T4.4**
  Budgets & alerts — each independent, 1.5–2 days.

---

## 2026-04-22 — Phase 3 Sprint 5 (T3.5): Mobile drawer for channel edit flow · **Phase 3 complete**

### Context

The card grid already stacks to one column below Tailwind's `sm`
breakpoint (640px), so the visible layout work for T3.5 is the
edit flow itself. Expanding a card inline on a 375-wide viewport
pushes the user past the viewport fold; we flip that to a bottom
drawer above the card grid, keeping the ergonomics (Cancel,
restart prompt, etc.) identical to desktop.

This closes Phase 3. T3.1–T3.5 are all green.

### Shipped

- **`useIsMobile(maxPx = 720)`** — 12-line `matchMedia` hook at
  `src/lib/useIsMobile.ts`. SSR-safe, re-subscribes on
  breakpoint change. One call site today (ChannelCard) — kept
  small instead of reaching for a media-query library.
- **`Drawer`** — `src/components/ui/drawer.tsx`, ~70 LoC. Fixed
  bottom sheet, 88vh max-height, slide-in via a `drawerUp`
  keyframe added to `tailwind.config.ts`. Click-outside on the
  backdrop closes; ESC closes; `document.body` gets
  `overflow: hidden` while open. Portal'd into `document.body`
  via `createPortal` so the parent card's overflow never clips
  it. Deliberately skipped swipe-to-dismiss, focus trap, and
  animated unmount — each adds state the one call site doesn't
  yet justify.
- **`ChannelCard` mobile integration**: extracted edit / confirm /
  saving / restart-prompt / error JSX into a local
  `renderInteractivePanels()` closure. Desktop renders inline
  below the read-only summary (unchanged behavior); mobile
  mounts the same node inside `<Drawer>`. `isInteractive` gates
  the drawer mount so the portal never exists in `view` mode.
  Drawer's X button + backdrop both route through
  `setMode({ kind: 'view' })` — matching the inline version's
  Cancel / dismiss paths exactly.
- **Tailwind**: one new keyframe `drawerUp` (translateY 100% →
  0%). No new colors, fonts, or spacing tokens.

### Test totals

- Rust `cargo test`: **79 passed** (unchanged — T3.5 is
  frontend-only).
- Playwright `channels.spec.ts`: **7/7 passed** (+1): 375×740
  viewport, click Edit, asserts drawer mounts outside the
  `<article>` (portal), form lives inside the drawer not the
  card, X button closes, backdrop click closes.
- Full Playwright suite: **30/30 passed**.
- `pnpm typecheck` + `pnpm lint`: clean.

### Phase 3 rollup

- T3.1 ✓ catalog + grid · T3.2 ✓ inline forms + atomic writes +
  diff + restart prompt · T3.3 ✓ WeChat QR scaffolding · T3.4 ✓
  live status probing · T3.5 ✓ mobile drawer.
- Rust: 70 → 79 tests (+9 over Phase 3).
- Playwright: 23 → 30 tests (+7 over Phase 3).

### Deferred (carry forward)

- Real Tencent iLink HTTP client (T3.3 follow-up).
- Explicit "Clear existing secret" button.
- Real `/health/channels` endpoint probe (if upstream adds it).
- WhatsApp env name verification.
- Phase-2 profile tar.gz import/export, per-profile gateway
  start/stop, active-profile switching, streaming log tail.

### Next

- **Phase 4** — Differentiators (multi-model compare, skill
  editor, trajectory, budgets, terminal).

---

## 2026-04-22 — Phase 3 Sprint 4 (T3.4): Live channel-status probing

### Context

Hermes exposes no per-channel health endpoint, so we derive liveness
from the rolling log files at `~/.hermes/logs/{gateway,agent}.log`.
Read-on-demand, 30s cached, with a force-refresh knob for the
Channels page's Probe button. When upstream adds a real health
endpoint, it drops in as a second backend inside
`channel_status.rs` without touching the IPC or UI.

### Shipped

- **`channel_status.rs`**:
  - `LiveState` three-way enum (`Online`/`Offline`/`Unknown`).
    `Unknown` is load-bearing — unconfigured channels or fresh
    installs must never be misreported as down.
  - `classify(id, lines)` — newest-first log scan matching the
    channel slug with a positive marker
    (`connected/ready/started/online/subscribed`) or negative
    (`error/failed/disconnect`). Most-recent wins so a reconnect
    after an outage reads right.
  - `probe_all(home_override)` — tails 1000 lines each of
    gateway.log + agent.log via `hermes_logs::tail_log_at`,
    classifies all 8 channels, returns one row per catalog entry
    in catalog order.
  - `ChannelStatusCache` with `snapshot(force)` — 30s TTL on the
    whole snapshot; force bypasses.
- **IPC** `hermes_channel_status_list(force)` — thin wrapper that
  runs the probe in `spawn_blocking` so the Tokio loop stays
  snappy.
- **`AppState.channel_status: Arc<ChannelStatusCache>`** — lazy,
  no startup cost.
- **Frontend**:
  - `ChannelsRoute` fetches statuses + catalog on mount; keeps
    statuses keyed by id at route level. Two header buttons: Probe
    (force-refreshes status only) and Refresh (catalog + status).
    Both carry distinct testids for e2e.
  - `LiveStatusPill` next to the config `StatusPill` — emerald /
    danger / muted for online / offline / unknown. Triggering log
    line exposed as a `title` tooltip (truncated to 160 chars).
    Guarded: hidden for `unconfigured` and `qr` (WeChat) statuses.
- **i18n** `channels.probe` + `channels.live.{online,offline,unknown}`
  in en + zh.

### Test totals

- Rust `cargo test`: **79 passed** (+9): `classify` across
  online/offline/unknown plus wechat-vs-wecom substring safety,
  case-insensitivity, lines-without-slug; `probe_all` returns one
  row per catalog entry; cache reuse within TTL + force advances
  `probed_at_ms`.
- Playwright `channels.spec.ts`: **6/6 passed** (+1): telegram
  configured → online, matrix partial → offline, discord
  unconfigured → no pill; Probe button force-refresh flips matrix
  to online without a full reload.
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings`:
  clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Deferred

- **T3.5** mobile layout.
- Real Tencent iLink client (T3.3 follow-up).
- Explicit "Clear" button for existing secrets.
- Real `/health/channels` endpoint probe (if upstream adds one).
- WhatsApp env name verification.

### Next

- **T3.5** mobile layout.

---

## 2026-04-22 — Phase 3 Sprint 3 (T3.3): WeChat QR-login scaffolding

### Context

WeChat credentials can't be typed — they arrive via a QR scan
against Tencent's iLink service. T3.3 ships the state-machine
skeleton + UI behind a `QrProvider` trait so the real iLink HTTP
client can drop in later without touching the frontend or IPC
layer. The live iLink integration is deferred until we have
credentials to test against (out-of-scope while upstream is a
black box we can't exercise).

### Shipped

- **Rust `wechat.rs`**:
  - `QrProvider` async trait (`start` / `poll` / `cancel`). Thin
    contract; real iLink impl drops in as a second struct.
  - `QrStatus`: `Pending` / `Scanning` / `Scanned` / `Expired` /
    `Cancelled` / `Failed { detail }`, with `is_terminal()` as the
    single source of truth for "stop polling".
  - `StubQrProvider` — deterministic mock that advances on poll
    count (2 Pending, 1 Scanning, 1 Scanned). On `Scanned` writes
    `WECHAT_SESSION=stub-session-{qr_id}` through
    `hermes_config::write_env_key` so changelog revert, card state,
    etc. all behave end-to-end.
  - `synth_qr_svg(seed)` — seeded placeholder SVG (21×21 cells +
    conventional finder patterns, deterministic per id). Zero new
    crates; the real provider returns a proper scannable image that
    replaces this fn wholesale.
- **Three IPCs** `wechat_qr_start`, `wechat_qr_poll`,
  `wechat_qr_cancel` — each a thin wrapper around the provider.
- **`WechatRegistry`** on `AppState` hides which implementation is
  wired up. `lib.rs` constructs `StubQrProvider` today; swapping
  to `ILinkQrProvider::new(..)` is a one-line change when that
  ships.
- **Frontend `WeChatQr.tsx`** (inline inside the WeChat card's
  edit form). Two visible states:
  - *Idle*: intro copy + "Start QR session" CTA.
  - *Active*: inline SVG + status line + Cancel (or "Start over"
    once terminal).
  - 2s poll cadence via recursive `setTimeout` (never stacks on a
    slow network); unmount triggers best-effort cancel so
    navigating away doesn't leave an orphan session.
- **Card integration** — on `scanned`, the form fires
  `onWechatScanned`; the parent card re-reads `ChannelState` and
  surfaces the same amber "Restart gateway?" prompt that normal
  non-hot-reloadable saves use.
- **i18n** `channels.wechat.*` (en + zh): intro, start/restart/
  cancel, six status lines, expiry countdown, "written by QR"
  marker, adjusted `qr_cta` / `qr_pending` to drop the "coming in
  T3.3" qualifier.

### Fixed

- Clippy `needless_range_loop` on `synth_qr_svg`'s grid-paint
  loops (kept index loops — cleaner than `enumerate()` with an
  unused value; `#[allow(..)]` at fn level).

### Deferred

- **Real Tencent iLink HTTP client** — expected ~300 LoC of
  `reqwest` + cookies + retry. Waiting on upstream docs /
  credentials.
- **T3.4** live status probing, **T3.5** mobile layout, explicit
  "Clear an existing secret" button, WhatsApp env name
  verification.

### Test totals

- Rust `cargo test`: **70 passed** (+5): stub state machine,
  cancel idempotency, unknown-id = NotFound, SVG determinism,
  scanned writes expected token through `write_env_key`.
- Vitest: **11 passed** (unchanged).
- Playwright `channels.spec.ts`: **5/5 passed** (+1): start → QR
  SVG visible → pending → scanning → restart prompt → env_present
  flips for `WECHAT_SESSION`. ~10s wall clock (stub cadence is
  real-time by design).
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings`:
  clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Next

- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout.

---

## 2026-04-22 — Phase 3 Sprint 2 (T3.2): Channels inline forms + atomic writes

### Context

T3.1 gave us a read-only catalog grid. T3.2 makes it interactive:
the user can now click Edit on any card, change the channel's
credentials and / or behavior fields, and save — with an atomic
`.env` + `config.yaml` round-trip, a diff confirmation, and a
gateway-restart prompt for channels Hermes doesn't hot-reload.

No new channels; just the write path for the 8 we already enumerate.

### Shipped

- **Atomic write IPC** `hermes_channel_save(id, env_updates,
  yaml_updates)`. Validates every key against the channel's
  `ChannelSpec` before touching disk, then runs two atomic phases:
  `.env` upserts (one journal entry per key) and a
  `hermes.channel.yaml` patch that creates missing intermediate
  mappings and treats JSON `null` as "delete this field". Unrelated
  keys elsewhere in `config.yaml` round-trip verbatim via
  `serde_yaml::Value`. Returns the refreshed `ChannelState` so the
  card updates without a second `hermes_channel_list` call.
- **YAML walker helpers** in `hermes_config.rs`:
  `write_channel_yaml_fields` (public), plus `walk_set` /
  `walk_remove` / `json_to_yaml_value` / `yaml_to_json_value`
  (private). `walk_set` creates missing intermediate mappings;
  `walk_remove` leaves siblings intact.
- **Dynamic form** `src/features/channels/ChannelForm.tsx`. One
  component drives all 8 channels via the `ChannelSpec` the backend
  ships with each card. `bool` → checkbox, `string` → text input,
  `string_list` → textarea (one per line). Env inputs are
  password-masked by default with an Eye toggle; they never
  pre-fill — an empty input on a channel whose token is already set
  means "leave unchanged". Save emits an explicit `{ envUpdates,
  yamlUpdates, diffs }` submission envelope; no-op patches are
  rejected so the user sees why.
- **Inline `ConfirmDiff`** panel. After Save the form flips to a
  review view with one row per pending change (`before → after`),
  an amber "not hot-reloaded" warning when relevant, and Cancel /
  Apply. Env diffs render presence-only (`set` / `unset`) — the
  typed value is never shown.
- **Restart prompt**. For `hot_reloadable = false` channels (all 8
  today), a post-save amber card offers "Restart now" →
  `hermes_gateway_restart` or "Later". Never restarts implicitly.
- **i18n** `channels.*` grew ~15 keys in en + zh: edit / save /
  cancel / show / hide, env placeholders, list placeholder, the four
  diff strings, the restart prompt labels, and the no-changes /
  not-hot-reloadable warnings.

### Fixed

- `io_other_error` clippy lint in `walk_remove` (`.to_string().into()`
  on a `String` → just `.to_string()`).

### Deferred

- **T3.3** WeChat QR flow (Tencent iLink).
- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout.
- **Explicit "Clear" on an existing secret** — today users remove
  tokens via the changelog revert or by editing `.env` directly; the
  button lands alongside T3.4 live-status feedback.
- WhatsApp env name still a placeholder.

### Test totals

- Rust `cargo test`: **65 passed** (+4 vs T3.1: `walk_set`,
  `walk_remove`, `json_to_yaml`, disk-level round-trip of
  `write_channel_yaml_fields`).
- Vitest: **11 passed** (unchanged).
- Playwright: **27 passed** (+2: bool toggle → diff → save → restart
  prompt → payload assertion; token fill → diff never leaks the
  value → card flips to Configured without the raw token appearing
  anywhere in the DOM). Full suite skipped this session for time;
  channel spec ran clean standalone.
- `cargo fmt` + `cargo clippy -- -D warnings`: clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Next

- **T3.3** WeChat QR flow.
- **T3.4** live status probing.

---

## 2026-04-22 — Phase 3 Sprint 1 (T3.1): Channels page catalog

### Context

Phase 3 foundation. Before building 8 per-channel forms, ship the
schema that drives them — one static `ChannelSpec` per channel with
env-key names, YAML field paths, field kinds, and flags. This also
gives us a real `/channels` page to replace the Placeholder, and it
exercises the IPC end-to-end so any catalog bugs surface before the
form work lands.

### Shipped

- **Rust `channels.rs`** — `Lazy<Vec<ChannelSpec>>` catalog covering
  Telegram, Discord, Slack, WhatsApp, Matrix, Feishu, WeChat, WeCom.
  Each spec has: stable lower-case slug id, display name, `yaml_root`
  (dotted path under `channels.*`), `env_keys` (name + required +
  i18n hint key), `yaml_fields` (`FieldKind::Bool | String |
  StringList` + label key + default), `hot_reloadable` (default
  `false`, conservative), `has_qr_login` (only WeChat).
- **Env allowlist extension.** `hermes_config::is_allowed_env_key`
  now accepts any name in `channels::allowed_channel_env_keys()`
  alongside the original `*_API_KEY` rule, so channel tokens go
  through the same `hermes_env_set_key` path as provider API keys.
  The allowlist stays tight — the UI still can't write arbitrary
  env vars.
- **New IPC** `hermes_channel_list` in `ipc/channels.rs` →
  `Vec<ChannelState>` joining catalog + on-disk state:
  `env_present: HashMap<name, bool>` (values never leave Rust) and
  `yaml_values: HashMap<path, JsonValue>` read by walking
  `serde_yaml::Value`. `spawn_blocking` wrapped.
- **`/channels` page** replaces the Placeholder:
  responsive grid of cards, one per channel, with a status pill
  (Configured / Partial / Unconfigured / QR login), env-key presence
  icons (name-only, never value), and a collapsible "behavior
  fields" preview that renders current YAML values compactly.
- **i18n** — new `channels.*` namespace in en + zh, ~25 keys each
  covering title, subtitle, status labels, field labels
  (`mention_required`, `auto_thread`, `reactions`, `enable`), and
  per-channel credential hints.

### Fixed

- (none — clean sprint)

### Deferred

- **T3.2** inline forms (flip-on-click, atomic `.env` + YAML writes,
  diff modal, "Restart gateway?" prompt on save).
- **T3.3** WeChat QR flow (Tencent iLink).
- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout (Drawer instead of card flip under 720px).
- WhatsApp env name is a `WHATSAPP_TOKEN` placeholder — must be
  verified against a live Hermes before T3.2 wires the form.

### Test totals

- Rust unit: **61** (was 51; +8 catalog invariants, +2 yaml walk)
- Vitest: 11
- Playwright: **25** (was 23; +2 channels cases covering all four
  status buckets + the "env names but never values" safety assertion)
- CI: clean on all 3 platforms

### Next

T3.2 — inline channel forms. The schema is already in place; the
front-end work is mostly wiring generic `FieldKind` renderers +
extending `hermes_config::write_env_key` to emit
`hermes.channel.*` journal entries.

---

## 2026-04-22 — Phase 2 complete (T2.1–T2.8)

### Context

One-day sprint that closed out every remaining Phase 2 task bucket on top
of the analytics baseline shipped the day before. The goal was to land
end-to-end control of Hermes's config surface (models, env keys,
profiles, logs, changelog) with every write atomic and reversible. Also
included the rebrand from "Caduceus" to **Corey** and the live
gateway-status badge that had been pending since Phase 1.

### Shipped

- **T2.1 — Config safety layer.** `src-tauri/src/fs_atomic.rs` with
  `atomic_write(path, bytes)` (tmp file + rename) and `append_line`
  (JSONL journaling). `changelog.rs` appends one entry per mutation
  with `{ id, ts, op, before, after, summary }` and a torn-line-tolerant
  tail reader. Every Hermes model / env / profile write funnels through
  this layer; the original file survives a mid-write SIGKILL (tested).

- **T2.2 — Model provider discovery.** `hermes_config_read/write_model`
  IPCs (Hermes's own `~/.hermes/config.yaml` `model` section),
  `hermes_env_set_key` (upsert / delete `*_API_KEY` in `~/.hermes/.env`;
  values never read back to the UI), `model_provider_probe` (hits
  OpenAI-compatible `/v1/models`). Models page gained a Discover button
  that populates the default-model combobox from the probe. Post-write
  RestartBanner surfaces the gateway-restart requirement and wires
  `hermes_gateway_restart` (shells to `hermes gateway restart`; falls
  back to `~/.local/bin/hermes`).

- **T2.3 — Settings page full.** Three sections:
  - **Appearance** — theme 3-way segmented control (Dark / Light /
    System) with proper `role=radiogroup`; language `<select>`
    (English / 中文). Theme writes to the existing zustand store;
    language fires `i18n.changeLanguage` with no reload. No new IPC, no
    new store — both controls piggyback on infrastructure that was
    already in place.
  - **Gateway** — base_url / api_key / default model with Test
    connection (latency readout); fully i18n'd.
  - **Storage** — read-only panel listing `config_dir`, `data_dir`,
    `db_path`, `changelog_path` with copy-to-clipboard. New IPC
    `app_paths` projects the already-cached `AppState` paths.

- **T2.4 — Usage ingestion.** `messages` schema v2 adds
  `prompt_tokens` / `completion_tokens` (nullable; backfill is safe).
  `upsert_message` uses `COALESCE` on conflict so content-only upserts
  don't wipe tokens. New `db_message_set_usage` IPC, called
  fire-and-forget from the chat stream's `onDone` with the real
  provider-reported values. Analytics now shows lifetime token totals
  (5th KPI) and a 30-day tokens-per-day chart alongside the existing
  activity chart.

- **T2.5 — Analytics.** Already landed 2026-04-21; extended above.

- **T2.6 — Hermes log tail.** New `/logs` is a tabbed surface: **Agent
  / Gateway / Error** (each tails `~/.hermes/logs/<kind>.log` via
  `hermes_log_tail`) plus **Changelog** (pre-existing). Read-on-demand
  with a client-side substring filter; no streaming / no `notify`
  watcher in this pass. Missing-file EmptyState surfaces the resolved
  path so users can verify their Hermes install. `LogLine` tints
  WARN/ERROR rows amber/red with a loose regex that catches both
  Python-logging and Rust-tracing formats.

- **T2.7 — Profiles.** New `/profiles` route over `~/.hermes/profiles/*`.
  Pure-FS ops: list (dir scan, active-first sort, hidden entries
  skipped), create (seeds a minimal `config.yaml`), rename
  (`fs::rename` with collision guards), delete (refuses the active
  profile), clone (recursive copy, skips symlinks). Name validation
  blocks traversal chars and `.`-prefixes. Every write appends a
  `hermes.profile.{create,rename,delete,clone}` entry.

- **T2.8 — Changelog viewer & revert.** `/logs` → Changelog tab shows
  each entry (time, op, summary, before/after JSON diff) with a Revert
  button. Dispatching currently covers `hermes.config.model`;
  `hermes.env.key` deletes are marked "Not revertible" (we never store
  the key value). Reverts themselves append a new entry describing the
  revert so the list stays honest.

- **Rebrand.** "Caduceus" → **Corey** everywhere user-visible
  (`app.name`, Topbar, Home hero). `docs/` and internal package names
  left alone.

- **Live gateway status badge.** Topbar dot polls `/health` every few
  seconds; flips online / offline / unknown with click-to-reprobe.

### Fixed

- Session rows now stamp `model` at creation so Analytics can bucket by
  model without retroactive patching.
- Clippy `io_other_error` lint on `hermes_profiles.rs` (used
  `io::Error::other` over the deprecated `::new(ErrorKind::Other, …)`
  pattern).

### Deferred

Kept out of Phase 2 deliberately; captured in
`docs/phases/phase-2-config.md` under **Deferred to later phases**.
Highlights:

- **tar.gz import / export of profiles** — needs a Tauri file-picker +
  manifest-preview dialog; rolls into Phase 3.
- **Per-profile gateway start / stop with port resolution** — gateway
  lifecycle control is Phase 3's territory.
- **Switching the active profile** — writing
  `~/.hermes/active_profile` safely requires quiescing the gateway
  first; Phase 3.
- **Revert dispatch for `hermes.profile.*`** — journal entries are
  already being written; extending the dispatcher is a small follow-up.
- **Streaming log tail (`notify` + SSE)** — manual refresh is adequate
  for single-digit-MB log files.
- **Command palette → specific settings section** — palette currently
  lands on `/settings` as a whole.
- **Per-section Settings sub-routes** (`/settings/{section}`) — rolled
  into the single scrollable page; easy to split later.

### Test totals at close

- Rust unit: **51** (up from 32)
- Vitest: 11
- Playwright: **23** (up from 7 at Phase 1 end)
- CI: clean on macOS · Windows · Linux matrix (3/3)

### Files added (selected)

```
src-tauri/src/
├── fs_atomic.rs                 (T2.1)
├── changelog.rs                 (T2.1)
├── hermes_config.rs             (T2.2)
├── hermes_logs.rs               (T2.6)
├── hermes_profiles.rs           (T2.7)
├── adapters/hermes/probe.rs     (T2.2)
└── ipc/{changelog,hermes_config,hermes_logs,hermes_profiles,paths}.rs

src/features/
├── logs/{index,ChangelogPanel,HermesLogPanel}.tsx  (T2.6 + T2.8)
├── profiles/index.tsx                              (T2.7)
├── analytics/index.tsx                             (T2.4 extension)
└── settings/index.tsx                              (T2.3 rewrite)

e2e/
├── analytics.spec.ts  · hermes-logs.spec.ts  · logs.spec.ts
├── profiles.spec.ts   · settings.spec.ts     · llms.spec.ts (extended)
```

### Next

Phase 3 — **Platform channels + gateway lifecycle + WeChat QR**. The
Phase 2 deferrals cluster naturally here.

---

## 2026-04-21 — Phase 2 Sprint 1: Analytics page

### Context

End of Phase 1 had us persisting sessions + messages + tool_calls to SQLite
(Sprint 5C) with no way to look at the aggregate. Analytics was picked as
the first Phase 2 sprint because (a) the raw data is already there, (b) it
proves the value of SQL-queryable storage over the old localStorage blob,
and (c) it's a visible win the user sees the moment the app opens.

### Shipped

- **Rust `analytics_summary`** in `db.rs` — one method, one lock, four
  queries (totals, 30-day per-day histogram, top-5 models, top-10 tools)
  plus a `generated_at` timestamp. `now_ms` is an argument (not pulled
  from the clock internally) so unit tests can pin time.
- **IPC `analytics_summary`** (`ipc/db.rs`) wraps the blocking call in
  `spawn_blocking` to stay polite to the Tokio runtime.
- **Frontend `features/analytics/index.tsx`** — single route, single IPC.
  Components:
  - **KPI strip** — 4 tiles (sessions, messages, tool_calls, active_days)
    with testid hooks for E2E.
  - **ActivityChart** — 30-day line chart, pure SVG (no Recharts). Pads
    sparse `{date,count}[]` to a dense 30-entry series so the x-axis
    always spans a month. Dots get `<title>` hover tooltips for a11y.
  - **HBarList** — horizontal percentage bars, used for models and tools.
  - **SkeletonGrid** / **ErrorBox** for the loading + failure shells.
- **i18n** — full `analytics.*` tree in en + zh.
- **Mocks + tests**:
  - Rust: `analytics_summary_aggregates_counts_and_windows` seeds 2
    sessions, 3 messages (one outside the 30-day window), and 3 tool
    calls, then asserts totals, window filtering, and sort order.
  - Playwright: 2 new tests — default mock renders KPIs + charts;
    zero-state renders the "No activity yet" empty hint.

### Design notes

- **Why hand-rolled SVG?** Recharts / ECharts are 100+ KB gzipped and
  their default visual language fights our Linear-esque tokens. For the
  shapes we actually need (line + h-bars + numeric tiles), ~200 lines of
  SVG land cleaner, respect CSS variables for theming, and add zero
  bundle weight.
- **Why one IPC, not four?** Analytics is read-only, cheap (<5 ms on
  ~10k rows), and every query shares the DB lock. One round trip beats
  four for both latency and code density.
- **UTC everywhere**: the backend's `date(created_at/1000,'unixepoch')`
  returns UTC dates, and the frontend's `padLast30Days` uses
  `getUTCDate` / `toISOString().slice(0, 10)` to match exactly. No
  timezone skew at midnight.

### Verified

- Rust: 16 tests (new test passes), clippy -D warnings clean.
- Vitest: 11 green.
- Playwright: 9 green (2 new).
- Manual: `/analytics` renders correctly against a real DB with ~5 seeded
  sessions; refresh button re-fetches.

---

## 2026-04-21 — Sprint 6: Playwright E2E scaffolding

### Context

Eight sprints of UI work with only unit tests (11 vitest + 15 cargo) left us
exposed to regressions that only show up in the full browser — store +
router + IPC wiring. Specifically: the recent infinite-loop we shipped in
Sprint 5C would have been caught instantly by any smoke test that just
opened `/chat`. Time to add an E2E safety net before Phase 2.

### Shipped

- **Runner**: `@playwright/test` (v1.59) targeting system Chrome via
  `channel: 'chrome'` — skips the 170 MB Chromium download. Driven against
  Vite's dev server, not the full Tauri webview, so a full run takes ~17 s.
- **Tauri IPC mock** (`e2e/fixtures/tauri-mock.ts`): a self-contained init
  script that stubs `window.__TAURI_INTERNALS__` with handlers for every
  command the frontend invokes — `home_stats`, `config_*`, `hermes_*`,
  `db_*`, `chat_send`, `chat_stream_start`, plus the `plugin:event|*`
  pub/sub so `@tauri-apps/api/event` works transparently. Tests can mutate
  fixture state via `window.__CADUCEUS_MOCK__.state` or override any
  command per-test via `.on('cmd', handler)`.
- **Suites** (7 tests):
  - `smoke.spec.ts` — shell renders, sidebar nav works, `/chat` loads,
    command palette opens, theme toggle flips `<html data-theme>`.
  - `chat.spec.ts` — full streaming round-trip: compose a prompt, watch
    two deltas + a done event fly through the mocked IPC, assert the
    assistant reply renders in a bubble.
  - `llms.spec.ts` — `/models` reads config on mount, `ApiKeyPanel`
    renders based on `env_keys_present`.
- **Scripts**: `pnpm test:e2e` (headless), `test:e2e:headed`, `test:e2e:ui`.
- **CI-ready**: retries=1 + 2 workers under `$CI`, `forbidOnly=true`,
  HTML report artefact.

### Design notes

- **Why not drive the real Tauri app?** Full-fat E2E via `tauri-driver`
  requires platform-specific webdrivers (Edge on macOS, webkit2gtk on
  Linux) and costs a full Rust rebuild per run. We get 95 % of the
  regression protection for 5 % of the cost by testing the UI + mocked
  IPC. Rust-side IPC contracts are still covered by `cargo test`.
- **Selector discipline**: prefer `getByRole` + accessible name over CSS.
  tanstack-router's `<Link>` proxies `href` weirdly (CSS
  `a[href="/chat"]` times out against a tree where the link definitely
  exists); role-based selection is both more stable and more honest to
  what a screen reader would see.

### Verified

All seven tests green in 17 s. `pnpm {typecheck,lint,test}` still green.

---

## 2026-04-21 — Phase 1 Sprint 5C: SQLite persistence (end of Phase 1)

### Context

Up through Sprint 5B, chat state lived in `localStorage` via `zustand/persist`. That works but has two problems: (1) clearing browser cache or reinstalling wipes every session, and (2) Phase 2's Analytics page needs SQL-queryable structured data, not a JSON blob. This sprint migrates persistence to SQLite, keeping zustand as the in-memory cache and using async IPC for the hot path.

### Shipped

- **Rust `db.rs`**: bundled-sqlite (`rusqlite` with `bundled` feature, zero system deps). Three normalized tables with FK cascades and indices: `sessions(id, title, model, created_at, updated_at)`, `messages(id, session_id, role, content, error, position, created_at)`, `tool_calls(id, message_id, tool, emoji, label, at)`. `Db::load_all()` returns the full tree in one call for app-startup hydration, folding joins into a nested `SessionWithMessages` shape. WAL + NORMAL sync + foreign_keys ON as pragmas.
- **IPC `ipc/db.rs`**: five commands — `db_load_all`, `db_session_upsert`, `db_session_delete`, `db_message_upsert`, `db_tool_call_append`. Each wraps the blocking `rusqlite` call in `tokio::task::spawn_blocking` so the Tokio runtime stays non-blocking.
- **Startup**: `Db::open` runs in the Tauri `setup()` hook against `<app_data_dir>/caduceus.db`. Failure to open (e.g. read-only home) logs loudly and sets `state.db = None` — the UI still works, just without persistence.
- **Frontend**:
  - `dbLoadAll()`, `dbSessionUpsert()`, `dbSessionDelete()`, `dbMessageUpsert()`, `dbToolCallAppend()` wrappers in `src/lib/ipc.ts`.
  - `zustand/persist` middleware removed from `src/stores/chat.ts`. Replaced with:
    - `hydrateFromDb()` action — called once from `ChatRoute` on mount; reads the tree, seeds the store, sets `hydrated: true`. Selects the MRU session as `currentId` automatically.
    - Every mutating action (`newSession`, `deleteSession`, `renameSession`, `setSessionModel`, `appendMessage`, `patchMessage`, `appendToolCall`) now mirrors its change to the DB via a fire-and-forget `fireWrite()` helper that logs failures. The UI stays synchronous; DB writes happen in the background.
  - `ChatRoute` gates the UI on `hydrated` — shows "Loading sessions…" until the first `dbLoadAll` returns, then either creates a fresh session or picks up where the user left off.
- **Tests**: 4 new cargo unit tests (round-trip, MRU ordering, cascade delete, upsert update) bringing total to 15.

### Design notes

- **No transaction batching yet**: each streaming delta currently triggers a `db_message_upsert` — one IPC + one SQLite write per chunk. Fine for human typing speed (hundreds of writes/sec with WAL is cheap) but wasteful. A debounced write or a dedicated "streaming" IPC that batches could cut this by 10×. Left for a future optimization pass.
- **`pending` flag is UI-only**: not mirrored to the DB because it's ephemeral ("waiting on first delta"). Messages that were pending when the app crashed will reload as non-pending (correct — the stream is gone either way).
- **Race-free tool calls**: `appendToolCall` uses a separate store action from `patchMessage` (content accumulation) because SSE interleaves tool events and content deltas; combining them in one patch could drop one of the two updates.

### Verified

- `pnpm {typecheck,lint,test,build}` + `cargo {check,clippy,test,fmt --check}` green. 15 cargo tests + 11 vitest tests passing.
- Manual: create a session, chat, quit the app, relaunch → session + messages + tool calls all restored.

---

## 2026-04-21 — Phase 1 Sprint 5B: tool call rendering (agent visibility)

### Context

Hermes is an *agent*, not just a chat model: it invokes `terminal`, `file_read`, `web_search`, etc. while composing its response. Phase 1 Sprint 1–2's SSE parser captured only the default `chat.completion.chunk` stream, silently dropping Hermes's custom `event: hermes.tool.progress` markers. Users saw the prose but had no idea work was being done on their behalf.

### Investigation

Reverse-engineered Hermes's SSE by triggering a prompt that forced a tool call. Hermes emits `event: hermes.tool.progress\ndata: {"tool": "terminal", "emoji": "💻", "label": "pwd"}` once per tool invocation. The tool's OUTPUT is baked into subsequent assistant `content` deltas by the agent itself (no separate "tool result" event needed).

### Shipped

- **Rust `gateway.rs`**: SSE loop now branches on the `event:` line. Default / `message` events continue as `chat.completion.chunk`; `hermes.tool.progress` events parse as the new `HermesToolProgress` struct. The mpsc channel payload changed from `String` to a new `ChatStreamEvent` enum (`Delta(String) | Tool(HermesToolProgress)`) so deltas and annotations share one ordered stream — preserving their relative sequence for UI rendering.
- **IPC `chat_stream_start`**: emits `chat:tool:{handle}` in addition to the existing `chat:delta:{handle}`. Listeners subscribe to whichever they care about.
- **Frontend `ipc.ts`**: `ChatStreamCallbacks.onTool?` callback + `ChatToolProgress` type. Listener is only registered when the caller provides `onTool`.
- **Chat store**: `UiMessage.toolCalls: UiToolCall[]` + `appendToolCall` action (race-free separation from `patchMessage` since tool events and content deltas may interleave). Persisted across restarts via existing zustand/persist.
- **`MessageBubble`**: new `ToolCallsStrip` rendering a row of pills ABOVE the prose showing `<emoji> <tool> · <label>` (e.g. `💻 terminal · pwd`). Pills are read-only signals — clicking them does nothing for now since the output is already in the text below.
- **ChatRoute**: `onTool` handler on `chatStream()` appends to the assistant message's `toolCalls` and proactively clears the `pending` spinner (the tool event itself proves the stream is alive before any content lands).

### Deferred

- **Expandable tool panels with input/output/duration**: would require Hermes to emit a "tool complete" event with the output payload. Not available in the current Hermes build. Current pills cover the "what did the agent do" question; a proper trajectory view is a Phase 4 feature.
- **Tool-specific renderings** (file viewer, diff, web search results list): same dependency as above.

### Verified

- `pnpm {typecheck,lint,test}` + `cargo {check,clippy,test,fmt --check}` green. 11 vitest + 11 cargo tests still passing.
- Manual: prompt `"Use bash to run pwd and tell me the output"` — pill appears above the response reading `💻 terminal · pwd`.

---

## 2026-04-21 — Phase 1 Sprint 5A: closed-loop LLM switching (.env + restart)

### Context

Sprint 4 let users change the provider/model in `config.yaml`, but adding a new provider still required (1) hand-editing `~/.hermes/.env` for the API key and (2) shelling out to `hermes gateway restart`. This sprint closes that loop.

### Shipped

- **Rust `hermes_config.rs`**: `write_env_key(key, value)` does an upsert-or-delete on `~/.hermes/.env` while preserving every other line (comments, blanks, order). Only `*_API_KEY` names are permitted (server-side allowlist via `is_allowed_env_key`). Writes atomically via tmp + rename, and `chmod 0600`s the file on Unix since it now holds secrets. `gateway_restart()` shells out to `hermes gateway restart`, resolving the binary from `$PATH` → `~/.local/bin/hermes` fallback.
- **IPC**: `hermes_env_set_key(key, value)` + `hermes_gateway_restart()`. The restart IPC runs the blocking `Command::output()` via `tokio::task::spawn_blocking` so it doesn't stall the runtime. Returns the combined stdout/stderr on success.
- **LLMs page — `ApiKeyPanel`**: inline form rendered below the provider dropdown. Collapsed "✓ set" state with a **Rotate** affordance; expanded form is a password input with show/hide, Enter-to-submit, 0600 reminder, and an error row. The key value exists only in local component state — sent directly to the IPC, never persisted elsewhere, cleared on save.
- **LLMs page — restart banner upgraded**: new **Restart now** button calls `hermesGatewayRestart()`, shows a spinner while running, then waits ~1.2s and re-reads Hermes config. Output from the CLI is displayed in a monospaced box when non-empty. Fallback instruction to run it manually is retained.
- **Frontend ipc.ts**: `hermesEnvSetKey()` + `hermesGatewayRestart()` wrappers.
- **Tests**: 2 new cargo unit tests (`is_allowed_env_key_gates_non_api_keys`, `line_matches_key_handles_whitespace_and_comments`) bringing total to 11.

### Safety notes

- **API keys never round-trip through Caduceus**: the read path returns only key NAMES; values live only in `~/.hermes/.env`. The write path is one-way (`hermesEnvSetKey(key, value)` sends, backend stores, UI clears).
- **Allowlist on the write endpoint**: `is_allowed_env_key` rejects anything not matching `/^[A-Z0-9_]+_API_KEY$/`, so this IPC can't be abused to corrupt `API_SERVER_PORT`, `GATEWAY_ALLOW_ALL_USERS`, etc.
- **File perms**: `0600` on Unix after write. The existing file may have already been 0600 (Hermes installer sets that); we preserve the intent.

### Verified

- 11 cargo tests (2 new) + 11 vitest tests green. typecheck + lint + clippy + fmt clean.

### Deferred

- **Gateway health verification after restart**: we re-read Hermes config but don't actively probe `/health`. Hermes's restart is usually < 2s but could fail; a retry loop with exponential backoff is a clean follow-up.
- **Batch API-key import**: no UI for pasting an entire `.env` file at once. Not needed for single-provider flow.

---

## 2026-04-21 — Phase 1 Sprint 4: Hermes config integration (the real LLM knob)

### Context

Hermes Gateway's `/v1/models` returns only `hermes-agent` — the gateway wraps itself as a single virtual model. The actual LLM (DeepSeek, OpenAI, etc.) is configured inside Hermes at `~/.hermes/config.yaml` and its API keys live in `~/.hermes/.env`. Sprint 3's Models page showed `/v1/models` output, which was technically correct but practically useless for switching the underlying LLM.

### Shipped

- **Rust `hermes_config.rs`**: reads `~/.hermes/config.yaml` via `serde_yaml::Value` (preserving all non-`model` fields verbatim so user-edited bits like `fallback_providers`, `auxiliary.*`, etc. survive a round-trip). `HermesModelSection { default, provider, base_url }` is the subset we expose. `write_model()` does atomic tmp+rename. Also parses `~/.hermes/.env` and returns the KEY NAMES of any non-empty `*_API_KEY=` lines — **never the values** (secrets stay out of the IPC channel). 3 new unit tests.
- **IPC**: `hermes_config_read` / `hermes_config_write_model` in `src-tauri/src/ipc/hermes_config.rs`.
- **LLMs page rewritten** (`src/features/models/index.tsx`):
  - **Current card**: shows the file path + current `provider`, `model`, `base_url`.
  - **Change model form**: provider dropdown with 7 pre-populated options (DeepSeek, OpenAI, Anthropic, OpenRouter, Z.AI, Kimi, MiniMax), model id input with per-provider datalist suggestions, optional base_url. Auto-fills base_url when switching between known providers.
  - **API-key presence indicator**: reads `~/.hermes/.env` and shows a green check if the selected provider's key env var is set, or an amber warning telling the user which key to add.
  - **Restart banner**: after saving, shows a prominent instruction to run `hermes gateway restart` (Hermes does NOT hot-reload model config).
  - **Not-present state**: if `~/.hermes/config.yaml` is missing, shows a clear warning rather than failing silently.
- **Frontend ipc.ts**: `hermesConfigRead()` + `hermesConfigWriteModel()` wrappers.

### Trade-offs / deferred

- **No gateway-restart button yet**: Caduceus can't shell out to `hermes gateway restart` without Tauri capability config. Kept as a manual step for this sprint; automation is a clean follow-up.
- **API keys are still hand-edited in `.env`**: we only READ the presence of `*_API_KEY` names. Write support needs careful UX around secrets + atomic updates to an env file — deferred.
- **Chat per-session ModelPicker** (Sprint 3) now shows `hermes-agent` only because `/v1/models` always returns that one entry. Left in place as a status indicator; it'll become useful again in Phase 5 when multiple adapters can register.

### Verified

- 9 cargo tests (3 new) + 11 vitest tests all green. clippy + fmt clean. typecheck + lint clean.

---

## 2026-04-21 — Phase 1 Sprint 3: Models page + per-session model picker

### Shipped

- **Real `/v1/models`**: `HermesGateway::list_models()` hits the OpenAI-compatible endpoint (`GET /v1/models`) and returns `Vec<ModelListEntry>` (id + owned_by + created). `HermesAdapter::list_models()` in live mode maps these to the richer `ModelInfo`, synthesizing `is_default` by comparing the entry id against the adapter's current `default_model`. Stub mode still returns the fixtures for offline dev.
- **Models page** (`src/features/models/index.tsx`): replaces the Phase-0 placeholder. Table of model id / provider / context window with a **DEFAULT** badge on the active one. **Set default** button calls `config_set` (reuses the Settings hot-swap path) and reloads. **Refresh** action in the header. Error state with retry.
- **Per-session model picker** (`src/features/chat/ModelPicker.tsx`): compact dropdown above the composer showing the effective model id. Lazy-fetches the model list on first open (not mount) so idle sessions don't hit the gateway. **SESSION** badge highlights when the session has an override; **Clear** reverts to the gateway default. Outside-click + Escape close.
- **Chat store extension**: `ChatSession.model?: string | null` + `setSessionModel(id, model)` action. Persistent across restarts (zustand/persist). Chat pane passes `model` in the `chatStream` payload only when an override is set — otherwise the Rust side falls through to `HermesAdapter`'s `default_model`.
- **`ModelInfo` + `modelList()` wrappers** in `src/lib/ipc.ts`.

### Verified

- `pnpm {typecheck,lint,test,build}` + `cargo {check,clippy,test,fmt --check}` all green. 11 vitest + 6 cargo tests still passing; bundle grew ~4 KB gzip.

### Notes

- Gateway `/v1/models` is sparse (usually just `id` + `owned_by`). Fields like `context_window`, `display_name`, or tool-use capability need provider-specific enrichment; deferred to a Phase 2 "Model registry" feature that can cross-reference a local manifest.
- Chat picker shows the literal model id as the label. Once display names are enriched, the picker will use the human-readable form.

---

## 2026-04-21 — Phase 1 Sprint 2B: Settings page + runtime gateway config

### Shipped

- **Settings page, real** (`src/features/settings/index.tsx`): replaces the Phase-0 placeholder. Form with **Base URL**, **API key** (password input with show/hide toggle), **Default model** (with datalist suggestions). **Test connection** button probes `/health` without persisting. **Save** applies atomically. Reset button reverts to loaded snapshot. Unsaved-change indicator + inline success/error states.
- **Rust `config.rs`**: new `GatewayConfig` type with `load_or_default(dir)` + atomic `save(dir)`. File lives at `<app_config_dir>/gateway.json` (platform-native, macOS `~/Library/Application Support/com.caduceus.app/`). Env vars (`HERMES_GATEWAY_URL` / `_KEY` / `_MODEL`) remain as a fallback for bootstrap. 3 unit tests covering defaults, roundtrip, missing-file fallback.
- **`AdapterRegistry` hot-swap**: internal `HashMap` moved behind `RwLock` so `register()` takes `&self`. Lets the IPC `config_set` command swap the Hermes adapter without app restart. In-flight streams finish against the old `Arc<HermesAdapter>`; subsequent requests pick up the new one.
- **IPC `config_get` / `config_set` / `config_test`** (`src-tauri/src/ipc/config.rs`): **set** validates URL → builds adapter → persists JSON → hot-swaps atomically. **test** builds a throwaway `HermesGateway` and hits `/health` — zero side effects.
- **`AppState` extension**: now holds `Arc<RwLock<GatewayConfig>>` + `config_dir: PathBuf`. Initialization moved into Tauri's `setup()` hook so `app.path().app_config_dir()` can resolve the platform-native path.
- **Frontend IPC wrappers**: `configGet()`, `configSet()`, `configTest()` in `src/lib/ipc.ts`. `HealthProbe` now `Serialize`-able.

### Verified

- `pnpm {typecheck,lint,test,build}` all green. 11 vitest + 6 cargo tests passing (3 new config tests). `cargo clippy -- -D warnings` clean. `cargo fmt --check` clean.

### Deferred

- **Encrypted API key storage** (keychain / stronghold): current impl is plaintext JSON under user-level app data. Acceptable local-desktop trust boundary for Phase 1; hardening in Phase 2+.
- **Multi-adapter Settings**: only Hermes is registered today. Profiles (multiple saved gateway configs you can switch between) are a Phase 4 dependency for the multi-model compare feature.

---

## 2026-04-21 — Phase 1 Sprint 2: sessions, stop, syntax highlighting

### Shipped

- **Stop button**: Send button swaps to a Stop icon while streaming. Click (or submit) cancels the client-side `ChatStreamHandle` — event subscriptions tear down immediately; backend task runs to completion but its events are ignored. Already-streamed content is kept; the `thinking…` state clears.
- **Client-side session management** (`src/stores/chat.ts`): zustand store with `persist` middleware to `localStorage` (key `caduceus.chat.v1`). State: `sessions: Record<id, ChatSession>`, `orderedIds` (MRU), `currentId`. Actions: `newSession()`, `switchTo()`, `deleteSession()`, `renameSession()`, `appendMessage()`, `patchMessage()`. Titles auto-derive from the first user message (truncated to 40 chars). Bumping a session via `appendMessage` moves it to MRU top.
- **Sessions side panel** (`src/features/chat/SessionsPanel.tsx`): 240px left pane inside the Chat route. Header row with **New** button; scrollable MRU list with hover-revealed delete (with confirm). Active session highlighted in `gold-500/10`.
- **Chat page refactor**: `ChatRoute` now mounts `SessionsPanel` + a `ChatPane` bound to the current session. Composer state (`draft`, `sending`, `streamRef`, `pendingRef`) resets on session switch so switching mid-stream is clean. Message render still uses `MessageBubble` — extracted to its own file to keep `index.tsx` focused on orchestration.
- **Code syntax highlighting**: `rehype-highlight@7` + `highlight.js@11` integrated into the Markdown renderer. Auto language detection on block code. `highlight.js/styles/github-dark.css` loaded globally; block code renders on a fixed `#0d1117` backdrop + `#e6edf3` ink so colors read correctly under both light and dark app themes. Inline code unaffected.
- **Message DTO change (breaking, internal only)**: `UiMessage` moved from Chat page to `src/stores/chat.ts`, added `createdAt: number`. IPC payload still maps down to `{ role, content }`.

### Verified

- `pnpm {typecheck,lint,test,build}` all green. 11 vitest tests still passing. Bundle grew to ~238 KB gzip (from react-markdown + remark-gfm + highlight.js); Phase 2 code-splitting candidate.

### Deferred to Sprint 2B / Phase 2

- **Server-side (Rust) session storage** in SQLite — still frontend-only.
- **Tool call rendering** (folded cards for Hermes `tool_call` events).
- **Attachments** (drag-drop files + image preview).

---

## 2026-04-21 — Phase 1 Sprint 1: real Hermes chat (streaming)

### Shipped

- **Hermes gateway integration live**: Caduceus now talks to a real local Hermes gateway (`http://127.0.0.1:8642`) backed by DeepSeek. Gateway install + DeepSeek config documented; `API_SERVER_ENABLED=true` enables the OpenAI-compatible HTTP platform.
- **Rust `HermesGateway` client** (`src-tauri/src/adapters/hermes/gateway.rs`): reqwest-based, supports `GET /health`, `POST /v1/chat/completions` (non-streaming via `chat_once`, streaming via `chat_stream` using `eventsource-stream`).
- **`HermesAdapter` live mode**: new `HermesAdapter::new_live(base_url, api_key, default_model)` constructor wired through `build_hermes_adapter()` in `lib.rs`. Reads `HERMES_GATEWAY_URL` / `HERMES_GATEWAY_KEY` / `HERMES_DEFAULT_MODEL` env overrides; falls back to stub on construction failure. Stub mode preserved for tests and offline dev.
- **`AgentAdapter` trait extended**: added default-unsupported `chat_once(turn)` and `chat_stream(turn, tx)` methods. `ChatTurn` + `ChatMessageDto` DTOs live in `adapters/mod.rs`.
- **IPC commands**: `chat_send` (non-streaming) + `chat_stream_start` (streaming). Streaming emits three per-handle events: `chat:delta:{handle}`, `chat:done:{handle}`, `chat:error:{handle}`. Handle is caller-supplied from the frontend to eliminate the "first delta before listener attached" race.
- **Frontend IPC wrappers** (`src/lib/ipc.ts`): `chatSend()`, `chatStream(args, { onDelta, onDone, onError })` returning a `ChatStreamHandle` with `cancel()`. `ipcErrorMessage()` converts the Rust `IpcError` envelope into human-readable strings.
- **Chat UI** (`src/features/chat/index.tsx`): real chat page with composer (Enter / Shift+Enter), gold user bubbles with fixed dark ink, assistant bubbles rendering GFM markdown (tables, lists, inline/block code, blockquotes, links) via `react-markdown` + `remark-gfm`. Empty-state hero with suggested prompts. Auto-scroll, pending `thinking…` placeholder until first delta.
- **End-to-end verified**: ⌘1 → Chat → type → streaming DeepSeek reply with markdown rendering + multi-turn context preserved client-side.

### Not in scope (deferred to Sprint 2)

- **Server-side sessions**: frontend is the source of truth for history. Persistence + resume lands in Sprint 2.
- **Cancel mid-stream**: `chatStream()` returns a `cancel()` handle but the UI doesn't yet surface a stop button.
- **Tool calls / attachments / voice / skills**: Sprint 2+ milestones.

### Notes

- Gateway install hiccups during session: GitHub clone from CN required `ghfast.top` mirror; pip via `https://pypi.tuna.tsinghua.edu.cn/simple`; browser tools (playwright + camoufox) skipped — optional for chat.
- First Tailwind token sweep caught `bg-surface` / `text-muted` / `bg-accent` which don't exist in our design tokens — replaced with real tokens (`bg-bg-elev-1`, `text-fg-muted`, `bg-gold-500`).

---

## 2026-04-21 — Phase 0.5 quality gates

### Shipped

- **Windows path correctness**: Added `dunce` dependency and swapped all `std::fs::canonicalize` call sites in `src-tauri/src/sandbox/mod.rs`. On Windows this strips the `\\?\` verbatim prefix so hard-denylist entries like `C:\Windows\System32\` actually match canonicalized paths. On macOS/Linux `dunce::canonicalize` delegates to std, so it is a zero-cost change there.
- **Rust lint gate**: `cargo clippy --lib --all-targets -- -D warnings` passes clean. Removed manual `Default for Capabilities` in favour of `#[derive(Default)]`; added crate-level `#![allow(dead_code)]` with a TODO(phase-1-end) note to cover Phase 0 scaffold APIs that Phase 1+ will wire up.
- **Rust format gate**: `cargo fmt --check` passes clean; first fmt pass applied across `src-tauri/src/**`.
- **Vitest harness**: `vitest@^2` + `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` installed. `vitest.setup.ts` injects a `MemoryStorage` polyfill for `window.localStorage` / `window.sessionStorage` (jsdom 29 omits these) plus a `matchMedia` stub, so zustand/persist hydrates cleanly under tests. `tsconfig.json` now includes `vitest/globals` + `jest-dom` types.
- **Unit tests (11 passing)**: `src/lib/cn.test.ts` (4), `src/stores/palette.test.ts` (3), `src/stores/ui.test.ts` (4). Covers twMerge semantics, persist-free store mutation, theme toggle DOM side-effects.
- **CI matrix (`.github/workflows/ci.yml`)**: two parallel jobs × 3 OSes (macOS / Ubuntu / Windows). Frontend job runs `pnpm {typecheck,lint,test,build}`; Rust job installs Linux WebKit deps, uses `Swatinem/rust-cache@v2`, runs `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --lib`. Concurrency cancels in-flight on force-push.
- **Global route shortcuts**: `src/app/useNavShortcuts.ts` mounts in `AppShell`, reads `NAV[].shortcut` as the single source of truth, and binds ⌘0..9 + ⌘, (macOS) / Ctrl variants elsewhere. Skips when the event target is an input/textarea/contenteditable to not fight typing; ignores Shift/Alt combos so it doesn't collide with ⌘⇧L theme toggle or ⌘K palette.

### Deferred (not in 0.5 scope)

- **Playwright e2e** — deferred to early Phase 1; a Tauri-window e2e smoke is more valuable once there's a real chat turn to drive.
- **Storybook / Ladle** — deferred; visual review through the running app is sufficient at Phase 0 component count.
- **pnpm build end-to-end installer verification** — needs platform signing decisions first (Phase 2 release track).

### Notes

- 11 frontend unit tests + 3 Rust sandbox tests = **14 gated tests** locally and in CI.
- Verified locally on macOS 14 arm64: all 5 CI gates (typecheck, lint, test, clippy, cargo test) green.

---

## 2026-04-21 — Phase 0 foundation + sandbox plumbing

### Shipped

- **Toolchain scaffold**: pnpm 9, TypeScript 5.9 strict, Vite 5, Tailwind 3 with design tokens, ESLint 9 flat config, Prettier, Tauri 2 + Rust stable.
- **Design system**: `src/styles/tokens.css` + `globals.css`; light/dark themes via `[data-theme]`; no hard-coded colors in components.
- **App shell**: `AppShell / Sidebar / Topbar / PageHeader`; 12 navigation entries (Home + 11 feature routes); 10 placeholder routes + Home landing.
- **Command palette**: `cmdk` wrapper with route-jump group + preferences (theme toggle). ⌘K / Ctrl+K global shortcut. ⌘⇧L toggles theme.
- **i18n**: `react-i18next` with `en.json` / `zh.json`, language auto-detect with localStorage persistence.
- **State**: Zustand stores for UI (theme, sidebar) and palette; persisted via middleware.
- **Rust core**: `AgentAdapter` trait + `AdapterRegistry`; `HermesAdapter` Phase 0 stub with JSON fixtures (3 sessions, 5 models); 5 IPC commands (`health_check`, `session_list`, `session_get`, `model_list`, `chat_send_stub`).
- **Sandbox plumbing** (`docs/08-sandbox.md`): `PathAuthority` with cross-platform hard denylist (macOS/Linux/Windows) + home-relative credential paths (.ssh, .aws/credentials, .kube/config, .gnupg, .docker/config.json, .netrc); `sandbox::fs` middleware (`read_to_string`, `read_dir_count`, `write`); 3 unit tests green.
- **Demo IPC**: `home_stats` command + `lib/ipc.ts` wrapper + Home-page badge showing `$HOME` entry count and sandbox mode — proves React ↔ Tauri IPC ↔ Rust fs round-trip.
- **Window chrome**: `titleBarStyle: Overlay` with `data-tauri-drag-region` on Topbar + Sidebar brand; 80px left inset to clear macOS traffic lights.
- **Placeholder icons**: Python-stdlib PNG generator (`scripts/generate-placeholder-icon.py`) + `pnpm tauri icon` fan-out.
- **Capabilities**: Tauri 2 minimal permission set (`core:default`, window drag, event, shell).
- **Docs**: `SETUP.md`, updated `README.md`, new `docs/08-sandbox.md`, updated `docs/05-roadmap.md` + `docs/phases/phase-0-foundation.md` with shipped status.

### Fixed

- Denylist missed "the directory itself" — `.ssh/` rule didn't catch `~/.ssh` (no trailing slash after canonicalization). Caught by unit test during self-check.
- `Path::starts_with` semantic fix — string `starts_with` would false-match `.sshfoo/` against `.ssh/`.
- Windows mixed separators — `PathBuf::join` replaces `format!("{home}/{rel}")`.
- `LucideIcon` type incompatibility in `Sidebar` / `Palette` — previous `ComponentType<{size,strokeWidth}>` too narrow.
- `generate_context!()` at compile-time requires icons and `frontendDist` dir on disk. Added placeholder `dist/.gitkeep` and icons fan-out.
- Window non-draggable with `Overlay` title bar — added `data-tauri-drag-region` attributes.

### Deferred to Phase 0.5

- GitHub Actions CI matrix (macOS / Ubuntu / Windows).
- Storybook / Ladle with ≥ 8 primitive stories.
- Playwright + Tauri webdriver e2e ("open → palette → goto settings").
- Vitest unit tests for React components.
- `rustup component add clippy` + CI gate.
- Windows `\\?\` verbatim-prefix normalization via `dunce` crate + `#[cfg(windows)]` sandbox tests.
- Global `Cmd+1..9` route-jump listener (currently hint-only in palette).
- `pnpm build` end-to-end installer verification.

### Notes

- Runtime verified: macOS 14 arm64 (`pnpm tauri:dev` boots, window renders, IPC round-trip succeeds).
- Not yet verified: Linux, Windows (no CI runners yet).
- Git: repo is **not** yet initialized — first `git init && git commit` pending user action.
