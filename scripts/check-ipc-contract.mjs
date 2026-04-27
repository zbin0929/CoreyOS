#!/usr/bin/env node
/**
 * IPC contract drift gate.
 *
 * `src/lib/ipc.ts` is a hand-written TypeScript mirror of every Rust
 * `#[tauri::command]` function. The 2026-04 audit (`docs/phases/c4-ipc-type-safety.md`)
 * concluded that maintaining the mirror by hand is cheaper than
 * introducing tauri-specta — but only as long as someone notices when
 * the two sides drift apart. This script is that someone.
 *
 * Three sets are computed:
 * - **R** — every Rust function annotated with `#[tauri::command]`
 *   under `src-tauri/src/ipc/**`.
 * - **L** — every command name registered in `lib.rs`'s
 *   `invoke_handler!` list.
 * - **T** — every command name passed to `invoke('<name>', …)` in
 *   `src/lib/ipc.ts` (snake_case, matches Tauri's wire format).
 *
 * Failure modes (any one fails CI):
 *   1. **T \ L** — frontend calls a command that isn't registered →
 *      runtime "command not found" error in production.
 *   2. **L \ R** — `lib.rs` registers a name that doesn't exist as a
 *      `#[tauri::command]` → compile error already, but worth catching
 *      in case someone hand-edits `lib.rs` without re-running cargo.
 *   3. **R \ L** — Rust command exists but isn't registered →
 *      dead code; either wire it up or delete the annotation.
 *
 * `R \ T` is reported as INFO (not failure): a Rust command that
 * isn't called from `ipc.ts` might be called from another Rust path,
 * or might be a planned-but-unwired feature.
 *
 * Tunables:
 *   `IPC_CHECK_ALLOW_REG_MISSING_TS=1` — silence "Rust → registered →
 *     not in ipc.ts" warnings, useful while wiring a new command up.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const ROOT = process.cwd();
const RUST_IPC_DIR = resolve(ROOT, 'src-tauri/src/ipc');
const LIB_RS = resolve(ROOT, 'src-tauri/src/lib.rs');
const IPC_TS = resolve(ROOT, 'src/lib/ipc.ts');

/** Walk a directory recursively yielding absolute file paths matching `ext`. */
function* walk(dir, ext) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(abs, ext);
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(ext)) yield abs;
  }
}

/** R: scan src-tauri/src/ipc for `#[tauri::command]` annotations,
 *  capture the function name on the next non-empty, non-attribute line. */
function collectRustCommands() {
  const set = new Set();
  for (const file of walk(RUST_IPC_DIR, '.rs')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*#\[tauri::command\]/.test(lines[i])) continue;
      // The function name follows on the next line, possibly with
      // leading attributes/visibility/async. Skip attribute-only lines.
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (/^\s*#\[/.test(next)) continue;
        const m = next.match(/^\s*pub\s+(?:async\s+)?fn\s+([a-z_0-9]+)/);
        if (m) {
          set.add(m[1]);
        } else if (next.trim()) {
          // Some non-fn token — give up rather than guess wrong.
        }
        break;
      }
    }
  }
  return set;
}

/** L: scan lib.rs for the `invoke_handler` list. Rough but reliable —
 *  the list is a flat sequence of `ipc::module::name,` entries inside
 *  a `tauri::generate_handler!` invocation.
 *
 *  We isolate the macro body first, then match `ipc::...::name`
 *  inside it. Without this scoping, ANY `crate::ipc::module::fn(...)`
 *  call elsewhere in lib.rs (e.g. helper invocations from the boot
 *  rehydrate path) would be falsely flagged as a registered handler. */
function collectLibRsRegistered() {
  const set = new Set();
  const src = readFileSync(LIB_RS, 'utf8');
  // Find `tauri::generate_handler!` and grab everything between
  // its opening `[` and matching closing `]`. The body is the only
  // place handler names live — outside it, similar-shaped paths
  // are just regular function calls.
  const macroIdx = src.search(/tauri::generate_handler!\s*\[/);
  if (macroIdx < 0) return set;
  const startBracket = src.indexOf('[', macroIdx);
  let depth = 0;
  let endBracket = -1;
  for (let i = startBracket; i < src.length; i++) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        endBracket = i;
        break;
      }
    }
  }
  if (endBracket < 0) return set;
  const body = src.slice(startBracket + 1, endBracket);
  const re = /\bipc::(?:[a-z_0-9]+::)+([a-z_0-9]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) set.add(m[1]);
  return set;
}

/** T: scan ipc.ts for `invoke<...>('command_name', ...)` calls. */
function collectTsInvokes() {
  const set = new Set();
  const src = readFileSync(IPC_TS, 'utf8');
  const re = /\binvoke(?:<[^>]+>)?\s*\(\s*['"`]([a-z_0-9]+)['"`]/g;
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return set;
}

const R = collectRustCommands();
const L = collectLibRsRegistered();
const T = collectTsInvokes();

const sortJoin = (set) => [...set].sort().join('\n  ');

console.log(
  `[ipc-contract] Rust commands: ${R.size} · lib.rs registered: ${L.size} · ipc.ts invokes: ${T.size}`,
);

const errors = [];

// 1. T \ L — frontend calls a non-registered command.
const tMinusL = [...T].filter((n) => !L.has(n)).sort();
if (tMinusL.length > 0) {
  errors.push(
    `\n❌ ipc.ts invokes commands NOT registered in lib.rs (would 404 at runtime):\n  ${tMinusL.join('\n  ')}`,
  );
}

// 2. L \ R — registered name has no Rust function (would already
//    fail to compile; included for paranoid completeness).
const lMinusR = [...L].filter((n) => !R.has(n)).sort();
if (lMinusR.length > 0) {
  errors.push(
    `\n❌ lib.rs registers names that aren't \`#[tauri::command]\` functions:\n  ${lMinusR.join('\n  ')}`,
  );
}

// 3. R \ L — Rust command exists but isn't registered.
const rMinusL = [...R].filter((n) => !L.has(n)).sort();
if (rMinusL.length > 0) {
  errors.push(
    `\n❌ \`#[tauri::command]\` functions NOT registered in lib.rs (dead handlers):\n  ${rMinusL.join('\n  ')}`,
  );
}

// Info-only: registered + Rust-side, but never called from ipc.ts.
// Could be intentional (Rust→Rust callers, or planned but unwired)
// or could be drift. Print as a hint, not a failure.
const allowRegMissingTs =
  process.env.IPC_CHECK_ALLOW_REG_MISSING_TS === '1';
const rMinusT = [...R].filter((n) => !T.has(n)).sort();
if (rMinusT.length > 0 && !allowRegMissingTs) {
  console.log(
    `\nℹ️  Rust commands registered but not called from ipc.ts (${rMinusT.length}):`,
  );
  console.log(`  ${rMinusT.join('\n  ')}`);
  console.log(
    '\n   These are info-only. If a command is genuinely Rust-only or wired',
  );
  console.log(
    '   via a different path, set IPC_CHECK_ALLOW_REG_MISSING_TS=1 to silence.',
  );
}

if (errors.length > 0) {
  console.error(
    `\n[ipc-contract] ❌ FAIL — ${errors.length} drift issue${errors.length > 1 ? 's' : ''}:`,
  );
  for (const e of errors) console.error(e);
  console.error(
    '\nSee docs/phases/c4-ipc-type-safety.md for the contract policy.',
  );
  process.exit(1);
}

console.log('\n[ipc-contract] ✅ pass');
