#!/usr/bin/env node
// Sandbox grep-lint.
//
// Every disk read/write on the Rust side SHOULD go through
// `sandbox::fs::*` so the PathAuthority gets a chance to check roots and
// the denylist. This script flags any `std::fs::` / `tokio::fs::` usage
// that isn't explicitly allowlisted.
//
// Allowlist rules (checked in order):
//   1. File is in `src-tauri/src/sandbox/**` — the sandbox itself needs raw fs.
//   2. File matches one of BOOTSTRAP_FILES — infra that runs before the
//      authority exists (atomic writer, sqlite dir bootstrap, etc.).
//   3. Line (or the line immediately above) contains `// sandbox-allow`.
//   4. The match sits inside a `#[cfg(test)]` module (heuristic: any
//      `#[cfg(test)]` attribute earlier in the file at column 0 puts the
//      rest of the file in "test" mode for our purposes, since our test
//      modules are always at the bottom of the file).
//
// Usage: `node scripts/check-sandbox-fs.mjs` (hooked up as
// `pnpm check:sandbox-fs`).

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src-tauri', 'src');

// Files where raw std::fs / tokio::fs is expected and doesn't need a
// per-line `sandbox-allow` marker.
const BOOTSTRAP_FILES = new Set(
  [
    'fs_atomic.rs',
    'db.rs', // sqlite parent dir bootstrap before authority loads
  ].map((p) => p.split('/').join(sep)),
);

const FORBIDDEN = [/\bstd::fs::/g, /\btokio::fs::/g];

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

function isAllowlistedFile(relPath) {
  if (relPath.startsWith(`sandbox${sep}`)) return true;
  return BOOTSTRAP_FILES.has(relPath);
}

function isAllowlistedLine(lines, idx) {
  const here = lines[idx] || '';
  if (here.includes('sandbox-allow')) return true;
  // Walk up through the contiguous `//` comment block directly above
  // the match. This lets callers write multi-line rationales without
  // losing the marker.
  for (let i = idx - 1; i >= 0; i--) {
    const t = (lines[i] || '').trim();
    if (!t.startsWith('//')) break;
    if (t.includes('sandbox-allow')) return true;
  }
  return false;
}

// Return a Set of line indices (0-based) that sit inside a `#[cfg(test)]`
// region. Heuristic: once we see `#[cfg(test)]` at column 0, every line
// from the next `mod ... {` onward (up to its balanced `}`) is test code.
// Good enough because our convention is exactly that pattern.
function testRegions(text) {
  const lines = text.split('\n');
  const inTest = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/^#\[cfg\(test\)\]\s*$/.test(lines[i])) continue;
    // Find the next `mod <name> {` line.
    let j = i + 1;
    while (j < lines.length && !/^\s*(pub\s+)?mod\s+\w+\s*\{/.test(lines[j])) j++;
    if (j >= lines.length) continue;
    // Walk brace balance from j.
    let depth = 0;
    let started = false;
    for (let k = j; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') {
          depth--;
        }
      }
      inTest.add(k);
      if (started && depth === 0) break;
    }
  }
  return inTest;
}

async function main() {
  const files = await walk(SRC);
  const violations = [];

  for (const file of files) {
    const rel = relative(SRC, file);
    if (isAllowlistedFile(rel)) continue;

    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    const testLines = testRegions(text);

    for (let i = 0; i < lines.length; i++) {
      if (testLines.has(i)) continue;
      const line = lines[i];
      // Ignore comments / doc-strings.
      const codePart = line.replace(/\/\/.*$/, '');
      if (!FORBIDDEN.some((re) => re.test(codePart))) continue;
      if (isAllowlistedLine(lines, i)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        text: line.trim(),
      });
    }
  }

  if (violations.length === 0) {
    console.log('sandbox-fs lint: OK');
    return;
  }

  console.error(`sandbox-fs lint: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`  src-tauri/src/${v.file}:${v.line}  ${v.text}`);
  }
  console.error('');
  console.error('Use `sandbox::fs::*` instead, or add `// sandbox-allow: <reason>` if truly needed.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
