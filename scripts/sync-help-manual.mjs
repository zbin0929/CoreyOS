#!/usr/bin/env node
/**
 * Sync the canonical user manual into the bundled help route source.
 *
 * Why both copies exist:
 *  - `docs/user/用户手册.md` is the source of truth — version-controlled
 *    documentation, edited by humans, linked from README and GitHub.
 *  - `src/features/help/manual.zh.md` is what Vite picks up via
 *    `?raw` import and bakes into the JS bundle, so the in-app
 *    `/help` page works offline + always matches the build.
 *
 * Running this script before `dev`/`build` (via npm `pre*` hooks)
 * guarantees the two never drift. If the help page contents lag behind
 * the docs commit, that's a sync-script bug, not a content bug.
 *
 * Idempotent: bails out silently when the destination already matches
 * the source byte-for-byte. That keeps `npm run dev` startup quiet on
 * a clean tree.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = join(ROOT, 'docs/user/用户手册.md');
const DST = join(ROOT, 'src/features/help/manual.zh.md');

async function main() {
  if (!existsSync(SRC)) {
    // Don't hard-fail — the bundled copy is still valid, just stale.
    // Failing here would block `pnpm dev` if a contributor renames the
    // canonical doc, which would be confusing.
    console.warn(`[sync-help] source missing: ${SRC} — keeping bundled copy as-is.`);
    return;
  }
  const source = await readFile(SRC);
  if (existsSync(DST)) {
    const current = await readFile(DST);
    if (current.equals(source)) {
      // No change → silent.
      return;
    }
  }
  await mkdir(dirname(DST), { recursive: true });
  await writeFile(DST, source);
  console.log(`[sync-help] synced ${SRC} → ${DST} (${source.length} bytes)`);
}

main().catch((err) => {
  console.error('[sync-help] failed:', err);
  process.exit(1);
});
