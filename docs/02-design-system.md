# 02 · Design System

## Principles

1. **Information density over whitespace theater.** Linear/Raycast/Superhuman, not Notion onboarding.
2. **Keyboard is primary.** Every action has a shortcut; ⌘K reveals all of them.
3. **Motion signals causality, never decorates.** 120–200 ms, `ease-out`, no bounce.
4. **Dark is default and first-class.** Light mode is supported but tuned second.
5. **One voice, no emoji.** Clear nouns and verbs. No exclamation points.

## Color tokens (HSL, dark theme)

All tokens are CSS variables in `src/styles/tokens.css`, consumed by Tailwind via `hsl(var(--token))` pattern.

### Surface

| Token            | HSL            | Usage                                  |
|------------------|----------------|----------------------------------------|
| `--bg`           | `225 18% 6%`   | App canvas (obsidian)                  |
| `--bg-elev-1`    | `225 16% 9%`   | Sidebar, cards                         |
| `--bg-elev-2`    | `225 14% 12%`  | Popovers, dialog                       |
| `--bg-elev-3`    | `225 12% 16%`  | Tooltips, nested popovers              |
| `--border`       | `225 10% 18%`  | Default 1px border                     |
| `--border-strong`| `225 10% 26%`  | Emphasized divider                     |

### Ink

| Token            | HSL            | Usage                                  |
|------------------|----------------|----------------------------------------|
| `--fg`           | `40 12% 96%`   | Primary text (warm off-white)          |
| `--fg-muted`     | `225 8% 68%`   | Secondary text                         |
| `--fg-subtle`    | `225 6% 48%`   | Labels, placeholder                    |
| `--fg-disabled`  | `225 6% 34%`   | Disabled text                          |

### Accent (Hermes gold)

| Token            | HSL            | Usage                                  |
|------------------|----------------|----------------------------------------|
| `--gold-50`      | `45 100% 92%`  | Hover on tinted bg                     |
| `--gold-200`     | `45 90% 78%`   | Chart highlight, text on dark accent   |
| `--gold-500`     | `43 86% 58%`   | **Primary accent**, focus ring, CTA bg |
| `--gold-600`     | `40 82% 48%`   | Pressed state                          |
| `--gold-700`     | `37 78% 38%`   | Dark-mode text-on-gold fallback        |

### Semantic

| Token            | HSL            | Usage                         |
|------------------|----------------|-------------------------------|
| `--success`      | `150 60% 50%`  | Online, configured, passed    |
| `--warning`      | `32 90% 56%`   | Budget 80%, near-limit        |
| `--danger`       | `356 78% 58%`  | Error, over-budget            |
| `--info`         | `210 90% 62%`  | Neutral notice                |

### Light theme

Derived by swapping the `bg` and `fg` scales (obsidian→ivory) and desaturating gold to `--gold-600`. Defined as `[data-theme="light"]` overrides.

## Typography

- **Sans**: Inter Variable (subset: latin + latin-ext + symbols).
- **Mono**: JetBrains Mono Variable.
- **Display**: Inter Display for marketing/landing only.
- **CJK fallback**: system-ui / "PingFang SC" / "Noto Sans SC" → chained, no web font to keep bundle small.

Type scale (all use `line-height` multipliers, not fixed px):

| Token        | Size  | Line    | Weight | Usage                  |
|--------------|-------|---------|--------|------------------------|
| `text-xs`    | 11px  | 1.45    | 500    | Badges, metadata       |
| `text-sm`    | 12.5px| 1.5     | 400    | Body default (dense)   |
| `text-base`  | 14px  | 1.55    | 400    | Chat body, forms       |
| `text-md`    | 15px  | 1.5     | 500    | Section labels         |
| `text-lg`    | 17px  | 1.4     | 600    | Panel titles           |
| `text-xl`    | 20px  | 1.35    | 600    | Page titles            |
| `text-2xl`   | 24px  | 1.3     | 600    | Dashboard H1           |
| `text-display`| 40px | 1.15    | 700    | Landing only           |

Numeric fonts use `font-variant-numeric: tabular-nums` globally on numeric cells (usage table, cost).

## Spacing & radius

- 4px base. Tailwind defaults are fine; we additionally define `spacing.18 = 4.5rem`.
- Radii: `--radius-sm: 4px`, `--radius: 6px` (default), `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-xl: 16px`.
- Cards use `--radius-md`; popovers `--radius`.

## Elevation

Flat by default. Elevation comes from 1–2 layered borders + subtle top-lit gradient, no drop shadows on the canvas. Only **floating surfaces** (menus, dialog, toast) have shadow:

```css
--shadow-1: 0 1px 0 hsl(0 0% 100% / 0.03) inset,
            0 4px 12px -4px hsl(0 0% 0% / 0.5);
--shadow-2: 0 1px 0 hsl(0 0% 100% / 0.04) inset,
            0 12px 32px -8px hsl(0 0% 0% / 0.6);
```

