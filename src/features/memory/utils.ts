import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MemoryFile, MemoryKind } from '@/lib/ipc';

export type TabState = {
  loading: boolean;
  file: MemoryFile | null;
  dirty: string;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
};

export function emptyTab(): TabState {
  return {
    loading: true,
    file: null,
    dirty: '',
    saving: false,
    savedAt: null,
    error: null,
  };
}

export type Tabs = Record<MemoryKind, TabState>;

export type ActiveTab = MemoryKind | 'search';

/** Byte-count using UTF-8 encoding so the cap matches what the Rust
 *  side enforces (which also sees the UTF-8 byte length via
 *  `String::len()`). `content.length` would under-count any char
 *  outside the BMP or any multi-byte CJK run — a real concern since
 *  most of our Chinese users write notes in `zh`. */
export function dirtyBytes(content: string): number {
  // `TextEncoder` is synchronous and available in every Tauri webview
  // we target. Caching the instance is a micro-opt that isn't worth
  // the module-level state.
  return new TextEncoder().encode(content).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * "Reveal in Finder" — opens the containing directory with the
 * system's default file manager. We intentionally open the PARENT
 * directory rather than the file itself so `open("…/MEMORY.md")`
 * doesn't launch Markdown in a text editor. Best-effort: falls back
 * to a no-op when the shell plugin isn't available (tests, Storybook).
 */
export async function revealInFinder(absPath: string): Promise<void> {
  const dir = absPath.slice(0, absPath.lastIndexOf('/')) || absPath;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(dir);
  } catch {
    // Plugin unavailable in non-tauri contexts; swallow so the UI
    // doesn't toast an error for something users can work around by
    // copying the path from the tooltip.
  }
}

export function useSavedLabel(savedAt: number | null): string | null {
  const { t } = useTranslation();
  // Re-render every second for the first minute after a save so the
  // "Saved 3s ago" string decays. After that we stop the interval and
  // just say "Saved".
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const elapsed = Date.now() - savedAt;
    if (elapsed > 60_000) return;
    const h = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, [savedAt]);
  return useMemo(() => {
    if (!savedAt) return null;
    const s = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    // Reference `tick` to pin the memoised value to the ticker.
    void tick;
    if (s < 60) return t('memory.saved_ago', { seconds: s });
    return t('memory.saved');
  }, [savedAt, tick, t]);
}

/** Parse Hermes' `>>>match<<<` snippet into alternating plain and
 *  matched fragments. Non-regex so stray `>` / `<` in user text
 *  can't trigger a runaway match. */
export function splitHighlight(raw: string): Array<{ text: string; match: boolean }> {
  const out: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < raw.length) {
    const openIdx = raw.indexOf('>>>', i);
    if (openIdx < 0) {
      out.push({ text: raw.slice(i), match: false });
      break;
    }
    if (openIdx > i) out.push({ text: raw.slice(i, openIdx), match: false });
    const closeIdx = raw.indexOf('<<<', openIdx + 3);
    if (closeIdx < 0) {
      // Unterminated marker — render rest as plain text.
      out.push({ text: raw.slice(openIdx), match: false });
      break;
    }
    out.push({ text: raw.slice(openIdx + 3, closeIdx), match: true });
    i = closeIdx + 3;
  }
  return out;
}
