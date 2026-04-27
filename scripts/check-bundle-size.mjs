#!/usr/bin/env node
/**
 * Bundle-size gate.
 *
 * Scans `dist/assets/*.js`, gzips each file in memory, and fails if the
 * largest single chunk exceeds `MAX_CHUNK_GZIP_KB`. Point is to catch
 * accidental regressions like the `rehype-highlight` common-preset
 * bloat we spent a session tracking down (2026-04-23) — if CI tells
 * us "main chunk jumped 50 KB" the day a dep is added, the fix is a
 * five-minute revert instead of a weekend profiling session.
 *
 * Why a single-chunk budget (not total-bundle)?
 * - Total-bundle fluctuates with code-splitting churn (route splits
 *   move bytes around without adding them). Single-chunk is a cleaner
 *   signal: "is the first-paint payload getting bigger?"
 * - Playwright + Storybook + xterm's per-tab buffers all end up as
 *   separate chunks post route-split, so total is dominated by lazy
 *   routes the user pays for on-demand.
 *
 * Override at call time with `MAX_CHUNK_GZIP_KB=300 pnpm run check:bundle-size`
 * if a planned one-off bump makes the current budget too tight.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Current main chunk (2026-04-27 post-workflow-lifecycle pass)
 *  sits at ~308 KB gzip. The bump from 289 → 308 KB came from the
 *  P0.5 workflow lifecycle work: streaming hooks, History route,
 *  cancel + reject + LLM-profile UI, audit export. History.tsx is
 *  already lazy-imported; the rest is on the workflow main route
 *  (running visualization, hooks plumbing) and lives on the hot
 *  path. Budget set 12 KB above current to give the next two-three
 *  features headroom before the next code-split round. */
const MAX_CHUNK_GZIP_KB = Number(process.env.MAX_CHUNK_GZIP_KB ?? 320);
const DIST_ASSETS = resolve(process.cwd(), 'dist', 'assets');

function gzipKb(buf) {
  return gzipSync(buf).length / 1024;
}

function formatKb(kb) {
  return `${kb.toFixed(1).padStart(7)} KB`;
}

let files;
try {
  files = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));
} catch (e) {
  console.error(`[bundle-size] cannot read ${DIST_ASSETS}: ${e.message}`);
  console.error('[bundle-size] run `pnpm build` first.');
  process.exit(2);
}

if (files.length === 0) {
  console.error('[bundle-size] no .js files found in dist/assets/.');
  process.exit(2);
}

const sizes = files
  .map((name) => {
    const full = resolve(DIST_ASSETS, name);
    const buf = readFileSync(full);
    return { name, rawKb: statSync(full).size / 1024, gzipKb: gzipKb(buf) };
  })
  .sort((a, b) => b.gzipKb - a.gzipKb);

// Report — always print, even on success, so CI logs show the drift.
console.log('[bundle-size] top 8 chunks by gzip size:');
for (const row of sizes.slice(0, 8)) {
  console.log(
    `  ${formatKb(row.gzipKb)}  (raw ${formatKb(row.rawKb)})  ${row.name}`,
  );
}

const largest = sizes[0];
console.log(
  `\n[bundle-size] budget: ${MAX_CHUNK_GZIP_KB} KB gzip per chunk · actual max: ${largest.gzipKb.toFixed(1)} KB (${largest.name})`,
);

if (largest.gzipKb > MAX_CHUNK_GZIP_KB) {
  const over = largest.gzipKb - MAX_CHUNK_GZIP_KB;
  console.error(
    `\n[bundle-size] ❌ FAIL — ${largest.name} is ${over.toFixed(1)} KB gzip over budget.\n`,
  );
  console.error('Options:');
  console.error('  1. Tree-shake or lazy-load the offending dep (`pnpm build` prints a chunk report).');
  console.error('  2. Split the route/feature into its own lazy chunk in src/app/routes.tsx.');
  console.error(
    '  3. Raise the budget ONLY if the new weight is genuinely warranted — edit MAX_CHUNK_GZIP_KB in this file and document the jump in CHANGELOG.md.',
  );
  process.exit(1);
}

console.log('[bundle-size] ✅ pass');
