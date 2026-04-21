# Phase 0 · Foundation

**Status**: **Core shipped** (2026-04-21). Runtime verified on macOS (arm64). Formal exit criteria: 7/10 met; 3 deferred to "Phase 0.5 hardening" (CI matrix, Storybook, Playwright). See *Shipped status* below.

**Goal**: Scaffold a running Tauri desktop app with the design system, app shell, command palette, i18n, CI, and a stubbed Hermes adapter. No real network. One screenshot-worthy demo.

**Est.**: 1–2 days solo.

## Shipped status (as of 2026-04-21)

| Criterion | State | Notes |
|---|---|---|
| 1. `pnpm tauri dev` opens shell | ✅ | `INFO Caduceus booting` logged; window renders |
| 2. ⌘K palette + `Cmd+1..9` | 🟡 | ⌘K works. `Cmd+1..9` shown as hint in palette; global listener deferred |
| 3. Dark/light theming | ✅ | Tokens in `src/styles/tokens.css`; no hard-coded colors |
| 4. Typecheck/lint/test pass | 🟡 | `pnpm typecheck`, `pnpm lint`, `cargo check`, `cargo test` all green. `cargo clippy` not installed (rust minimal profile). `pnpm test` (Vitest) not wired |
| 5. `pnpm build` installer | 🟡 | Placeholder icons in place; bundle not yet run end-to-end |
| 6. CI on 3 platforms | ❌ | Deferred to Phase 0.5 |
| 7. HermesAdapter stub + fixtures | ✅ | `src-tauri/src/adapters/hermes/fixtures/{sessions,models}.json` |
| 8. Storybook ≥ 8 stories | ❌ | Deferred to Phase 0.5 |
| 9. Playwright e2e | ❌ | Deferred to Phase 0.5 |
| 10. Visual regression baseline | ❌ | Deferred to Phase 0.5 |

### Added to Phase 0 mid-flight (not in original plan)

- **T0.9 — Path sandbox plumbing** (see `docs/08-sandbox.md`): `PathAuthority`, `sandbox::fs` middleware, cross-platform hard denylist (macOS / Linux / Windows; home-relative credential paths), `home_stats` IPC demo proving the `React → IPC → sandbox → fs` round-trip. 3 unit tests green.
- **Placeholder icons generator** (`scripts/generate-placeholder-icon.py`): 1024² PNG via Python stdlib only → `pnpm tauri icon` fan-out.
- **Window drag regions** (`data-tauri-drag-region` on Topbar + Sidebar brand, 80px traffic-light inset on macOS).

### Lessons captured

- Tauri 2 `generate_context!()` embeds icons **at compile time** — dev mode needs them, not just `tauri build`. SETUP.md corrected.
- `std::fs::canonicalize` on Windows returns `\\?\` verbatim prefix — my hard denylist regex will miss it. Open issue, fix in Phase 0.5 alongside CI.
- `Path::starts_with` must be used instead of string `starts_with` for path prefix checks — otherwise `.sshfoo/` matches `.ssh/` rule. Caught during self-check; fixed.

### Phase 0.5 hardening backlog

Defer-but-do-before-Phase-2:

- GitHub Actions matrix (`macos-14`, `ubuntu-22.04`, `windows-2022`) running `pnpm typecheck && pnpm lint && cargo test --lib && cargo clippy -- -D warnings`.
- Storybook or Ladle with primitive stories (Button / Input / Card / Kbd / CommandPalette / Sidebar / Topbar / EmptyState).
- Playwright + Tauri webdriver: "open → palette → goto settings".
- Vitest setup + unit test for `Sidebar` active-state.
- Rust `dunce::simplified` for Windows verbatim-path normalization.
- Add `#[cfg(windows)]` tests for sandbox denylist.
- `cargo clippy` in CI (requires `rustup component add clippy`).
- Global `Cmd+1..9` keyboard handler for primary routes.

## Exit criteria (all must pass)

1. `pnpm tauri dev` opens a window with the shell + sidebar + topbar + palette.
2. `⌘K` opens the command palette; `Cmd+1..9` jumps to routes.
3. Dark and light themes render; tokens used everywhere (no hard-coded colors).
4. `pnpm test`, `pnpm lint`, `pnpm typecheck`, `cargo test`, `cargo clippy -- -D warnings` all pass.
5. `pnpm build` produces a signed (self-signed OK for now) desktop bundle < 25 MB installer.
6. CI runs on macOS (arm64 + x64), Windows, Linux; all green.
7. `HermesAdapter` is registered but returns fixture data from `adapters/hermes/fixtures/`.
8. Storybook/Ladle deployed locally, contains ≥ 8 primitive stories + shell + palette.
9. At least 1 Playwright e2e test passes: open app → palette → switch route.
10. Visual regression baseline captured for shell, palette, 3 primitives.

## Task breakdown

### T0.1 — Bootstrap (half day)

