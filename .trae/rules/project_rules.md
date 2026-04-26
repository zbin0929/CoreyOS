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

## Build Commands

```bash
# Frontend
pnpm build          # Vite production build
npx tsc --noEmit    # TypeScript check
npx eslint src/     # Lint

# Rust
cd src-tauri
cargo check         # Compile check
cargo test --lib    # Run 258+ tests
cargo fmt           # Format (required by CI)

# E2E
pnpm exec playwright test  # Run 81 specs

# Full CI simulation
npx tsc --noEmit && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --lib --manifest-path src-tauri/Cargo.toml && pnpm build
```
