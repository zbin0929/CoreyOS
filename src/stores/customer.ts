import { create } from 'zustand';
import { customerConfigGet, type CustomerConfig } from '@/lib/ipc/customer';

export type { CustomerConfig } from '@/lib/ipc/customer';

/**
 * White-label customer config store. Loaded ONCE at app startup
 * (see `bootstrapCustomer` in `src/main.tsx`) and read by the
 * Sidebar / AppShell / route filter. There is no setter — the
 * config comes from `~/.hermes/customer.yaml`, never edited at
 * runtime.
 */
interface CustomerState {
  /** `null` until `bootstrapCustomer` resolves. Components must
   *  treat null as "still loading, render defaults". */
  config: CustomerConfig | null;
  setConfig: (cfg: CustomerConfig) => void;
}

export const useCustomerStore = create<CustomerState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));

/** Pure helper: returns the set of nav-entry ids that should be
 *  hidden, given a snapshot. Exported for unit tests; production
 *  callers use the `useHiddenRoutes` hook below. */
export function selectHiddenRoutes(cfg: CustomerConfig | null): Set<string> {
  if (!cfg || !cfg.present) return EMPTY_SET;
  return new Set(cfg.navigation.hiddenRoutes);
}

const EMPTY_SET: Set<string> = new Set();

/** Pure helper: resolves display name with fallback. */
export function selectBrandAppName(
  cfg: CustomerConfig | null,
  fallback: string,
): string {
  if (!cfg || !cfg.present) return fallback;
  const trimmed = cfg.brand.appName.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Pure helper: resolves logo URL, empty when none configured. */
export function selectBrandLogoUrl(cfg: CustomerConfig | null): string {
  if (!cfg || !cfg.present) return '';
  return cfg.brand.logo.trim();
}

/** Hook: returns the set of nav-entry ids the active
 *  `customer.yaml` requested be hidden. Empty set when no yaml is
 *  loaded. */
export function useHiddenRoutes(): Set<string> {
  const cfg = useCustomerStore((s) => s.config);
  return selectHiddenRoutes(cfg);
}

/** Hook: app display name. Falls back to the i18n `app.name`
 *  string when no override is configured. */
export function useBrandAppName(fallback: string): string {
  const cfg = useCustomerStore((s) => s.config);
  return selectBrandAppName(cfg, fallback);
}

/** Hook: resolved logo URL, or empty string to mean "use the
 *  default `CoreyMark` SVG". */
export function useBrandLogoUrl(): string {
  const cfg = useCustomerStore((s) => s.config);
  return selectBrandLogoUrl(cfg);
}

export function useCustomerConfig(): CustomerConfig | null {
  return useCustomerStore((s) => s.config);
}

/**
 * Fetch `customer_config_get` from the backend, store the snapshot,
 * and apply DOM-level side effects (document.title, primary-color
 * CSS variable). Idempotent — calling twice will overwrite the
 * stored config and re-apply.
 *
 * Best-effort: errors are logged to the console and the app proceeds
 * with default Corey branding.
 */
export async function bootstrapCustomer(): Promise<void> {
  let cfg: CustomerConfig;
  try {
    cfg = await customerConfigGet();
  } catch (err) {
    // Non-Tauri environments (vitest, storybook, web-only dev) just
    // skip — there's no backend to ask.
    console.warn('[customer] bootstrap failed; using defaults', err);
    return;
  }

  useCustomerStore.getState().setConfig(cfg);
  if (!cfg.present) return;

  // Document title — overrides the value baked into index.html so a
  // delivered build still shows the customer's brand in the Tauri
  // taskbar/menu.
  if (cfg.brand.appName.trim().length > 0) {
    document.title = cfg.brand.appName.trim();
  }

  // Primary colour. We override the `--gold-500` design token (the
  // accent used for selected nav, primary buttons, focus rings).
  // The token is an HSL triplet (e.g. "43 86% 58%") so the rest of
  // the design system can compose alphas. Convert hex → HSL once
  // here.
  if (cfg.brand.primaryColor.trim().length > 0) {
    const hsl = hexToHslTriplet(cfg.brand.primaryColor.trim());
    if (hsl) {
      document.documentElement.style.setProperty('--gold-500', hsl);
    }
  }
}

/**
 * Convert `"#RRGGBB"` (or `"#RGB"`) to the HSL triplet string
 * `"H S% L%"` that the design system expects in `:root`.
 *
 * Returns `null` if the input is not a valid hex colour. We
 * tolerate the leading `#` being absent.
 */
export function hexToHslTriplet(hex: string): string | null {
  const cleaned = hex.replace(/^#/, '').trim();
  let r: number;
  let g: number;
  let b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0]! + cleaned[0]!, 16);
    g = parseInt(cleaned[1]! + cleaned[1]!, 16);
    b = parseInt(cleaned[2]! + cleaned[2]!, 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return null;
  }
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  const hRound = Math.round(h);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);
  return `${hRound} ${sPct}% ${lPct}%`;
}
