import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import { NAV } from './nav-config';

/**
 * Builds a lookup of `mod+<key>` → path from `NAV[].shortcut`.
 * `mod` maps to ⌘ on macOS and Ctrl elsewhere.
 */
function buildShortcutMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of NAV) {
    if (!entry.shortcut || entry.shortcut.length < 2) continue;
    const [mod, key] = entry.shortcut;
    if (mod !== 'mod' || !key) continue;
    map.set(key.toLowerCase(), entry.path);
  }
  return map;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Global route-jump shortcuts: ⌘0..9 + ⌘, (on mac) / Ctrl variants on win+linux.
 * Mounted once inside `AppShell` so `useRouter()` is available.
 */
export function useNavShortcuts(): void {
  const router = useRouter();

  useEffect(() => {
    const map = buildShortcutMap();

    const handler = (e: KeyboardEvent) => {
      // Require the platform meta key; don't fight with browser/devtools shortcuts.
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Never steal keys from text inputs.
      if (isTypingTarget(e.target)) return;
      // Don't hijack Shift-combos (that's reserved for ⌘⇧L theme toggle etc).
      if (e.shiftKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const path = map.get(key);
      if (!path) return;

      e.preventDefault();
      void router.navigate({ to: path });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);
}