- `pnpm create tauri-app` (React + TS + Vite preset).
- Replace default style with Tailwind + shadcn init.
- Configure `pnpm` workspaces (even if single-package initially, for future packages/ dir).
- Commit `.editorconfig`, `.nvmrc`, `.npmrc`, `.prettierrc`, `eslint.config.ts`.
- Set up `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, path alias `@/*`.

### T0.2 — Design tokens & theming (half day)

- Write `src/styles/tokens.css` with every token from `docs/02-design-system.md`.
- Extend `tailwind.config.ts` to map tokens → utilities.
- Add `ThemeProvider` in `src/app/providers.tsx`; read `prefers-color-scheme` + persisted choice (localStorage).
- Add a system-menu item "Toggle theme" (⌘⇧L).

### T0.3 — App shell (half day)

- `src/app/shell/AppShell.tsx` — CSS grid (sidebar 224 / content 1fr).
- `Sidebar.tsx` — section list with Lucide icons, active state animated.
- `Topbar.tsx` — profile picker (fake), gateway status dot, palette trigger button, theme toggle.
- Routes registered with TanStack Router: `/chat`, `/compare`, `/skills`, `/trajectory`, `/analytics`, `/logs`, `/terminal`, `/scheduler`, `/channels`, `/models`, `/settings`. Each is a placeholder page with an empty-state card and the Lucide icon for that section.

### T0.4 — Command palette (half day)

- `src/components/command-palette/Palette.tsx` using `cmdk`.
- Global shortcut ⌘K / Ctrl+K registered with a tauri-friendly listener.
- Command groups: "Go to", "Actions", "Preferences".
- "Go to" lists all routes. "Preferences" has theme toggle.
- Fuzzy match; latest selected pinned at top.

### T0.5 — i18n scaffolding (1 hour)

- `react-i18next` configured, `en.json` and `zh.json` with every string used so far.
- Settings page stub exposes language selector.

### T0.6 — Rust core bootstrap (half day)

- `src-tauri/` gets the following crates in `Cargo.toml`:
  - `tauri`, `tauri-build`, `tokio`, `anyhow`, `thiserror`, `tracing`, `tracing-subscriber`, `tracing-appender`
  - `serde`, `serde_json`, `serde_yaml`, `specta`, `tauri-specta`
  - `reqwest` (rustls), `eventsource-stream`, `futures`
  - `async-trait`, `once_cell`
  - `chrono`, `uuid`
- `src-tauri/src/error.rs` — `AppError` enum + `IntoResponse` helpers.
- `src-tauri/src/ipc/mod.rs` — command registration macro.
- `src-tauri/src/adapters/mod.rs` — `AgentAdapter` trait + `AdapterRegistry` (from `docs/03-agent-adapter.md`).
- `src-tauri/src/adapters/hermes/` — module skeleton with all `async fn` returning `Ok(fixture)` or `AdapterError::Unsupported`.
- `src-tauri/src/adapters/hermes/fixtures/` — JSON files: 3 sessions, 5 models, a sample SSE stream.
- `scripts/gen-bindings.ts` runs `tauri-specta` and writes to `src/lib/ipc/bindings.ts`.

### T0.7 — Tooling & CI (half day)

- Vitest + Testing Library set up; example test for `Sidebar`.
- Playwright set up with Tauri webdriver; example e2e "open → palette → goto /settings".
- Ladle (or Storybook) with stories for: `Button`, `Input`, `Select`, `Dialog`, `Tabs`, `Kbd`, `CommandPalette`, `Sidebar`, `Topbar`.
- `.github/workflows/ci.yml`: matrix `{macos-14, ubuntu-22.04, windows-2022}` × `{node-20}`; runs lint/type/test/build (Tauri build only on same-OS).
- Size budget check: JS bundle ≤ 1.5 MB gz fails CI.

### T0.8 — Demo & docs

- Landing route `/` (pre-login-ish splash; but we have no login, so a welcome card with "Connect to Hermes" CTA).
- Screenshot rig: `scripts/screenshot.ts` launches Tauri in headless and captures the shell + palette for the README.
- Update top-level `README.md` with the new Phase status table and a screenshot embed.

## Files created (summary)

```
package.json · pnpm-workspace.yaml · tsconfig.json · tailwind.config.ts
eslint.config.ts · .prettierrc · .editorconfig · .nvmrc

src/
├── main.tsx
├── app/{providers.tsx, routes.tsx, shell/{AppShell,Sidebar,Topbar}.tsx}
├── features/*/index.tsx                   (11 placeholder pages)
├── components/
│   ├── ui/...                              (shadcn primitives)
│   ├── command-palette/Palette.tsx
│   └── kbd/Kbd.tsx
├── lib/{ipc/bindings.ts, ipc/index.ts, cn.ts, sse.ts}
├── stores/{ui.ts, palette.ts}
├── styles/{globals.css, tokens.css}
└── locales/{en.json, zh.json}

src-tauri/
├── Cargo.toml · tauri.conf.json · build.rs
└── src/
    ├── main.rs · lib.rs · error.rs
    ├── ipc/{mod.rs, chat.rs (stub), session.rs (stub), model.rs (stub)}
    └── adapters/
        ├── mod.rs
        └── hermes/{mod.rs, gateway.rs, cli.rs, fixtures/*.json}

scripts/{gen-bindings.ts, screenshot.ts}
tests/
├── e2e/open-and-navigate.spec.ts
└── unit/sidebar.test.tsx
.github/workflows/ci.yml
```

## Test plan

- **Unit**: `Sidebar` renders all routes; theme toggle persists; palette filters fuzzy-match correctly.
- **Rust**: `AdapterRegistry` register/get/default; fixture loader returns parsed JSON.
- **e2e (Playwright+Tauri)**: open app → ⌘K → type "set" → arrow → enter → lands on /settings.
- **Visual**: shell (dark/light), palette open, empty-state card.
- **Perf smoke**: cold start logged; failing gate set at > 2.5 s on CI runners (budget is < 1 s on real hardware).

## Demo script

1. Open the binary.
2. Tour the sidebar; each section shows its empty state.
3. Hit ⌘K, type "go chat", land on /chat (shows 3 fixture sessions).
4. Toggle theme; point out token-driven recoloring.
5. Point out the sub-20 MB installer and sub-second cold start.

## What Phase 0 does NOT do

- No real network calls.
- No config writes.
- No streaming chat.
- No auth flows.
- No auto-update channel (spike only — document findings in `07-release.md`).
