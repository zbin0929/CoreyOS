import { invoke } from '@tauri-apps/api/core';

/** White-label brand overrides loaded from `~/.hermes/customer.yaml`.
 *  Mirrors `crate::ipc::customer::BrandDto`. Empty strings represent
 *  "absent" — no `null`s are sent over the wire so the React side
 *  can branch on truthiness without null-checks. */
export interface CustomerBrand {
  /** Display name for the app. Empty = use default `app.name`
   *  i18n string. */
  appName: string;
  /** Path (absolute or relative to `~/.hermes/`) to a logo image.
   *  Empty = use the bundled `CoreyMark` SVG. */
  logo: string;
  /** Hex colour string (e.g. `#FF6B00`). Empty = use default
   *  gold accent. */
  primaryColor: string;
}

/** Navigation customisation. */
export interface CustomerNavigation {
  /** Sidebar entry ids to hide from the nav tree. Matches
   *  `NavEntry.id` in `src/app/nav-config.ts`. */
  hiddenRoutes: string[];
}

/** Snapshot returned by `customer_config_get`. */
export interface CustomerConfig {
  schemaVersion: number;
  brand: CustomerBrand;
  navigation: CustomerNavigation;
  /** True when a `customer.yaml` was actually loaded from disk.
   *  False = use defaults; `brand` and `navigation` will be empty. */
  present: boolean;
  /** Non-empty when the file existed but failed to parse. The
   *  Settings → Help panel surfaces this so silent typos don't
   *  fly. */
  error: string | null;
}

/** Read the parsed customer.yaml snapshot. Always succeeds —
 *  defaults are returned when no file is present. Called once at
 *  app boot from `applyCustomerCustomization()`. */
export function customerConfigGet(): Promise<CustomerConfig> {
  return invoke<CustomerConfig>('customer_config_get');
}
