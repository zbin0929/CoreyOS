# UI Revamp v1 (Execution Spec)

Status: approved for implementation  
Owner: CoreyOS frontend  
Last updated: 2026-05-02

## 1. Goal

Rebuild CoreyOS UI from "generic admin dashboard" to a recognisable "AI control plane" while preserving current routes, capabilities, and stability.

Design priorities:
- Control-plane first (not consumer chat)
- Signal density with clear hierarchy
- Dark-first visual identity with gold accent
- Pack-centric workflow entry
- Zero feature regression

## 2. Guardrails

- Keep route map unchanged.
- Keep 3-tier sidebar structure and Settings pinned at bottom.
- No backend contract changes in v1 visual phase.
- Do not block current release workflow or existing e2e assumptions.
- Accessibility baseline stays intact (focus ring, contrast, reduced motion).

## 3. Visual System

### 3.1 Theme

Primary mode: dark-first.

Core tokens (target):
- `--bg-base`: near-black neutral
- `--bg-surface`: level-1 panel
- `--bg-elev`: level-2 panel
- `--border-subtle`: low-contrast border
- `--accent`: gold/amber
- `--accent-soft`: low-alpha accent surface

Status tokens:
- online: green
- warning: amber
- error: red
- info: blue

### 3.2 Typography

- UI text: sans modern (existing stack-compatible)
- Number-heavy KPIs: tabular numerals
- Heading hierarchy tightened (clear h1/h2/h3 rhythm)

### 3.3 Component Language

Standardize these primitives:
- StatusChip
- MetricTile
- PanelHeader
- SignalCard
- EmptyState
- RecoverAction

## 4. IA and Navigation

### 4.1 Sidebar

Keep current groups:
- Primary
- Tools
- More (collapsible)
- Settings (bottom)

Change behavior:
- Pack list no longer long-expanded by default.
- Show active pack summary row + quick switch entry.
- Move dense Pack view entry list to contextual area in main content.

### 4.2 Home structure

Replace current flat cards with 4 blocks:
1. Hero strip (gateway/model/latency/token pulse)
2. Today focus (alerts + actionable queue)
3. Pack dashboard surface (pack-specific KPIs)
4. Quick actions (high-frequency actions only)

## 5. Page-by-page Scope (v1)

### 5.1 Home (`/`)

- Rebuild layout hierarchy.
- Improve metric readability and state emphasis.
- Replace low-signal cards with action-centric blocks.

### 5.2 Analytics (`/analytics`)

- Normalize chart framing and card density.
- Add trend context around KPI numbers.
- Improve empty/loading/error chart states.

### 5.3 Channels (`/channels`)

- Improve card status hierarchy (configured/unconfigured/risk).
- Clarify per-channel action affordances.
- Reduce visual noise from uniform card treatment.

### 5.4 Settings (`/settings`)

- Strengthen tab readability and section grouping.
- Improve long-form settings scanability.
- Keep existing setting semantics unchanged.

## 6. Motion

Use restrained functional motion only:
- page enter fade/translate (short)
- chip status transitions
- numeric count transitions for KPI

Avoid cinematic/parallax effects in control surfaces.
Respect reduced-motion preference.

## 7. Delivery Plan

### Phase A — Foundation (1-2 days)
- Token cleanup
- Surface/border/shadow consistency
- Sidebar visual cleanup

### Phase B — Home first (2-3 days)
- Home IA rebuild
- New hero strip + focus panels
- Quick action block redesign

### Phase C — Analytics/Channels/Settings polish (2-4 days)
- Card/chart consistency
- Status clarity improvements
- Form section readability

### Phase D — QA and stabilization (1-2 days)
- Visual regression pass
- Responsive pass
- dark/light parity check

## 8. Acceptance Criteria

- First-screen hierarchy is obvious within 3 seconds.
- Active risks are actionable in one click.
- Sidebar noise reduced while route discoverability preserved.
- No route removed, no feature hidden behind dead-end UI.
- Existing tests remain green after UI changes.

## 9. Out of Scope (v1)

- New business capabilities
- New backend APIs
- New data models
- Major workflow engine behavior changes

## 10. Implementation Start Point

Start from Home page and shared style tokens.
Then propagate component primitives to Analytics/Channels/Settings.
