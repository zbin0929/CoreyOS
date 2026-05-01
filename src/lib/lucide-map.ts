import * as lucide from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const cache = new Map<string, LucideIcon>();

export function lucideByName(name: string): LucideIcon {
  const hit = cache.get(name);
  if (hit) return hit;
  const cmp = (lucide as unknown as Record<string, LucideIcon>)[name];
  if (cmp) {
    cache.set(name, cmp);
    return cmp;
  }
  return lucide.Package;
}
