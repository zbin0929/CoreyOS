# CoreyOS Project Rules

This file defines development constraints and evolution rules for the CoreyOS project.
All contributors (human and AI) must follow these rules.

## Architecture Constraints

### AC-1: No logic dumping in core pages
Core page files (chat/index.tsx, settings/index.tsx, workflow/index.tsx) must stay under 500 lines.
If a page grows beyond this, extract concerns into dedicated hooks or components BEFORE adding new features.

Threshold guide:
- < 300 lines: healthy
- 300-500 lines: monitor, consider extraction
- > 500 lines: MUST refactor before adding features

### AC-2: New capabilities land in service/hook first
When adding a new feature:
1. Create the hook/service file first
2. Write the UI integration second
3. Never inline business logic directly in page components

Pattern: `use[Feature].ts` hook → component → page integration

### AC-3: Cross-frontend-backend features require contract definitions
Any feature that spans TypeScript and Rust must have:
- TypeScript interface in `src/lib/ipc.ts`
- Rust struct with matching field names and types
- Both must use the same JSON serialization format
- Field renames or type changes must update BOTH sides in the same commit

### AC-4: Workflow and browser changes must consider diagnostics
Any change to workflow engine or browser automation must include:
- `tracing::info!` at start/done with duration_ms
- `tracing::warn!` on failure with error context
- Frontend error state that shows actionable recovery

## Code Style

### CS-1: No comments unless asked
Code should be self-documenting through clear naming. Comments are only added when explicitly requested.

### CS-2: Rust formatting
Always run `cargo fmt` before committing Rust changes. The CI enforces rustfmt.

### CS-3: TypeScript strict mode
All TypeScript code must pass `tsc --noEmit` with zero errors. No `any` types unless in test fixtures.

## Testing

### T-1: CI must be green
Every commit must pass all 5 CI jobs:
- Frontend (lint + build)
- Rust macOS
- Rust Ubuntu
- Rust Windows
- E2E (Playwright)

### T-2: New IPC commands need Rust tests
Any new `#[tauri::command]` function must have at least one `#[test]` in the same module.

### T-3: New pages need E2E smoke test
Any new route added to `routes.tsx` must have a corresponding Playwright spec that verifies the page renders.

## Navigation

### N-1: Three-tier sidebar structure
The sidebar uses three tiers:
- **Primary** (always visible): Home, Chat, Workflows, Agents, Models
- **Tools** (always visible): Compare, Analytics, Terminal, Logs
- **More** (collapsible): Skills, Trajectory, Channels, Scheduler, Profiles, Runbooks, Budgets, Memory, Knowledge, Voice, MCP
- **Settings** (bottom-pinned): always accessible

New features should default to the "More" tier unless they are high-frequency.

### N-2: All routes persist
Routes are never removed. Low-frequency items move to "More" tier or Settings sub-sections, but the URL always works.

## Product Direction

### PD-1: Control Plane positioning
CoreyOS is a developer-first AI control plane. We do NOT build:
- AI digital humans / avatars
- Consumer-facing chat products
- Self-rewriting prompt systems

### PD-2: Stable over feature-rich
When in doubt, prioritize stability over new features. A reliable platform with fewer features beats an unreliable one with many.

## Cross-Platform Compatibility

### XP-1: Windows + macOS always
CoreyOS ships on both Windows and macOS. Every feature, fix, and refactor must work on both platforms.

