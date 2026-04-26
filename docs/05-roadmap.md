# 05 · Roadmap

## At a glance

| Phase | Title                 | Exit criteria                                          | Est.      | Status |
|------:|-----------------------|--------------------------------------------------------|-----------|--------|
| 0     | Foundation            | App shell + palette + Hermes stub adapter + CI green   | 1–2 days  | **Core shipped** (2026-04-21), 7/10 exit criteria |
| 0.5   | Hardening             | CI matrix + lint/format/test gates + Windows sandbox fix + nav shortcuts | 1–2 days | **Shipped** (2026-04-21); Playwright e2e (52 specs) + Storybook 8 scaffolding added 2026-04-23. See CHANGELOG. |
| 1     | Chat core             | Real SSE chat, sessions, tool calls, attachments       | 3–4 days  | **Shipped** (2026-04-22) — T1.1–T1.7 all green; T1.5 attachments + T1.5b multimodal wire format land; T1.8 initial-connect retry + T1.9 react-virtuoso virtualisation both landed 2026-04-23. **No Phase 1 items remain deferred.** See `docs/phases/phase-1-chat.md`. |
| 2     | Config & Ops          | Models, Analytics, Logs, Settings, Profiles            | ~1 week   | **Shipped** (2026-04-22) — T2.1–T2.8 all green; profile tar.gz import/export + active-profile switching (incl. optional gateway bounce) both landed 2026-04-23. Per-profile gateway PID management explicitly out-of-scope (Hermes owns its own `gateway start/stop` CLI). **No Phase 2 items remain deferred.** |
| 3     | Platform channels     | 8 channels + gateway restart + WeChat QR               | ~1 week   | **Shipped** (2026-04-22) — T3.1–T3.5 all green. Real Tencent iLink client + explicit-clear-secret button + `/health/channels` probe deferred; see `docs/phases/phase-3-channels.md`. |
| 4     | Differentiators       | Multi-model compare, skill editor, trajectory, budgets, terminal | 1–2 weeks | **Shipped** (2026-04-22) — T4.1–T4.6 all green; T4.4b chat-send budget gate (80% warn / 100% block, period windowing, adapter scope) fleshed out 2026-04-23; T4.2b CodeMirror 6 landed in Skills 2026-04-23. Compare / Runbooks / Budgets / Trajectory / Terminal / Skills all land with e2e + Rust tests. T4.5b multi-tab Terminal landed 2026-04-23; T4.6b runbook scope filter was already shipped (verified 2026-04-23 — `runbooks-scope-filter` e2e green, `runbookScopeApplies()` helper in `src/features/runbooks/index.tsx`). No Phase 4 items remain deferred. See `docs/phases/phase-4-differentiators.md`. |
| 5     | Multi-agent console   | 2+ non-Hermes adapters running side-by-side            | ~1 week   | **Shipped** (2026-04-23) — T5.1–T5.6 all green. Trait polish + Claude Code/Aider mocks + conformance suite + AgentSwitcher (selection, capability-gated Sidebar, `adapter_id` chat routing) + unified inbox (DB v5, per-row adapter badges, Active/All-agents scope) + cross-adapter analytics + budget adapter-scope dropdown. Deferred: T5.2b/T5.3b real CLIs, T5.4 OpenHands. |
| 6     | Orchestration core    | Multi-Hermes + feedback loop + routing + per-agent sandbox + channel fixes + **Scheduler wrap** | ~2 weeks | **Shipped** (2026-04-23 pm — all KEEP items landed, T6.6 DROPPED per audit). **T6.7a shipped** — 3 silently-broken channel schemas fixed (WhatsApp/WeCom/WeiXin), WeChat QR stack deleted, Slack App Token added; 146 Rust tests pass, +2 new schema-lock tests. **T6.8 shipped** — Scheduler refactor: deleted Rust worker + SQLite table, now wraps `~/.hermes/cron/jobs.json`; added Runs drawer to surface `~/.hermes/cron/output/{job_id}/*.md`; 150 Rust tests pass, +4 new tests. **T6.1 shipped** — feedback loop: DB v8 + `db_message_set_feedback` IPC + 👍/👎 per assistant reply + Analytics card; 153 Rust tests pass, +3 new tests. **T6.2 shipped** — multi-instance Hermes: `hermes_instances.json` + 4 IPC commands + `AdapterRegistry` refactor (String keys, `register_with_id_and_label`, `unregister`) + Settings CRUD panel; 161 Rust tests pass, +8 new. **T6.4 shipped** — rules-based routing: `routing_rules.json` + 3 IPC commands + pure frontend resolver + Composer hint pill + Settings CRUD; 168 Rust tests (+7) and 37 Vitest (+10). **T6.3 shipped** — subagent tree in Trajectory: pure-UI grouping of `delegate_task` parents with their subsequent tool calls; 46 Vitest (+9 `subagents.test.ts`); no backend / schema change. **T6.7b shipped** — Telegram e2e smoke test + Verified badge catalog + mock hotfix (TS-only `as Array<>` / `(r: any) =>` inside `/* js */` template had silently broken 48/55 Playwright specs since T6.2/T6.4 merge); Playwright now 55/55 green (+1 `telegram-smoke.spec.ts`). **T6.5 shipped** — per-agent sandbox isolation: `SandboxScope` data model + `sandbox.json` v2 (v1→v2 migration) + scope CRUD IPC + `HermesInstance.sandbox_scope_id` + Settings UI (scope picker per instance + management section) + runtime enforcement on `attachment_stage_path`; 179 Rust (+11), 56 Playwright (+1 `sandbox-scopes.spec.ts`). **T6.7c shipped** — channel smoke tests for Discord/Slack/Feishu/WeiXin/WeCom via one parameterised `channels-smoke.spec.ts`; `VERIFIED_CHANNELS` now ships 6 channels; 61 Playwright (+5). **Phase 6 is DONE** (T6.6 DROPPED, all KEEP items landed). See `docs/phases/phase-6-orchestration.md` + `docs/10-product-audit-2026-04-23.md`. |
| 7     | Agent expansion       | MCP manager UI + skill-from-chat + Memory page GUI + Skills hub wrapper | ~1.5 weeks | **Shipped** (2026-04-23 pm, all 4/4 tasks green). **T7.1 MCP server manager** (`~/.hermes/config.yaml` `mcp_servers:` editor, stdio + URL transports, restart-gateway nudge). **T7.2 Save-as-Skill** (chat header button → drawer with pre-filled SKILL.md template → writes to `~/.hermes/skills/`). **T7.3 Memory page** (two-tab editor over `MEMORY.md` + `USER.md`, 256 KiB cap, UTF-8 byte-accurate capacity meter). **T7.4 Skill Hub browser** (Local / Hub tabs on Skills page, wraps `hermes skills browse/search/install` with subcommand allowlist + CLI-missing state). 188 Rust (+9), 71 Playwright (+10), en + zh i18n complete. Deferred: T7.2 LLM-distillation pass, T7.3 session_search panel, T7.1 reachability probe, T7.4 structured-list parsing. See `docs/phases/phase-7-expansion.md`. |
| 7.5 (T8) | Multi-LLM + multi-Agent | Reusable `LlmProfile` library, multi-Hermes-instance `/agents` page, guided wizard with 11 provider templates (incl. 6 国产 LLMs + NVIDIA NIM) | ~3 days | **Shipped** (2026-04-24 night). Rust `llm_profiles` module + 4 IPC commands + `HermesInstance.llm_profile_id` foreign key. `/agents` promoted to a top-level route. `/models` gets a card grid for LLM profiles; legacy single-model config.yaml form collapsed under a `<details>`. AgentWizard Step 1 surfaces existing profiles first, then falls back to provider templates. Every native `<select>` replaced with our themed `<Select>` / `<Combobox>`. 6 国产 LLM templates added (Qwen / GLM / Kimi / Yi / Baichuan / Hunyuan). NVIDIA NIM added 2026-04-26 (GLM-5.1 / DeepSeek V3.2 / MiniMax M2.7 / Llama 3.3 / Nemotron 70B). Test button now probes `/v1/models` (was Hermes-specific `/health` → 401 on upstreams). Two-click delete with display-name label. 211 Rust (+19), 81 Playwright (+7). Deferred: 字节豆包 (endpoint-id UI), 百度文心 (AK/SK auth branch), full Masonic drawer UX. See `CHANGELOG.md` 2026-04-24 (night). |
| 8     | Multimodal (optional) | Voice push-to-talk via cloud APIs + video-as-Hermes-backend-capability | 2–3 weeks | **Shipped** (2026-04-26). 4 providers (OpenAI/Zhipu/Groq/Edge TTS), system-level mic recording (cpal), push-to-talk in chat, TTS playback on messages, audit log, Settings UI. 7 IPC commands. See `src-tauri/src/ipc/voice.rs`. |
| 8.5   | Voice                 | ASR/TTS integration with domestic providers (Zhipu) + system-level mic recording | ~1 week   | **Merged into Phase 8** (2026-04-26). See Phase 8 row above. |
| 9     | Workflow Engine       | Visual DAG editor + multi-agent orchestration + template marketplace | ~3 weeks  | **Shipped** (2026-04-26) — All 9 tasks green. T9.1 model/store/parser, T9.2 engine (topo-sort, context, step executor), T9.3 IPC, T9.4 list page, T9.5 React Flow visual editor (custom StepNode + PropertyPanel), T9.6 real-time status + approval, T9.7 scheduler integration, T9.8 6 preset templates, T9.9 chat intent detection + SuggestionCard (workflow + schedule). 7 step types: agent/tool/browser/parallel/branch/loop/approval. 258 Rust tests. Tab-switch run persistence. See `docs/phases/phase-9-workflow.md`. |
| 10    | Browser Automation    | Stagehand + Playwright + Cookie profiles + LLM config UI | ~3 days   | **Shipped** (2026-04-26). T10.1 `@browserbasehq/stagehand` v3.2.1 + `browser-runner.cjs`, T10.2 Rust browser step + subprocess executor, T10.3 frontend 🌐 node (cyan), T10.4 3 browser templates (Douyin/JD+Taobao/UPS). Cookie persistence via `browser_profile` field (`~/.hermes/browser-profiles/`). Settings page: Browser LLM config (model/API key/base URL). 258 Rust tests. |
| 11    | Polish                | MCP probe + Skill Hub cards + Vision detect + Thumbnail cache + Storybook | ~1 day    | **Shipped** (2026-04-26). T11.1 MCP reachability probe (URL HEAD / stdio `which`), T11.2 Skill Hub structured card grid, T11.3 conversational scheduler (already existed), T11.4 Vision capability auto-detect (`/v1/models`), T11.5 attachment thumbnail cache (`~/.hermes/cache/thumbnails/`), T11.6 Storybook (8 component stories). 258 Rust tests. |
| 12    | File Intelligence     | File content extraction + non-vision model protection + NVIDIA NIM | ~1 day    | **Shipped** (2026-04-26). T12.1 Non-vision model protection (`ChatTurn.model_supports_vision`, images degrade to text when model can't see). T12.2 File content extraction: plain text direct read, Word `.docx` ZIP+XML parse, Excel `.xlsx` shared strings, **PDF via `lopdf`** (literal + hex text tokens, 50KB auto-truncate). NVIDIA NIM provider template (GLM-5.1 / DeepSeek V3.2 / MiniMax M2.7). 258 Rust tests. |

Total ~11–12 weeks solo from Phase 0 through Phase 8, sequential (trimmed 2026-04-23 pm after the product audit reclassified large swathes of Phase 6/7 as SURFACE or DROP). Reclaimed ~3 weeks should go to polishing KEEP features, documentation, and user acquisition — not more features.

## Post-Phase-12: Structural refactoring (2026-04-26 evening)

Quality review (`docs/current-feature-quality-review-2026-04-26.md`) identified `chat/index.tsx` as the #1 refactoring priority. In progress:

| Target | Status | Detail |
|--------|--------|--------|
| `useChatIntentSuggestions` hook | ✅ Done | scheduler + workflow intent detection + suggestion management |
| `usePostSendEffects` hook | ✅ Done | token usage, title gen, learning, skill pattern |
| `ChatHelpers.tsx` | ✅ Done | HeaderActions, EmptyHero, RoutingHint components |
| `formatBytes.ts` | ✅ Done | utility function |
| `enrichHistory.ts` | ✅ Done | context enrichment (TF-IDF, RAG, KB, learnings, user profile) |
| `useStreamCallbacks` | ✅ Done | shared stream callbacks factory (onDelta/onReasoning/onTool/onDone/onError) |
| `resolveAdapterId` + `toDto` | ✅ Done | adapter priority resolution + message-to-DTO conversion |
| Settings: `AppearanceSection` | ✅ Done | theme + language section |
| Settings: `HermesInstancesSection` | ✅ Done | 714-line section + card + row components |
| Settings: `shared.tsx` | ✅ Done | Section + Field reusable components |
| Workflow Rust: `workflow_intent.rs` | ✅ Done | intent detection + keyword matching |
| Workflow Rust: `browser_config.rs` | ✅ Done | browser runner discovery + config IPC |
| E2E fix: sandbox-scopes | ✅ Done | native select `selectOption` + missing testid |

**chat/index.tsx**: 1522 → 979 lines (**-35.7%**), 8 new files extracted.
**settings/index.tsx**: 2298 → 1451 lines (**-36.8%**), 4 new files extracted.
**workflow.rs**: 453 → 299 lines (**-34%**), 2 new files extracted.

### Round 2 — P0/P1 large-file split (2026-04-26 evening, OP-031..034)

Driven by `docs/current-feature-quality-review-2026-04-26.md`'s top-5
list. Both Rust and TS sides split by domain; every public path was
preserved via `pub use` / barrel re-exports so zero callers needed to
change. CI matrix is unchanged — `cargo test --lib`, `clippy
--all-targets -D warnings`, `cargo fmt --check`, `pnpm typecheck /
lint / test / check:bundle-size` all stay green; new files are picked
up automatically.

| Target | Before | After | New files | Verified |
|---|---:|---:|---|---|
| `src-tauri/src/db.rs` | **2199** | split | `db/{mod,migrations,sessions,messages,analytics,runbooks,budgets,skills_history,knowledge}.rs` | 262/262 cargo, clippy 0 |
| `src/features/settings/index.tsx` | **1480** | **416** | `sections/{Workspace,RoutingRules,SandboxScopes,BrowserLLM,Storage}Section.tsx`, `styles.ts` | typecheck/lint/vitest |
| `src-tauri/src/sandbox/mod.rs` | **1125** | **71** | `sandbox/{types,denylist,authority}.rs` | 262/262 cargo, clippy 0 |
| `src/features/profiles/index.tsx` | **1122** | **520** | `{ProfileCard,ImportModal,ActivateModal}.tsx`, `{types,helpers,styles}.ts` | typecheck/lint/vitest |

### Round 3 — P2 large-file split (2026-04-26 evening, OP-036..038)

Continued the same pattern on the next tier of warning files. Same
zero-caller-impact contract via barrel + `pub use` re-exports (Rust
`#[tauri::command]` paths are the one exception — `lib.rs`'s
`invoke_handler!` had to switch from `ipc::voice::voice_record` to
`ipc::voice::recorder::voice_record` since Tauri's `__cmd__` helper
doesn't follow re-exports).

| Target | Before | After | New files | Verified |
|---|---:|---:|---|---|
| `src/features/models/index.tsx` | **935** | **413** | `{providerCatalog,styles,types}.ts`, `{shared,RestartBanner,ApiKeyPanel}.tsx` | typecheck/lint/vitest |
| `src/features/mcp/index.tsx` | **868** | **252** | `{transport,templates}.ts`, `{ServerRow,ServerForm}.tsx` | typecheck/lint/vitest |
| `src-tauri/src/ipc/voice.rs` | **850** | **`voice/`** | `voice/{mod,provider,recorder}.rs` | 262/262 cargo, clippy 0 |

### Round 4 — final pass on remaining warns (2026-04-26 evening, OP-039)

Mixed strategy: Rust files split tests via `#[cfg(test)] #[path = "..."] mod tests;`
(less invasive than converting to a directory module), TS files split
by component. After this round only one file remains over the 800-line
warn threshold: `src/features/chat/index.tsx` (1003 lines), which needs
state-machine refactoring rather than mechanical file extraction.

| Target | Before | After | Extracted | Verified |
|---|---:|---:|---|---|
| `src-tauri/src/sandbox/authority.rs` | **824** | **561** | `authority_tests.rs` (268, via `#[path]`) | 262/262 cargo, clippy 0 |
| `src-tauri/src/hermes_config.rs` | **993** | **747** | `hermes_config_tests.rs` (250, via `#[path]`) | 262/262 cargo, clippy 0 |
| `src-tauri/src/adapters/hermes/mod.rs` | **861** | **614** | `mod_tests.rs` (252, via `#[path]`) | 262/262 cargo, clippy 0 |
| `src/features/models/LlmProfilesSection.tsx` | **816** | **215** | `{LlmProfileCard,LlmProfileRow}.tsx` | typecheck/lint/vitest |

## Strategic positioning (reaffirmed 2026-04-23)

Corey stays on the **Control Plane** axis per `00-vision.md`. After a
brainstorm that surfaced 8 expansion directions (multi-agent,
routing, self-evolution, harness engineering, video, voice, digital
human, openclaw), we explicitly **reject** the following as
out-of-scope and not-to-be-revisited without a product-direction
pivot:

- **AI digital human / avatar** — conflicts with the developer-tool
  positioning; every major competitor in this space (HeyGen, D-ID,
  Character.ai) has 10× our team size and is purely consumer-facing.
  Belongs to a separate product, not Corey.
- **Self-rewriting prompts / meta-optimisation (4.3 from the original
  brainstorm)** — research-frontier territory (DSPy, TextGrad). Not a
  product feature yet.
- **Self-built task DAG framework (5.1 from the original brainstorm)** —
  LangGraph, CrewAI, AutoGen exist and are funded. We adapt one as an
  adapter in Phase 7, not reinvent.
- **Desktop-side video processing (6 from the original brainstorm)** —
  Tauri bundle blow-up from ffmpeg. Any video feature surfaces Hermes
  backend capability in the UI, never processes video locally.
- **Always-on voice wake word (7.1)** — trust/battery cost too high for
  a developer tool. Push-to-talk only in Phase 8 (if Phase 8 runs).

See `docs/06-backlog.md` § Will not do for rationale per item.

## Milestones

- **M0** (end of Phase 0): running desktop binary that opens the shell, shows a fake chat, has ⌘K working, passes CI.
- **M1** (end of Phase 1): can replace the Hermes TUI for everyday chat; usable by a non-dev.
- **M2** (end of Phase 3): feature-parity with `EKKOLearnAI/hermes-web-ui`.
- **M3** (end of Phase 4): at least one feature is best-in-class in the ecosystem; ready for public release.
- **M4** (end of Phase 5): "universal agent console" claim is defensible.

## Cross-cutting tracks (run throughout)

- **Design quality** — every merged PR touches ≥ 1 Storybook story; screenshots in review.
- **Performance** — a perf bench runs nightly; regressions > 10% block release.
- **Accessibility** — `axe` + manual keyboard pass for each feature before Phase completion.
- **i18n** — every string in the locale file from day 1; no hard-coded copy.
- **Docs** — each feature ships with a user-facing doc in `docs/user/`.

## Risk register

| Risk                                                 | Likelihood | Impact | Mitigation                                                |
|------------------------------------------------------|------------|--------|-----------------------------------------------------------|
| Hermes SSE extension fields change shape             | Med        | High   | Isolate in `adapters/hermes/gateway.rs`, recorded fixtures|
| CLI `--json` output changes across versions          | Med        | Med    | Pin min version, add version-gated parsers                |
| Tauri 2 updater signing complexity on Windows/macOS  | High       | Med    | Spike in Phase 0; document in `07-release.md`             |
| WeChat QR flow breaks (Tencent iLink)                | Med        | Low    | Behind a feature flag; graceful degrade                   |
| Bundle size creep                                    | High       | Low    | CI size budget; Rollup visualizer check on each PR        |

## Phase files

See `docs/phases/`:

- `phase-0-foundation.md`
- `phase-1-chat.md`
- `phase-2-config.md`
- `phase-3-channels.md`
- `phase-4-differentiators.md`
- `phase-5-multi-agent.md`
- `phase-6-orchestration.md`
- `phase-7-expansion.md`
- `phase-7.5-multi-agent.md`
- `phase-8-optional.md`
- `phase-9-workflow.md`

Each phase file contains: goals, task breakdown (with owner/effort), file-level outputs, acceptance criteria, test plan, demo script.
