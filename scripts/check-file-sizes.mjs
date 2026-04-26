#!/usr/bin/env node
/**
 * File-size gate.
 *
 * Surfaces "central file overweight" regressions before they pile up.
 * After the OP-031..034 splits (db.rs / settings/index.tsx /
 * sandbox/mod.rs / profiles/index.tsx), the largest production module
 * sits at 824 lines (`sandbox/authority.rs`, mostly tests). This gate
 * locks that ceiling in: a soft warning at 800 lines, a hard fail at
 * 1500 lines.
 *
 * Why two thresholds?
 * - 800 lines is roughly where unit cohesion starts to fray and
 *   reviewers stop being able to keep the whole file in their head.
 *   We want a noisy warning so refactors get scheduled, not a CI red
 *   that blocks unrelated PRs.
 * - 1500 lines is "the original problem we just solved" territory.
 *   If a single file regrows past that, the lesson from OP-031..034
 *   was lost and the PR needs to be unblocked deliberately.
 *
 * Tunables:
 * - `MAX_LINES_WARN`  — soft cap (warning, exit 0).
 * - `MAX_LINES_FAIL`  — hard cap (exit 1).
 * - `IGNORE_PATTERNS` — bail-outs for legitimately large generated /
 *                      vendored / locale / data files.
 *
 * Scope: scans `src/**` (frontend) and `src-tauri/src/**` (Rust). Skips
 * `target/`, `node_modules/`, `dist/`, lockfiles, and test fixtures.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['src', 'src-tauri/src'];
const EXTS = new Set(['.ts', '.tsx', '.rs']);

const MAX_LINES_WARN = Number(process.env.MAX_LINES_WARN ?? 800);
const MAX_LINES_FAIL = Number(process.env.MAX_LINES_FAIL ?? 1500);

// File suffixes we never gate. Locale dictionaries, generated bindings,
// and the IPC type-mirror file are intentionally large for cohesion
// reasons unrelated to "this module became a god file".
const IGNORE_PATTERNS = [
  /\/locales\//,
  /\.json$/,
  /\.snap$/,
  // Hand-written TS mirror of all Rust IPC types — splitting fragments
  // the single-source-of-truth contract reviewers rely on.
  /\/lib\/ipc\.ts$/,
];

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'playwright-report']);

/** Recursive walk yielding `{absPath, relPath, lines}` for every gated file. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(abs);
      continue;
    }
    if (!ent.isFile()) continue;
    const dot = ent.name.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = ent.name.slice(dot);
    if (!EXTS.has(ext)) continue;
    const rel = relative(ROOT, abs);
    if (IGNORE_PATTERNS.some((re) => re.test(rel))) continue;
    const size = statSync(abs).size;
    // Cheap line count via Buffer scan; faster than splitting the
    // whole string for the rare 5k-line file.
    const buf = readFileSync(abs);
    let lines = 1;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lines++;
    yield { abs, rel, lines, size };
  }
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(resolve(ROOT, root))) {
    if (file.lines >= MAX_LINES_WARN) offenders.push(file);
  }
}

offenders.sort((a, b) => b.lines - a.lines);

console.log(
  `[file-sizes] scanning src/ and src-tauri/src/ · warn ≥ ${MAX_LINES_WARN} · fail ≥ ${MAX_LINES_FAIL}`,
);

if (offenders.length === 0) {
  console.log('[file-sizes] ✅ no files exceed the warning threshold');
  process.exit(0);
}

const fails = offenders.filter((o) => o.lines >= MAX_LINES_FAIL);
const warns = offenders.filter((o) => o.lines < MAX_LINES_FAIL);

if (warns.length > 0) {
  console.log('\n[file-sizes] ⚠️  files over warn threshold (consider splitting):');
  for (const f of warns) {
    console.log(`  ${String(f.lines).padStart(5)}  ${f.rel}`);
  }
}

if (fails.length > 0) {
  console.error('\n[file-sizes] ❌ FAIL — files over hard cap:');
  for (const f of fails) {
    console.error(`  ${String(f.lines).padStart(5)}  ${f.rel}`);
  }
  console.error(
    '\nOptions:\n' +
      '  1. Split the file by domain (see OP-031..034 in docs/agent/00-操作日志.md for the pattern).\n' +
      '  2. If the size is unavoidable (e.g. a vendored asset), add the path to IGNORE_PATTERNS in scripts/check-file-sizes.mjs and explain why in the commit.',
  );
  process.exit(1);
}

console.log('\n[file-sizes] ✅ pass (warnings are advisory)');