## Motion

- **Fast**: 120 ms — hovers, focus rings, tooltips.
- **Default**: 180 ms — dialogs open/close, palette, tab switch.
- **Slow**: 320 ms — layout transitions, trajectory tree expand.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` for enter; `cubic-bezier(0.4, 0, 1, 1)` for exit.
- Reduced-motion: all > 120 ms transitions collapse to 0 when `prefers-reduced-motion: reduce`.

## Iconography

- Lucide at 16/18/20 px (stroke 1.5). 14px only inside badges.
- Custom glyphs for: Caduceus mark, Hermes logotype, platform logos (Telegram/Discord/etc. in their brand color when configured, neutral grey when unconfigured).
- No colored emoji anywhere in UI chrome.

## Components (shadcn-based, restyled)

Baseline from shadcn/ui, then overridden:

- `Button`: 3 variants (`primary` gold, `secondary` glass, `ghost`). 3 sizes (xs 22px, sm 28px, md 32px). Focus ring gold @ 2px outside.
- `Input`, `Textarea`: elevated field (`bg-elev-1`), 1px border, inner 1px highlight top on focus.
- `Select`, `Combobox`: popover uses `bg-elev-2`, search filter always on.
- `Dialog`, `Sheet`, `Drawer`: entrance `scale(.98) + opacity 0` → `1`, 180 ms.
- `Tooltip`: 11px, delay 500 ms open / 0 close, `bg-elev-3`.
- `Toast`: top-right stack, auto-dismiss 4 s, hover pauses timer.
- `DataTable`: sticky header, row height 32 px dense / 40 px comfort, zebra optional, column resize + reorder, keyboard nav.
- `Tabs`: underline style with 2px gold indicator, animated with Framer layoutId.
- `CommandPalette` (`cmdk`): full-screen on ≤ `sm`, centered 640 px on ≥ `md`, groups with shortcuts on the right.
- `Kbd`: small rounded key glyphs, macOS uses `⌘ ⌥ ⇧ ⌃`, Windows/Linux uses `Ctrl Alt Shift`.

## Layout

### App shell (desktop ≥ 960 px)

```
┌────────┬───────────────────────────────────────────────┐
│        │  Topbar (profile picker │ gateway status │ ⌘K)│
│  Side  ├───────────────────────────────────────────────┤
│  bar   │                                               │
│  224px │           Feature route                       │
│        │                                               │
│        │                                               │
└────────┴───────────────────────────────────────────────┘
```

Sidebar sections (top-to-bottom): Chat · Compare · Skills · Trajectory · Analytics · Logs · Terminal · Scheduler · Channels · Models · Settings. Collapsible to 56 px rail.

### Mobile (< 720 px)

Bottom tab bar with 4 primary + "More": Chat · Compare · Analytics · Settings · More. Drawers for side content.

## Key screens (design intent)

1. **Chat** — 3-column: sessions list (sortable, grouped by source), conversation (virtualized), right inspector (tool calls, tokens, model). Inspector collapsible.
2. **Compare** — header prompt box; N model lanes below, streams land in parallel; diff-highlight bar shows token/cost deltas.
3. **Skill editor** — left file tree; center split pane (prompt source + live preview run); right diff + version history.
4. **Trajectory** — horizontal timeline of turns with expandable tool-call ribbons; hover shows tokens and latency.
5. **Analytics** — KPI strip + stacked-bar 30d + model mix donut + cost-per-session line; everything keyboard-filterable.
6. **Channels** — card grid, one per platform; card flips to inline form on configure; live status dot.

## Accessibility

- Minimum contrast: AA for body, AAA for critical actions.
- All interactive elements reachable and visible via keyboard; focus ring is the gold accent, never removed.
- Screen reader: landmarks (`banner`, `navigation`, `main`, `complementary`), `aria-live="polite"` for chat deltas (throttled).
- Respect `prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`.

## Theming & extensibility

- All colors flow from tokens. Themes are JSON files mapping tokens → HSL triplets; users can drop a theme file into `~/.caduceus/themes/` and pick it at runtime.
- Plugins can register their own token sub-namespace (`--plugin-<id>-*`) but cannot override core tokens.

## Deliverables for Phase 0

- `src/styles/tokens.css`, `tailwind.config.ts`, `globals.css`.
- `src/components/ui/*` shadcn primitives generated via `pnpm dlx shadcn@latest add …`, then restyled per above.
- `src/components/command-palette/*`.
- `src/app/shell/*` (AppShell, Sidebar, Topbar).
- Storybook (or Ladle for speed) stories for every restyled primitive, dark + light.
- A visual-regression baseline snapshot (Playwright) for the shell, palette, and 5 primitives.
