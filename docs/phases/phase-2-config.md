# Phase 2 · Config & Ops

**Goal**: Everything the operator needs after chat works. Model management, settings, usage analytics, logs, profiles, gateway control.

**Est.**: ~1 week solo.

**Depends on**: Phase 1.

## Exit criteria

1. Models page: add/update/delete providers, OAuth flow for Codex, per-provider model groups, default model switching. All writes go through atomic `auth.json` ops.
2. Settings page: every setting from `hermes-web-ui` is represented; changes take effect immediately or with explicit "Apply & restart gateway" when necessary; all writes journaled with undo.
3. Analytics page: total tokens (in/out), session count, daily average, cost estimate, cache hit rate, 30-day trend (bar + table), model distribution donut. Data source is the Caduceus-local SQLite (populated from Hermes gateway usage events + session history).
4. Logs page: agent / gateway / error streams, filter by level/file/keyword, live tail with pause, structured parser, search with match highlighting.
5. Profiles page: list, create, rename, delete, clone, import (`.tar.gz`), export; per-profile gateway start/stop with port auto-resolution.
6. Every destructive action shows a diff or confirms; undo via `~/.caduceus/changelog.jsonl`.
7. All pages keyboard-navigable; ⌘K deep-links to any setting.

## Task breakdown

### T2.1 — Config safety layer (half day, reused everywhere)

- `src-tauri/src/fs_atomic.rs`:
  - `atomic_write(path, bytes, perms)`
  - `journal_append(entry)` writing JSONL to `~/.caduceus/changelog.jsonl`
- `src-tauri/src/adapters/hermes/env.rs`, `config.rs`, `auth.rs`:
  - Each exposes `read`, `patch(mutator) -> Diff`, `rollback(entry_id)`.
  - Tests for round-trip preservation of unknown keys, comments, ordering.

### T2.2 — Models page (1–1.5 days)

- `src/features/models/`:
  - `ProvidersList.tsx` — grouped accordion by provider, per-provider "set default model".
  - `ProviderFormDialog.tsx` — add/edit credential; masked on read; never shows raw key after save.
  - `CodexOAuthFlow.tsx` — invoke `auth_codex_start` → opens browser → Rust catches the redirect on `127.0.0.1:<port>` → writes token → emits event.
  - `ModelDiscoveryBadge.tsx` — shows "X models discovered from /v1/models" per provider with a refresh action.
- Rust `ipc/model.rs`:
  - `model_provider_add/update/delete`
  - `model_provider_probe` (ping `/v1/models`)
  - `model_default_set`
  - `auth_codex_start`, `auth_codex_complete`

### T2.3 — Settings page (1 day)

- Sections (mirrors hermes-web-ui, our order): Display, Agent, Memory, Session reset, Privacy, Model, API server, Advanced.
- Each section is a sub-route `/settings/{section}`; palette deep-links (`Settings → Privacy → PII redaction`).
- All fields from react-hook-form + zod; schema colocated with the section.
- "Apply" button dims when no diff; shows diff modal on click for any field that requires a gateway restart.

### T2.4 — Local store (half day)

- `src-tauri/src/store/` with `sqlx` + SQLite at `~/.caduceus/db.sqlite`.
- Tables:
  - `usage(ts, session_id, model, input_tokens, output_tokens, cached_tokens, cost_usd_micro, adapter_id)`
  - `events(ts, level, category, payload_json)`
  - `budgets(id, scope, amount_usd_micro, period, created_at)` (used by Phase 4)
- Ingest: every chat message's `Usage` delta is captured and written in a background task.
- Migrations versioned; `sqlx migrate!()` at startup.

### T2.5 — Analytics page (1 day)

- `src/features/analytics/`:
  - `KpiStrip.tsx` — total tokens, sessions, daily avg, cost estimate, cache hit rate.
  - `DailyTrend.tsx` — Recharts stacked bar 30d (input vs output) with table toggle.
  - `ModelMix.tsx` — donut with legend and percentage.
  - `CostPerSession.tsx` — line chart.
- Time range selector (7d / 30d / custom). Data via `invoke('usage_query', { from, to, group_by })`.
- Keyboard filter bar at top, ⌘F to focus.

### T2.6 — Logs page (half day)

- `src/features/logs/`:
  - `LogStream.tsx` — virtualized; level filter (Debug/Info/Warn/Error), file filter (agent/gateway/error), keyword search with highlight.
  - `LogLine.tsx` — parsed fields color-coded; HTTP lines get special treatment (method + status with color).
  - Pause/resume tail; download filtered slice.
- Rust `ipc/log.rs` + `adapters/hermes/logs.rs` from Phase 0 skeleton → fleshed with `notify` file watcher + ring buffer.

### T2.7 — Profiles page (1 day)

- `src/features/profiles/`:
  - `ProfilesList.tsx` — current active highlighted; actions per row.
  - `ProfileFormDialog.tsx` — create/clone/rename.
  - `ImportDialog.tsx` — drag-drop `.tar.gz`, show manifest, confirm.
  - `ExportAction.tsx` — saves to chosen path.
  - `GatewayControl.tsx` — start/stop/restart per profile with live status + allocated port.
- Rust `ipc/profile.rs` + `adapters/hermes/cli.rs` expanded for `profile *` and `gateway *`.

### T2.8 — Undo & changelog (half day)

- `src/features/settings/Changelog.tsx` — viewer for `~/.caduceus/changelog.jsonl`; each entry has "revert" action.
- Revert invokes the appropriate adapter `rollback`.

## Files added (summary)

```
src-tauri/src/
├── fs_atomic.rs
├── store/{mod.rs, migrations/*.sql, usage.rs, events.rs, budgets.rs}
├── ipc/{model.rs (grown), settings.rs, log.rs, profile.rs, usage.rs}
└── adapters/hermes/{env.rs, config.rs, auth.rs, logs.rs, wechat.rs (stub)}

src/features/
├── models/*
├── settings/{index,sections/*}
├── analytics/*
├── logs/*
└── profiles/*
```

## Test plan

- **Atomic write tests**: kill process mid-write (simulated), verify original file intact.
- **Round-trip tests**: unknown keys/comments/order preserved through `patch`.
- **Journal tests**: every mutation creates exactly one entry; `rollback` restores previous state.
- **e2e**: add provider → probe models → appear in selector; change setting → diff modal → apply → gateway restarts.

## Demo script

1. Models → add OpenRouter key → probe → 200+ models discovered → default set to a free model.
2. Settings → Privacy → PII redaction ON; Apply; gateway restart banner → click; 2 s later green again.
3. Analytics → past 30d; point at model mix donut.
4. Profiles → clone current to "dev"; export; delete; re-import from the exported archive.
5. Logs → filter level=Error; see the earlier PII setting change journaled; click "Revert" → setting flips back.

## What Phase 2 does NOT do

- No platform channel configs (that's Phase 3).
- No multi-model compare, trajectory, budgets-with-alerts (Phase 4).
- No other adapters (Phase 5).
