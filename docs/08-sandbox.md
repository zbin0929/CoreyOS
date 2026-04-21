# Path sandbox (TRAE-style workspace roots)

**Status**: Phase 0 ships plumbing (types, `PathAuthority`, `sandbox::fs`, denylist). Interactive consent UI + persistence land in Phase 2 Settings.

**Last updated**: 2026-04-21.

## Verified behavior (2026-04-21)

Unit tests in `src-tauri/src/sandbox/mod.rs` — 3/3 green on macOS arm64:

- `empty_roots_phase0_allows` — Phase 0 dev-mode allow when no roots configured.
- `denylist_wins_over_roots` — `~/.ssh` blocked even when `$HOME` is a root.
- `outside_root_requires_consent` — `/` with `/tmp` as sole root requires consent.

### Bugs caught and fixed during Phase 0 self-check

1. **Denylist missed the directory itself.** The `.ssh/` rule with `starts_with(".ssh/")` matched `~/.ssh/id_rsa` but not `~/.ssh` itself (no trailing separator after canonicalization). Fix: match both `canonical == dir` and `canonical.starts_with(dir)`.
2. **Mixed path separators on Windows.** `format!("{home}/{rel}")` produced `C:\Users\zbin/.ssh` — mixed `\` and `/` — on Windows. Fix: use `PathBuf::join` which is platform-native.
3. **String prefix false positives.** `.sshfoo/` would have matched `.ssh/` as a string prefix. Fix: use `Path::starts_with` (path-segment comparison) instead of `str::starts_with`.

## Known platform gaps (deferred to Phase 0.5)

### Windows

- `std::fs::canonicalize` on Windows returns verbatim paths with `\\?\` prefix. The hard denylist entries like `C:\Windows\System32\` will **not** match canonicalized paths. Fix: add `dunce = "1"` under `[target.'cfg(windows)']` and normalize canonical paths through `dunce::simplified()` before comparison.
- No Windows CI runner yet, so all Windows behavior is inferred.
- No `#[cfg(windows)]` unit tests.

### Linux

- Denylist covers `/etc/sudoers`, `/etc/shadow`, `/proc/`, `/sys/`, `/boot/`, `/root/` — reasonable but not exhaustive (e.g. `/var/lib/docker/`, `/etc/kubernetes/` missing).
- No Linux CI runner yet.

### macOS

- Filesystem case-insensitivity: `/Users/zbin/.SSH/id_rsa` — `canonicalize` normalizes casing to whatever is on disk, so this mostly works, but there's no explicit test for case handling.

## Goals

1. Caduceus's Rust-side fs operations (IPC commands) can only touch paths inside user-approved **workspace roots**, with a hard **denylist** that wins unconditionally.
2. Cross-boundary access triggers an in-app consent prompt (Phase 2). User picks: *Just this once* / *Add to workspace* / *Deny*.
3. Business code cannot bypass the sandbox. All disk I/O must flow through `sandbox::fs::*`; `use std::fs` / `use tokio::fs` is banned outside the sandbox module.
4. Canonicalization defeats `..` traversal and symlink escapes.

## Non-goals

- Sandboxing the **agent** (Hermes / Claude Code / Aider). That happens inside each agent's runtime, not Caduceus's. Caduceus can only surface whatever sandboxing the agent already exposes (see Phase 5 adapter capability matrix).
- Seccomp / syscall-level confinement of Rust process itself. Out of scope.
- Network sandboxing. Separate concern, future doc.

## Model

```
PathAuthority
  ├─ roots:          Vec<WorkspaceRoot>     (persisted; user-managed)
  ├─ session_grants: HashSet<PathBuf>       (per-process, volatile)
  └─ hard denylist:  &'static [...]         (compile-time, platform-specific)

WorkspaceRoot { path, label, mode: Read | ReadWrite }
AccessOp      = Read | Write | List | Execute
Decision      = Allow | ConsentRequired(RequestId) | Denied(reason)
```

### Check algorithm