- Rust code: use `#[cfg(target_os = "windows")]` / `#[cfg(not(target_os = "windows"))]` for platform-specific logic
- Shell commands: macOS uses `bash`, Windows uses `powershell` — never hardcode one
- File paths: use `std::path::PathBuf` / `path.join()`, never string concatenation with `/` or `\`
- Environment variables: macOS uses `$HOME`, Windows uses `%USERPROFILE%` — use `dirs` crate or `hermes_data_dir()`
- Process spawning: Windows needs `.creation_flags(CREATE_NO_WINDOW)` for background processes
- CI must pass on all 3 Rust jobs (macOS, Ubuntu, Windows) before merging

### XP-2: Test on both platforms before release
Before tagging a release, manually verify on both:
- macOS: App launches, gateway starts, chat works, updater works
- Windows: App launches, gateway starts, chat works, updater works

## Hermes Agent Dependency

### HD-1: Check upstream first
Before implementing ANY feature, check:
1. Does Hermes Agent already have this feature? (hermes CLI, hermes-agent repo)
2. Can we use it as-is or with minor config?
3. If Hermes has 80% of what we need, extend — don't rebuild.

Decision tree:
- Hermes has it → Use it (config/wrapper only)
- Hermes has 80% → Fork + patch, contribute back if possible
- Hermes doesn't have it → Build ourselves, but design to contribute upstream

### HD-2: Corey = orchestration, Hermes = execution
If `hermes skills install <pack>` already installs a skill pack, we do NOT write our own install logic. We call the CLI.
If `hermes gateway start` already starts the gateway, we do NOT write our own gateway launcher. We call the CLI.
Corey's value: industry customization, white-label delivery, workflow orchestration, IM push — things Hermes doesn't have.

### HD-3: Credential management follows Hermes
Hermes already has ~/.hermes/.env for API keys. Corey does NOT create a parallel credential system. We read/write the same .env file via hermes_config module.

### HD-4: Skill format follows Hermes
Hermes defines skill format: .md files in ~/.hermes/skills/. Corey does NOT invent a new skill format. Skill Packs are collections of Hermes-compatible .md files + manifest.yaml.

### HD-5: Hermes dependency map is the source of truth
Full dependency mapping lives in `docs/hermes-dependency-map.md`. When Hermes updates, consult that document first to locate impacted code. The map covers: CLI commands, Gateway HTTP API, file system dependencies, config.yaml fields, .env variables, MCP/memory/channel integration, and cross-platform differences.

### HD-6: CLI allowlist must stay in sync
Corey's `ipc/skill_hub.rs` maintains an `ALLOWED_SUBCOMMANDS` list. When Hermes adds/renames/removes a `hermes skills` subcommand, update the allowlist in the same commit. Never allow destructive subcommands through the UI.

### HD-7: config.yaml writes are additive only
Corey only adds fields to `~/.hermes/config.yaml`, never removes or renames them. If Hermes deprecates a field, Corey keeps writing it for backward compatibility until the minimum supported Hermes version no longer reads it. Check Hermes config version (currently 17) on each upgrade.

### HD-8: Shared files require atomic writes
Corey writes to `~/.hermes/config.yaml`, `.env`, `cron/jobs.json`, `MEMORY.md`, `USER.md` — all shared with Hermes. Always use `fs_atomic::atomic_write` so Hermes never reads a half-written file. Never change the file format without verifying Hermes still reads it correctly.

### HD-9: Gateway restart is required after config changes
Hermes Gateway does not hot-reload config.yaml. After any write to config.yaml or .env, Corey must call `hermes_gateway_restart()`. The only exception: Hermes supports `/reload-mcp` chat command for MCP-only changes (Corey does not use this yet — still restarts).

### HD-10: Memory files follow Hermes conventions
Corey writes `MEMORY.md` using the `## [auto] <date>` section format and `USER.md` under `~/.hermes/memories/`. These are injected into Hermes' system prompt every session. If Hermes changes the MEMORY.md/USER.md injection format, Corey's `ipc/learning/mod.rs` and `ipc/hermes_memory.rs` must adapt immediately.

## Customization & White-Label

### CW-1: One binary, config-driven
All customers download the same Corey binary. Customization = customer.yaml import at runtime. No build-time branching, no customer-specific builds.

### CW-2: Import and vanish
customer.yaml is imported once on startup, then deleted. Feature flags persisted as binary (.state/features.bin), not YAML. No trace left for users or Hermes Agent to discover.

### CW-3: Data directory is sacred
~/.hermes/ is NEVER touched by app updates. config.yaml migration is additive only (add fields, never remove). User data (skills, workflows, vault, db) survives every update.

## Build Commands

```bash
# Frontend
pnpm build          # Vite production build
npx tsc --noEmit    # TypeScript check
npx eslint src/     # Lint

# Rust
cd src-tauri
cargo check         # Compile check
cargo test --lib    # Run 419 tests
cargo fmt           # Format (required by CI)

# E2E
pnpm exec playwright test  # Run 77 specs

# Full CI simulation
npx tsc --noEmit && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --lib --manifest-path src-tauri/Cargo.toml && pnpm build
```
