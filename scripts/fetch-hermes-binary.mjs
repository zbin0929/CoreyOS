#!/usr/bin/env node
/**
 * Download the matching Hermes CLI release binary into
 * `src-tauri/binaries/` so Tauri's `bundle.resources` glob picks it
 * up at build time.
 *
 * Run by CI before `tauri build`. Locally, maintainers can run it the
 * same way before `pnpm tauri build` to produce a packaged installer
 * that ships the agent.
 *
 * Inputs (env vars, all optional):
 *   HERMES_VERSION  Tag on github.com/NousResearch/hermes-agent.
 *                   Defaults to `latest` (resolved via the API).
 *   HERMES_TARGET   Rust target triple to fetch. Defaults to the host
 *                   triple inferred from `process.platform/arch`.
 *
 * Output: `src-tauri/binaries/hermes` (or `hermes.exe` on Windows),
 * with executable bit set on POSIX.
 *
 * Failure mode: prints a warning and exits 0 when the upstream
 * release / asset isn't found. Bundling-with-Corey is opportunistic;
 * the b5 fallback chain in `resolve_hermes_binary` lets users install
 * Hermes themselves and the app still works.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, chmod, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const REPO = 'NousResearch/hermes-agent';
const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(ROOT, 'src-tauri', 'binaries');

function hostTarget() {
  const { platform, arch } = process;
  if (platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`unsupported host platform: ${platform}/${arch}`);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'CoreyOS-fetch-hermes',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function resolveAssetUrl(target) {
  const tag = process.env.HERMES_VERSION?.trim();
  const apiUrl = tag && tag !== 'latest'
    ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const release = await fetchJson(apiUrl);
  const assets = release.assets ?? [];
  // Match either `hermes-<target>...` or `hermes_<target>...`. We
  // strip the file extension to be robust to .tar.gz / .zip / raw bin
  // packaging conventions.
  const candidate = assets.find((a) => {
    const name = String(a.name).toLowerCase();
    return name.includes(target.toLowerCase()) && name.includes('hermes');
  });
  if (!candidate) {
    const have = assets.map((a) => a.name).join(', ') || '(none)';
    throw new Error(
      `no asset for target ${target} in release ${release.tag_name}; assets: ${have}`,
    );
  }
  return { url: candidate.browser_download_url, name: candidate.name, tag: release.tag_name };
}

async function downloadTo(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CoreyOS-fetch-hermes' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} → ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function extractIfArchive(archivePath, finalPath, isWindows) {
  // Tar / zip extraction without adding a runtime dep: shell out. CI
  // images on both windows-latest and macos-latest have `tar` (and
  // 7z / Expand-Archive on Windows). Single-file `hermes` archives
  // give us one inner binary we move to `finalPath`.
  const { execFile } = await import('node:child_process');
  const exec = (file, args, opts) =>
    new Promise((res, rej) =>
      execFile(file, args, opts, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          rej(err);
        } else {
          res({ stdout, stderr });
        }
      }),
    );
  const lower = archivePath.toLowerCase();
  const stage = `${archivePath}.extract`;
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await exec('tar', ['-xzf', archivePath, '-C', stage]);
  } else if (lower.endsWith('.zip')) {
    if (isWindows) {
      await exec('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${stage}' -Force`,
      ]);
    } else {
      await exec('unzip', ['-q', archivePath, '-d', stage]);
    }
  } else {
    // Raw binary; just move into place.
    await rename(archivePath, finalPath);
    return;
  }
  // Find the hermes binary inside the staged dir.
  const { readdir } = await import('node:fs/promises');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(p);
        if (found) return found;
      } else if (e.name === 'hermes' || e.name === 'hermes.exe') {
        return p;
      }
    }
    return null;
  }
  const found = await walk(stage);
  if (!found) {
    throw new Error('extracted archive but no `hermes` binary inside');
  }
  await rename(found, finalPath);
  await rm(stage, { recursive: true, force: true });
  await rm(archivePath, { force: true });
}

async function main() {
  const target = process.env.HERMES_TARGET?.trim() || hostTarget();
  const isWindows = target.includes('windows');
  const finalName = isWindows ? 'hermes.exe' : 'hermes';
  const finalPath = join(OUT_DIR, finalName);
  await mkdir(OUT_DIR, { recursive: true });

  let asset;
  try {
    asset = await resolveAssetUrl(target);
  } catch (e) {
    console.warn(`[fetch-hermes-binary] skipping bundle: ${e.message}`);
    return;
  }
  console.log(`[fetch-hermes-binary] ${asset.tag} → ${asset.name}`);
  const tmp = join(OUT_DIR, asset.name);
  await downloadTo(asset.url, tmp);
  await extractIfArchive(tmp, finalPath, isWindows);
  if (!isWindows) {
    await chmod(finalPath, 0o755);
  }
  console.log(`[fetch-hermes-binary] staged at ${finalPath}`);
}

main().catch((e) => {
  console.error(`[fetch-hermes-binary] ${e.message}`);
  process.exit(1);
});