```
check(path, op) →
  canonical = canonicalize_or_parent(path)
  if denylist_hits(canonical):   Deny
  if session_grants.contains(canonical):  Allow
  if any root is prefix(canonical):
    if root.mode == Read and op == Write:  Deny (read-only)
    else Allow
  if roots empty:  Allow (dev mode, Phase 0 only)
  else:  ConsentRequired
```

## Denylist

Platform-specific absolute prefixes (macOS/Linux/Windows) plus `$HOME`-relative credential paths. Entries at `src-tauri/src/sandbox/mod.rs` `hard_denylist()` / `home_relative_denylist()`.

Current (macOS): `/etc/sudoers`, `/etc/shadow`, `/System/`, `/Library/Keychains/`, `/private/var/root/`, `$HOME/.ssh/`, `$HOME/.aws/credentials`, `$HOME/.kube/config`, `$HOME/.gnupg/`, `$HOME/.docker/config.json`, `$HOME/.netrc`.

Denylist matching occurs **after** canonicalization, so symlinks like `$HOME/shortcut → ~/.ssh/id_rsa` are blocked.

## Phase rollout

| Phase | Behavior |
|-------|----------|
| 0 (now) | Plumbing live. `home_stats` demo goes through sandbox. Roots empty → dev-allow. Denylist enforced. |
| 2 | Settings → Workspace UI: add/remove roots with native folder picker. Persist to `$APPCONFIG/caduceus/sandbox.json`. Consent dialog component. IPC event `sandbox:consent_requested` triggers modal. Once a user sets at least one root, mode flips from `dev-allow` to `enforced` and the Home page badge turns gold. |
| 4 | Skill editor, attachment picker, trajectory export — all gated. |
| 5 | Multi-agent adapter matrix: surface each agent's own sandboxing capability (`agent.sandbox.roots`, `agent.sandbox.consent_mode`) in Settings so users understand what Caduceus controls vs what the agent controls. |

## IPC surface (Phase 2)

```
sandbox_get_state()                           → SandboxState { roots, mode }
sandbox_add_root(path, label, mode)           → WorkspaceRoot
sandbox_remove_root(path)                     → ()
sandbox_decide(request_id, decision)          → ()    // Allow | GrantOnce | AddAsRoot | Deny
sandbox_pending_requests()                    → Vec<ConsentRequest>
```

Event:

```
"sandbox:consent_requested" → { request_id, path, op, caller_hint }
```

## Persistence

`$APPCONFIG/caduceus/sandbox.json`:

```json
{
  "version": 1,
  "roots": [
    { "path": "/Users/zbin/.hermes", "label": "Hermes config", "mode": "read_write" }
  ]
}
```

Session grants are never persisted.

## Code hygiene

- `sandbox::fs` is the only module allowed to `use std::fs` / `use tokio::fs`.
- CI grep check (future): `rg -l 'use (std|tokio)::fs' src-tauri/src --glob '!src-tauri/src/sandbox/**'` must be empty.
- All new IPC commands take `State<'_, AppState>` and call `state.authority` via `sandbox::fs::*`.

## Tests

Phase 0 ships three unit tests in `sandbox/mod.rs`:

- `empty_roots_phase0_allows` — dev mode.
- `denylist_wins_over_roots` — `~/.ssh` blocked even if `$HOME` is a root.
- `outside_root_requires_consent` — `/` vs `/tmp` root.

Phase 2 will add:

- Canonicalization of `..` traversal.
- Symlink escape blocked.
- Read-only root rejects writes.
- Consent request → decision → resume roundtrip.

## Open questions

- **Granularity of consent**: per-file, per-directory-subtree, per-session? Proposal: file-level prompt, with *Add to workspace* escalating the chosen ancestor.
- **Sticky consent**: should *Just this once* upgrade to *Always* after N prompts of the same path? Probably no — explicit only.
- **Workspace profiles**: do different profiles (Phase 2) get different roots? Yes; `sandbox.json` is profile-scoped.
