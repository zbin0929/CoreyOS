# Base SOUL.md — Source of Truth

This file is the **version-controlled source of truth** for Corey's L1
Base Soul system prompt. It is intentionally bundled with the app
(under `src-tauri/assets/base-soul/SOUL.md`) so that every release
ships a known-good content snapshot.

## Runtime path

Hermes Agent loads slot #1 system prompt from `~/.hermes/SOUL.md`
(via its built-in soul loader). Corey writes / refreshes that file
on startup to match the bundled copy.

> ⚠️ **As of v0.2.11 the bundled-→runtime sync is still manual** —
> developers edit `~/.hermes/SOUL.md` while iterating, then copy the
> stable version back into this directory before committing.
>
> **v0.2.12 plan**: add a `base_soul::reconcile()` on Tauri startup
> (analogous to `pack::seed`) that copies this bundled file into
> `~/.hermes/SOUL.md` when missing, **and offers a merge prompt when
> the user has hand-edited the runtime copy**. Tracked in
> [`docs/status/TODO.md`](../../../docs/status/TODO.md) row 8.

## What lives here

- **L1 Base Soul (meta-operation discipline)**: tool mapping, 3-segment
  decision-handback format, deep-link syntax rules, browser tool
  guardrails, persona-vs-meta-op boundary. Permanent. Survives Pack
  switches.

## What does NOT live here

- **L2 Pack Soul (industry persona)**: lives under each Pack at
  `src-tauri/assets/skill-packs/<pack_id>/prompts/soul.md`. Reconciled
  to `~/.hermes/skill-packs/<pack_id>/prompts/soul.md` via `pack::seed`.
- **L3 User memory** (`~/.hermes/MEMORY.md`): user-owned, never written
  by Corey or Packs.

See [`docs/spec/system-prompt-stack.md`](../../../docs/spec/system-prompt-stack.md)
for the full architectural contract.
