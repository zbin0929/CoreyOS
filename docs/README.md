# CoreyOS Documentation

Top-level entry for the CoreyOS docs tree. If you're new here, start in
**Orient yourself** below — the rest of the tree is reference material.

> Looking for a complete inventory with last-verified dates? See
> [`document-index.md`](./document-index.md).

---

## Orient yourself

Read these in order:

1. [`00-vision.md`](./00-vision.md) — *what* CoreyOS is and *who* it's for.
2. [`01-architecture.md`](./01-architecture.md) — Tauri + React layout, Rust
   crate structure, IPC contract, persistence layout. The single most
   useful map of the codebase.
3. [`05-roadmap.md`](./05-roadmap.md) — what's shipped, what's next, and
   the phases that got us here. Updated more often than the others.
4. [`glossary.md`](./glossary.md) — terminology you'll see in code
   comments and docs (Hermes, Caduceus, profile, instance, …).

After that, dip into the topical docs as the work demands.

## Topical docs (mostly current-state references)

| Doc | When you need it |
|-----|------------------|
| [`02-design-system.md`](./02-design-system.md) | Tailwind tokens, component patterns, motion |
| [`03-agent-adapter.md`](./03-agent-adapter.md) | Adding a new LLM adapter or agent type |
| [`04-hermes-integration.md`](./04-hermes-integration.md) | How CoreyOS embeds the Hermes CLI |
| [`08-sandbox.md`](./08-sandbox.md) | Path authority + sandbox semantics |
| [`09-conversational-scheduler.md`](./09-conversational-scheduler.md) | Scheduler design |
| [`06-testing.md`](./06-testing.md) | Test strategy + how to run each suite |
| [`07-release.md`](./07-release.md) | Cutting a release |
| [`icon-audit.md`](./icon-audit.md), [`logo.md`](./logo.md) | Brand assets |

## Planning + state-of-the-product

| Doc | Purpose |
|-----|---------|
| [`06-backlog.md`](./06-backlog.md) | Feature backlog |
| [`optimization-backlog.md`](./optimization-backlog.md) | Prioritized UX / platform improvements |
| [`10-product-audit-2026-04-23.md`](./10-product-audit-2026-04-23.md) | Last full product audit |
| [`current-feature-quality-review-2026-04-26.md`](./current-feature-quality-review-2026-04-26.md) | Most recent code-quality review |
| [`hermes-reality-check-2026-04-23.md`](./hermes-reality-check-2026-04-23.md) | What Hermes integration actually does today |

## Subdirectories

- [`phases/`](./phases) — historical phase plans (Phase 0 through Phase E
  + ad-hoc tracks like `c4-ipc-type-safety`). All marked **Shipped** in
  `05-roadmap.md`. **Read these only when you need context for *why*
  something exists** — they're not maintained as live references.
- [`agent/`](./agent) — internal analyst notes from the AI agents
  helping maintain the project. The change-log style file
  [`agent/00-操作日志.md`](./agent/00-操作日志.md) is appended to as a
  rolling journal.
- [`user/`](./user) — end-user documentation (currently a Chinese
  user manual at [`user/用户手册.md`](./user/用户手册.md)).

## Conventions

- **plan** docs describe intent. **current** docs describe the system as
  it actually is. **changelog** docs are dated records. The full mapping
  per file lives in [`document-index.md`](./document-index.md).
- When you ship a non-trivial change, update both:
  1. The relevant **current** doc (so it stays accurate), and
  2. `05-roadmap.md` if it crosses a phase boundary.
- New phase plans go under `phases/`, never into a sibling docs root.
  Once a phase ships, mark it "Shipped" in the roadmap and let the
  phase doc fall out of active rotation.

## See also

- Repo `README.md` (project root) — install + quickstart for end users.
- `CHANGELOG.md` (project root) — dated log of shipped milestones.
