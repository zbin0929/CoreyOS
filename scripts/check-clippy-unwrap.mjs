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
