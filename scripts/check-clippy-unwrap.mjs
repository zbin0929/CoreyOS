#!/usr/bin/env node
/**
 * Clippy `unwrap_used` baseline gate.
 *
 * The codebase currently has hundreds of `unwrap()` calls, mostly in
 * test code and DB / changelog modules where the original author
 * accepted "panic on bug" as the contract. Migrating all of them to
 * `expect(...)` or proper error propagation is a multi-day refactor
 * that nobody has time for right now.
 *
 * What we *can* do is hold the line: record today's count, and fail
 * CI if a new commit pushes it higher. New code is expected to use
 * `?` / `expect(...)`, not `unwrap()`. When someone fixes a batch
 * of legacy unwraps, they bump the baseline down in the same PR.
 *
 *   scripts/clippy-unwrap-baseline.txt   ← single integer, the cap
 *
 * The baseline is intentionally a single number rather than a
 * per-file lockfile — keeping the file small avoids merge conflicts
 * and lets folks fix unwraps anywhere they want without re-touching
 * a giant manifest.
 *
 * Usage:
 *   node scripts/check-clippy-unwrap.mjs            # check
 *   node scripts/check-clippy-unwrap.mjs --update   # rewrite baseline
 *
 * Runs `cargo clippy` under `src-tauri/` so it must be invoked from
 * the repo root (or via `pnpm check:clippy-unwrap`, which sets cwd).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(__dirname, 'clippy-unwrap-baseline.txt');

console.log('[clippy-unwrap] running cargo clippy with -W clippy::unwrap_used …');
const res = spawnSync(
  'cargo',
  [
    'clippy',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    '--all-targets',
    '--quiet',
    '--',
    '-W',
    'clippy::unwrap_used',
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

if (res.status !== 0 && !res.stderr) {
  console.error('[clippy-unwrap] cargo clippy failed:', res.error ?? res.status);
  process.exit(2);
}

// Clippy writes its diagnostics to stderr.
const output = (res.stderr || '') + (res.stdout || '');
// Each warning has a tail line of the form:
//   = help: ... rust-clippy/.../index.html#unwrap_used
// Counting those is robust against rustc reformatting the location
// header (which spans multiple lines and varies by clippy version).
const matches = output.match(/index\.html#unwrap_used/g);
const current = matches ? matches.length : 0;

// ── Production vs. test split ───────────────────────────────────
// `unwrap()` in tests is industry-standard (panics fail tests
// loudly); the fight is really to keep production code unwrap-free.
// Bucket each warning by its source location: a hit in `*_tests.rs`
// or below a `#[cfg(test)] mod tests {…}` line counts as test code.
//
// Detection is heuristic-but-reliable: we read each cited file once
// and flag the LINE number against `mod tests` / `#[cfg(test)]`.
const fileTestStarts = new Map();
function testStartFor(file) {
  if (fileTestStarts.has(file)) return fileTestStarts.get(file);
  const starts = [];
  try {
    const fileLines = readFileSync(file, 'utf8').split('\n');
    let inCfgTestAttr = false;
    for (let i = 0; i < fileLines.length; i++) {
      const l = fileLines[i];
      // Match #[cfg(test)] AND compound forms (#[cfg(all(test,
      // unix))], #[cfg(any(test, …))], #[cfg_attr(test, …)]) which
      // gate Unix-only PTY tests, integration smoke tests, etc.
      // We avoid the nested-parens pitfall by NOT trying to match
      // the full attribute structure — just check that the line
      // begins with `#[cfg(` (or `#[cfg_attr(`) and contains the
      // bare token `test`. False positives (a feature literally
      // named `test`) are not realistic in this codebase.
      if (/^\s*#\[cfg(_attr)?\(/.test(l) && /\btest\b/.test(l)) {
        inCfgTestAttr = true;
        continue;
      }
      if (inCfgTestAttr && /^\s*(pub(\(.*\))?\s+)?mod\s+\w+/.test(l)) {
        starts.push(i + 1);
        inCfgTestAttr = false;
      }
    }
  } catch {
    /* file unreadable — treat all hits as production (worst case) */
  }
  fileTestStarts.set(file, starts);
  return starts;
}

// Walk the clippy output once. For each unwrap_used warning, the
// most recent `-->` line preceding the `index.html#unwrap_used`
// helper is the primary location. We track production vs. test
// based on whether that location is inside a `mod tests` block.
let prod = 0;
let test = 0;
const outLines = output.split('\n');
let pendingHits = [];
for (let i = 0; i < outLines.length; i++) {
  if (outLines[i].startsWith('warning:') || outLines[i].startsWith('error:')) {
    pendingHits = [];
    continue;
  }
  // Clippy paths are emitted relative to `src-tauri/` (the manifest
  // dir) — they look like `src/workflow/store.rs`, not
  // `src-tauri/src/workflow/store.rs`. Normalize back to a repo-
  // relative path so `readFileSync` finds the file from cwd (repo
  // root, where this script is invoked).
  const m = /-->\s+(src\/[^:\s]+):(\d+):/.exec(outLines[i]);
  if (m) {
    pendingHits.push({ file: `src-tauri/${m[1]}`, line: Number(m[2]) });
    continue;
  }
  if (/index\.html#unwrap_used/.test(outLines[i]) && pendingHits.length > 0) {
    const hit = pendingHits[0]; // primary = first --> after warning:
    const starts = testStartFor(hit.file);
    const isTestFile = /_tests\.rs$/.test(hit.file);
    const insideTestMod = starts.some((s) => hit.line >= s);
    if (isTestFile || insideTestMod) {
      test++;
    } else {
      prod++;
      if (process.argv.includes('--list-prod')) {
        console.log(`  prod: ${hit.file}:${hit.line}`);
      }
    }
    pendingHits = [];
  }
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_FILE, `${current}\n`);
  console.log(`[clippy-unwrap] baseline updated to ${current}`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error(
    `[clippy-unwrap] missing baseline file ${BASELINE_FILE}. ` +
      `Run with --update to create it.`,
  );
  process.exit(2);
}

const baseline = Number(readFileSync(BASELINE_FILE, 'utf8').trim());
if (!Number.isFinite(baseline)) {
  console.error(`[clippy-unwrap] baseline file is not a number: ${BASELINE_FILE}`);
  process.exit(2);
}

console.log(`[clippy-unwrap] current=${current}  baseline=${baseline}`);
console.log(`[clippy-unwrap]   production: ${prod}  test: ${test}`);
if (prod > 0) {
  console.warn(
    `[clippy-unwrap] ⚠️  ${prod} unwrap(s) in production paths — ` +
      `prefer \`?\` or \`expect("…")\`. New code under PRs MUST be unwrap-free.`,
  );
}
if (current > baseline) {
  console.error(
    `[clippy-unwrap] ❌ regression: ${current - baseline} new unwrap_used warnings.\n` +
      `New code must use \`?\` or \`expect("...")\` instead of \`unwrap()\`.\n` +
      `If you genuinely cannot avoid an unwrap (e.g. a test fixture), ` +
      `please justify it in the PR description.`,
  );
  process.exit(1);
}

if (current < baseline) {
  console.log(
    `[clippy-unwrap] ✅ improvement: ${baseline - current} unwrap_used warnings ` +
      `removed since the last baseline.\n` +
      `Run \`pnpm check:clippy-unwrap -- --update\` to lower the baseline.`,
  );
  process.exit(0);
}

console.log('[clippy-unwrap] ✅ on baseline');
process.exit(0);
