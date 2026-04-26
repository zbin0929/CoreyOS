//! Path sandboxing — a TRAE-style workspace access control layer.
//!
//! # Responsibilities
//!
//! - Hold a list of user-approved `WorkspaceRoot`s.
//! - Normalize and canonicalize incoming paths.
//! - Reject hard-denied system paths unconditionally.
//! - Decide whether a given (path, op) combination is allowed, requires
//!   user consent, or is blocked.
//!
//! # Mode policy
//!
//! | Mode       | Roots empty | Roots non-empty |
//! |------------|-------------|-----------------|
//! | `DevAllow` | Allow (dev-only default for first-launch convenience) | Allow within roots, consent-required outside |
//! | `Enforced` | Deny everything except denylist + explicit grants | Allow within roots, consent-required outside |
//!
//! Fresh installs start in `DevAllow` so the app isn't crippled on first
//! launch. The moment the user visits Settings > Workspace and adds a root
//! (or explicitly toggles Enforce), the mode flips to `Enforced` and the
//! `sandbox.json` config file is written — from then on every launch loads
//! that file and stays `Enforced`.
//!
//! When `check()` returns `ConsentRequired`, the IPC fails with
//! `SandboxConsentRequired { path }`. The frontend's `ConsentModal` catches
//! this error, asks the user, and either calls `sandbox_grant_once(path)`
//! (one-shot, process-scoped) or `sandbox_add_root(path, mode)` (persisted),
//! then retries the original operation.
//!
//! # Goldens
//!
//! - Symlink escape is blocked by `canonicalize()` + prefix check.
//! - `..` traversal resolves via canonicalize before comparison.
//! - Denylist wins over roots (even if `~/.ssh` is *inside* a root).
//!
//! # Module layout
//!
//! Originally one ~1.1k-line file; split (2026-04-26) into three layers
//! for clarity. All pre-split public items continue to resolve via the
//! `pub use` re-exports below — no caller needed to change imports.
//!
//! - [`types`] — data shapes (`AccessMode`, `WorkspaceRoot`,
//!   `SandboxScope`, `SandboxError`, …) and the `is_valid_scope_id` helper.
//! - [`denylist`] — pure path filtering: hard denylist + home-relative
//!   denylist + the canonicalised lookup helper.
//! - [`authority`] — `PathAuthority` runtime state machine: scopes,
//!   session grants, persistence, and the `check`/`check_scoped` gate
//!   every IPC + adapter goes through.
//! - [`fs`] — sandbox-gated `read_to_string` / `write` helpers that wrap
//!   `tokio::fs` and re-emit errors as `SandboxError`.
//! - [`persistence`] — atomic `sandbox.json` reader + writer with v1→v2
//!   migration.

mod authority;
mod denylist;
mod types;

pub mod fs;
pub mod persistence;

pub use authority::PathAuthority;
// Re-exports preserve the pre-split public surface even where current
// callers only reach for a subset; `#[allow(unused_imports)]` keeps
// clippy quiet without narrowing the API.
#[allow(unused_imports)]
pub use persistence::{sandbox_config_path, SandboxConfig};
#[allow(unused_imports)]
pub use types::{
    is_valid_scope_id, AccessMode, AccessOp, SandboxError, SandboxMode, SandboxResult,
    SandboxScope, WorkspaceRoot, DEFAULT_SCOPE_ID,
};
