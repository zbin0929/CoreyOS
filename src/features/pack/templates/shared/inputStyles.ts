/**
 * Shared Tailwind class fragments for Pack template form inputs.
 *
 * Extracted 2026-05-17 from the (now-deleted) Meizheng-specific
 * editors (ExchangeRate / Zone / Carrier / umbrella) which
 * collectively repeated the same ~80-char Tailwind string
 * 28 times. Bundled here so that:
 *
 *   1. Style adjustments (e.g. dark-mode tweaks, focus-ring changes)
 *      happen in one place instead of being grepped across 5 files.
 *   2. The upcoming v0.3.0 schema-driven `SchemaConfig` template
 *      (see `docs/plans/v0.3.0-pack-schema-dsl.md`) can use the same
 *      classes its hand-rolled predecessors used — cutting visual
 *      regressions during migration.
 *
 * **No behaviour change** — these are pure constants.
 */

import { cn } from '@/lib/cn';

/** Base for `<input type="text|number|time">` — width must be added by caller
 *  (`w-full` / `w-24` / etc.) since different fields need different sizing. */
export const INPUT_BASE_CLASS =
  'rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20';

/** Convenience: full-width input. */
export const INPUT_FULL_CLASS = cn('w-full', INPUT_BASE_CLASS);

/** Smaller compact input variant used inside an array-item card. */
export const INPUT_COMPACT_CLASS =
  'rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20';

/** Standard form-section frame. */
export const SECTION_CARD_CLASS =
  'space-y-3 rounded-lg border border-border/60 bg-bg-elev-1/30 p-4';

/** Card wrapping one item in a dynamic array (schedule entry, carrier entry). */
export const ARRAY_ITEM_CARD_CLASS = 'space-y-2 rounded-lg border border-border/60 bg-bg p-3 shadow-sm';

/** "Delete" trash button placed inside an array item card. */
export const ARRAY_ITEM_DELETE_BTN_CLASS =
  'rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10';

/** Small label that sits above an input. */
export const FIELD_LABEL_CLASS = 'block text-xs font-medium text-fg';

/** Helper hint line below an input. */
export const FIELD_HELP_CLASS = 'text-[10px] text-fg-subtle';
