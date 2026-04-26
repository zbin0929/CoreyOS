import type { Tab } from './types';

/** When the active tab closes, pick its right-neighbour (preserves
 *  tab-bar position), falling back to the left neighbour and then
 *  `null` (empty state). */
export function pickNeighbour(tabs: Tab[], removed: string): string | null {
  const idx = tabs.findIndex((tab) => tab.key === removed);
  if (idx < 0) return tabs[0]?.key ?? null;
  const right = tabs[idx + 1];
  if (right) return right.key;
  const left = tabs[idx - 1];
  if (left) return left.key;
  return null;
}

/** Decode a base64 string into a Uint8Array. Pure browser atob — no deps. */
export function base64DecodeToUint8(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
