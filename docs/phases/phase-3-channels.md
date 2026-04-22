# Phase 3 · Platform Channels

**Goal**: Configure all 8 messaging channels Hermes supports — credentials, behavior, status — from one screen. Reach parity with `hermes-web-ui`.

**Est.**: ~1 week solo.

**Depends on**: Phase 2 (config safety layer, gateway control).

## Supported channels

| Channel      | Credentials (→ `.env`)                 | Behavior (→ `config.yaml`)                           | Extras |
|--------------|----------------------------------------|------------------------------------------------------|--------|
| Telegram     | `TELEGRAM_BOT_TOKEN`                   | mention_required, reactions, free_chats              | —      |
| Discord      | `DISCORD_BOT_TOKEN`                    | mention_required, auto_thread, reactions, allow/ignore | —    |
| Slack        | `SLACK_BOT_TOKEN`                      | mention_required, handle_bot_messages                | —      |
| WhatsApp     | (env names TBD, verify live)           | enable, mention_required, mention_patterns           | —      |
| Matrix       | `MATRIX_ACCESS_TOKEN`, `MATRIX_HOMESERVER` | auto_thread, dm_mention_thread                   | —      |
| Feishu (Lark)| `FEISHU_APP_ID`, `FEISHU_APP_SECRET`   | mention_required                                     | —      |
| WeChat       | (managed via QR flow)                  | —                                                    | QR login via Tencent iLink |
| WeCom        | `WECOM_BOT_ID`, `WECOM_BOT_SECRET`     | —                                                    | —      |

## Exit criteria

1. `/channels` page shows 8 cards in a responsive grid; each card shows status (configured / unconfigured / error) and logo.
2. Clicking a card flips it to an inline form (no modal); validation via zod; save performs atomic `.env` + `config.yaml` writes.
3. Save prompts a "Restart gateway?" modal (unless setting is hot-reload safe); diff shown.
4. WeChat QR flow: click "Scan to log in" → QR appears → polls until scanned → credentials written → status flips to configured.
5. Status is computed live (not just presence of key): adapter pings the relevant Hermes check endpoint if available; falls back to credential presence.
6. Secrets never re-displayed after save (mask + last-4 only).
7. Every channel has at least one e2e test (form fill → save → file written correctly) against a mock file system.
8. Changelog entries for every channel change; revertable.

## Task breakdown

### T3.1 — Channel schema catalog (half day)

- `src-tauri/src/adapters/hermes/channels.rs`:
  - One `ChannelSpec` struct per channel describing: env keys, YAML path, field types, validators, hot-reloadable flag.
  - Compile-time checked via `once_cell::sync::Lazy<Vec<ChannelSpec>>`.
  - Exposed as typed enum in TS via `specta`.

### T3.2 — Channels page (1.5 days)

- `src/features/channels/`:
  - `ChannelsGrid.tsx` — 8 `ChannelCard`s in a responsive CSS grid.
  - `ChannelCard.tsx` — front face (logo, name, status dot, last edited); flips to form on click (Framer layout animation).
  - `forms/TelegramForm.tsx` + 7 more — each uses react-hook-form + the channel's zod schema.
  - `StatusPill.tsx` — "Configured · online", "Configured · unreachable", "Not configured", "Error".
  - `DiffModal.tsx` — shared: show env/yaml before-after on save.

### T3.3 — WeChat QR flow (1–1.5 days, risky)

- `src-tauri/src/adapters/hermes/wechat.rs`:
  - `wechat_qr_start() -> { qr_id, png_base64 }`
  - `wechat_qr_poll(qr_id) -> Pending | Scanned { credentials }`
  - Uses Tencent iLink endpoints (document the exact API surface; this is third-party and fragile).
  - On success: `env::patch` to write the credentials atomically.
- `src/features/channels/WeChatQr.tsx` — shows QR, polls every 2 s, timeout 5 min.
- Behind feature flag `channels.wechat`; disabled by default if upstream is down.

### T3.4 — Live status probing (half day)

- For channels Hermes exposes a health endpoint for, call it.
- Otherwise: parse recent log lines for "connected to {channel}" markers.
- Cache status for 30 s; refresh on demand with a button.

### T3.5 — Mobile layout (half day)

- Stack cards vertically below 720 px.
- Forms take full sheet on small screens (use Drawer instead of card-flip).

## Files added (summary)

```
src-tauri/src/adapters/hermes/
├── channels.rs
├── wechat.rs             (grown)
└── env.rs                (reused)

src/features/channels/
├── ChannelsGrid.tsx
├── ChannelCard.tsx
├── StatusPill.tsx
├── DiffModal.tsx
├── WeChatQr.tsx
└── forms/{Telegram,Discord,Slack,WhatsApp,Matrix,Feishu,Wecom}Form.tsx

src/locales/{en,zh}.json   (+ channel strings)
```

## Test plan

- **Unit (Rust)**: for each `ChannelSpec`, fake `.env` + `config.yaml` → `patch` → diff → `rollback`; end state equals start.
- **Unit (TS)**: each form's zod schema with valid/invalid fixtures.
- **e2e**: scripted "configure Telegram" flow; verify temp `.env` and temp `config.yaml` end up with expected content.
- **WeChat QR**: mocked iLink server (hyper in tests) replays a scanned response; assert credentials written.

## Demo script

1. Channels → 8 cards, 1 configured (Telegram), 7 empty.
2. Click Discord → form → paste token → save → diff modal → apply → gateway restart → Discord card flips to "Configured · online".
3. Click WeChat → QR pops up → scan (or mock scan) → credentials saved → status green.
4. Logs tab → show the "Discord connected" line parsed and colored.
5. Changelog → revert Discord change → `.env` restored.

## What Phase 3 does NOT do

- No channel-specific analytics beyond what Phase 2 already shows.
- No message-level channel routing rules (e.g. "send errors to Slack"). That could be a Phase 4+ feature.

---

## Progress

### T3.1 — Channel schema catalog · **Shipped** (2026-04-22)

- `src-tauri/src/channels.rs` — 8 `ChannelSpec` entries (Telegram /
  Discord / Slack / WhatsApp / Matrix / Feishu / WeChat / WeCom) built
  once via `once_cell::Lazy`. Each spec declares: stable id, display
  name, yaml root (dotted prefix under `channels.*`), env-key names +
  required flag + i18n hint key, yaml fields with `FieldKind`
  (bool / string / string_list) + label key + defaults, a
  `hot_reloadable` flag (default `false`), and a `has_qr_login` flag
  (only WeChat).
- `hermes_config::is_allowed_env_key` extended to accept any name in
  the channel catalog alongside the existing `*_API_KEY` rule — so
  `hermes_env_set_key` can store channel tokens without a separate
  write path per channel.
- **New IPC** `hermes_channel_list` → `Vec<ChannelState>` joining each
  spec with current disk state: an `env_present` map
  (`name → bool`, values never leave Rust) and a `yaml_values` map
  read by walking the config.yaml doc at `yaml_root + "." + path`.
  Runs under `spawn_blocking`.
- **Channels page** now renders the catalog as a read-only grid at
  `/channels` (was a Placeholder): one card per channel with a status
  pill (Configured / Partial / Unconfigured / QR login), env-key
  presence icons, and a collapsible "behavior fields" preview.
- **i18n** `channels.*` namespace in en + zh: title/subtitle, status
  labels, per-channel credential hints, field labels.
- **Tests**: +10 Rust unit tests (catalog invariants — 8 entries,
  unique ids, SCREAMING_SNAKE env names, yaml-root convention; plus
  `walk_dotted` and `yaml_to_json` for the IPC read path). 2 new
  Playwright cases covering all four status buckets.

### T3.2 — Inline channel forms · **Shipped** (2026-04-22)

- **Dynamic form component** (`src/features/channels/ChannelForm.tsx`).
  One component drives all 8 channels from the `ChannelSpec` the
  backend already ships with each card. Bool / string / string_list
  kinds each have a matching input; `EyeOff/Eye` toggle reveals typed
  tokens so users can verify before save. Secrets **never** pre-fill —
  an empty input on a channel whose env is already set means "leave
  unchanged"; typing triggers an upsert.
- **Atomic write IPC** `hermes_channel_save`. Accepts
  `{ id, env_updates, yaml_updates }` where omitted fields are
  untouched. Validates every key against the channel's `ChannelSpec`
  before doing any I/O. Writes happen in two atomic phases via
  `fs_atomic::atomic_write`:
    1. `.env` upserts — one journal entry per env key (so revert
       targets a single credential).
    2. `config.yaml` patch — one journal entry
       (`hermes.channel.yaml`) carrying the before / after maps of
       just the channel's fields.
  Returns the refreshed `ChannelState` so the card updates without a
  second `hermes_channel_list` call.
- **YAML walker with upsert + delete** (`hermes_config::write_channel_yaml_fields`).
  Walks dotted paths, creates missing intermediate mappings, and
  treats a JSON `null` as "delete this field". Every unrelated key
  in `config.yaml` is preserved verbatim via round-trip through
  `serde_yaml::Value`.
- **Diff + confirmation** (`ConfirmDiff` inline panel). After the
  user hits Save, the form computes `{ env, yaml }` diffs; the
  confirmation view renders one row per change with `before → after`.
  Env diffs render presence-only (`set` / `unset`) — the typed value
  is never shown so the card stays screenshot-safe end to end.
- **Restart prompt.** When `hot_reloadable = false` (the default for
  every channel until we have runtime evidence otherwise), a
  post-save amber prompt offers "Restart now" (→
  `hermes_gateway_restart`) or "Later". Never restarts implicitly —
  the user's change is already on disk either way.
- **Env-value safety.** `is_allowed_env_key` remains the choke point;
  the new save path calls `write_env_key` per key, so the same 0o600
  atomic-write + journal entry that the Phase 2 API-key flow uses
  carries channel tokens too.
- **i18n** `channels.*` grew ~15 new keys in en + zh: edit / save /
  cancel / show / hide, env placeholders, list placeholder, the four
  diff strings, the restart prompt labels, no-changes and
  not-hot-reloadable warnings.
- **Tests.** +4 Rust unit tests (walk_set creates intermediates,
  walk_remove preserves siblings, json→yaml round-trip, disk-level
  `write_channel_yaml_fields` with unrelated-field preservation and
  `null = delete` semantics). +2 Playwright cases covering (a) bool
  toggle → diff → save → restart prompt → payload assertion, and
  (b) token fill → diff never leaks the value → card flips to
  Configured without the raw token appearing anywhere in the DOM.

### T3.3 — WeChat QR scaffolding · **Shipped** (2026-04-22)

Shipped the state-machine skeleton + UI; the real Tencent iLink
HTTP client is deliberately deferred until we have credentials to
test against. The surface the frontend talks to is stable and
won't change when the real provider lands.

- **Rust `wechat.rs`** with:
  - `QrProvider` async trait (`start` / `poll` / `cancel`). A thin
    contract — the real iLink impl drops in as a second struct
    without touching the IPC layer.
  - `QrStatus` discriminated union: `Pending` / `Scanning` /
    `Scanned` / `Expired` / `Cancelled` / `Failed { detail }`.
    `is_terminal()` is the single source of truth for "stop
    polling".
  - `StubQrProvider` — deterministic mock that advances on poll
    count (2 Pending, 1 Scanning, 1 Scanned). On `Scanned` it
    writes `WECHAT_SESSION=stub-session-{qr_id}` through
    `hermes_config::write_env_key` so the rest of the app (card
    state, changelog revert) behaves end-to-end.
  - `synth_qr_svg(seed)` — a seeded placeholder SVG (21×21 cells,
    conventional finder patterns, deterministic per id). Zero new
    crates; the real provider returns a proper scannable image and
    this fn is replaced wholesale.
- **Three IPCs** in `ipc/wechat.rs`: `wechat_qr_start`,
  `wechat_qr_poll`, `wechat_qr_cancel`. Each just delegates to
  `state.wechat.provider()`; the `WechatRegistry` on `AppState`
  hides which implementation is wired up.
- **Frontend `WeChatQr.tsx`** — mounted inline inside the WeChat
  card's edit form. Two visible states:
  - *Idle*: intro copy + "Start QR session" CTA.
  - *Active*: inline SVG + status line + Cancel (or "Start over"
    once terminal). Poll cadence is 2s via recursive `setTimeout`
    (never stacking). Unmount triggers a best-effort `cancel`.
- **Card integration** — when the QR panel reports `scanned`, the
  form fires `onWechatScanned`; the card re-reads `ChannelState`
  (so `env_present.WECHAT_SESSION` flips to `true`) and surfaces
  the same amber restart prompt non-hot-reloadable channels show
  after a normal save.
- **i18n** `channels.wechat.*` (en + zh): intro, start/restart/
  cancel, six status lines, expiry countdown, "written by QR"
  marker.
- **Tests**:
  - Rust unit: +5 (stub advances through the full state machine,
    cancel idempotency + wins, unknown-id = NotFound, SVG
    determinism, scanned writes the expected token through
    `write_env_key`).
  - Playwright: +1 covering the whole stub flow — start → QR SVG
    visible → pending → scanning → restart prompt → env_present
    flips. ~10s wall clock because the stub cadence is intentionally
    real-time.

### T3.4 — Live status probing · **Shipped** (2026-04-22)

Hermes exposes no `/health/channels` endpoint, so we derive liveness
from the rolling log files. Read-on-demand, cached for 30s, with a
bypass knob for the user's Refresh button. When upstream grows a
real health endpoint, it drops in as a second backend here without
touching the IPC or UI.

- **Backend `channel_status.rs`**:
  - `LiveState` three-way enum (`Online` / `Offline` / `Unknown`).
    `Unknown` is load-bearing: unconfigured channels or fresh
    installs should never be misreported as down.
  - `classify(id, lines)` scans log lines newest-first for the
    first match combining the channel slug with a known marker:
    positive (`connected`, `ready`, `started`, `online`,
    `subscribed`) or negative (`error`, `failed`, `disconnect`).
    Most-recent-wins so a reconnect after an outage reads right.
  - `probe_all(home_override)` tails `gateway.log` + `agent.log`
    (1000 lines each via `hermes_logs::tail_log_at`) and
    classifies every channel in the catalog. Always returns one
    row per channel in catalog order so the frontend can zip
    against its list without worrying about missing ids.
  - `ChannelStatusCache` — 30s TTL around the full snapshot (not
    per-channel — probing is one fs-read regardless of how many
    channels you ask about, so there's no split-cache benefit).
    `snapshot(force)` bypasses the TTL for the user's refresh.
- **IPC** `hermes_channel_status_list(force)` — thin wrapper
  hopping `spawn_blocking` so the Tokio loop stays snappy while the
  probe's fs-reads run.
- **`ChannelStatusCache` on `AppState`** behind an `Arc`, built
  lazily at startup (no work until the first IPC call).
- **Frontend**:
  - `ChannelsRoute` fetches statuses alongside the catalog on mount
    and keeps them keyed by id at route level (one IPC call
    populates all 8 cards). Two buttons in the header: Probe
    (force-refreshes just status) and Refresh (full reload of
    catalog + status).
  - `LiveStatusPill` sits next to the existing config `StatusPill`.
    Emerald / danger / muted styling for online / offline / unknown.
    The triggering log line is exposed as a `title` tooltip
    (truncated to 160 chars) so power users can see WHICH event
    drove the verdict.
  - Guarded: hidden for `unconfigured` and `qr` statuses — no
    sensible liveness to report for channels with no credentials
    yet or WeChat's QR-only flow.
- **i18n** `channels.probe` + `channels.live.{online,offline,unknown}`
  in en + zh.
- **Tests**:
  - Rust unit: +9 covering `classify` (online/offline/unknown
    resolution, channel-name substring safety wechat vs wecom,
    case-insensitivity, lines without the slug), `probe_all`
    (every catalog row present, Unknown when logs missing), and
    cache semantics (reuse within TTL, force advances probed_at).
  - Playwright: +1 exercising all three render paths — telegram
    (configured → online), matrix (partial → offline), discord
    (unconfigured → no pill) — plus a Probe-button force-refresh
    flipping matrix to online.

### T3.5 — Mobile layout · **Shipped** (2026-04-22)

The card grid already stacks to one column below `sm` (640px), so
the visible layout work here is the edit flow: on narrow viewports
we don't want a form to expand a card past the viewport height.

- **`useIsMobile(maxPx = 720)`** (`src/lib/useIsMobile.ts`) — a
  twelve-line `matchMedia` hook. SSR-safe initial state, re-binds
  on unmount. One call site today; we kept it tiny instead of
  pulling in a media-query library.
- **`Drawer`** (`src/components/ui/drawer.tsx`) — ~70 LoC
  bottom-sheet. Fixed-bottom panel, 88vh max-height, CSS
  transform slide-in via a `drawerUp` keyframe added to
  `tailwind.config.ts`. Click-outside on the backdrop closes;
  ESC closes; `document.body` gets `overflow: hidden` while open
  to prevent iOS / Android's double-scroll feel. Portal'd into
  `document.body` so the card's overflow doesn't clip it.
  Deliberately skipped: swipe-to-dismiss, focus trap, animated
  unmount — each adds state complexity the one call site doesn't
  need yet.
- **`ChannelCard` integration** — extracted the edit / confirm /
  saving / restart-prompt / error JSX into a local
  `renderInteractivePanels()` closure. Desktop renders it inline
  below the read-only summary (unchanged behavior); mobile
  mounts the same node inside `<Drawer>`. `isInteractive` gates
  the drawer mount so the portal doesn't even exist in `view`
  mode. The Drawer's close button + backdrop both route through
  `setMode({ kind: 'view' })` — matching every Cancel / dismiss
  path the inline version already has.
- **Tests**:
  - Playwright: +1 at 375×740 viewport — clicks Edit, asserts
    the drawer mounts outside the `<article>` (portal), the form
    lives inside the drawer not the card, the X button closes it,
    and a backdrop click closes it too.
  - All 6 pre-existing channel tests keep running at the default
    1280×720 desktop viewport — the drawer path never fires, so
    no existing expectations shift.

### Deferred within Phase 3 / follow-ups

- **Real Tencent iLink client** — `ILinkQrProvider` living next to
  `StubQrProvider`, wired in via the same registry. Out-of-scope
  while we lack live credentials + a documented endpoint to hit.
- **Delete-an-existing-secret** affordance. Still via the
  changelog revert or hand-editing `.env`; explicit "Clear"
  button lands once we stop carrying "token presence" as the
  single source of truth.
- **Real health endpoint probe**. If Hermes grows `/health/channels`
  we'd add it as a second backend inside `channel_status.rs` and
  short-circuit the log parse when it answered.
- WhatsApp env name is still a placeholder (`WHATSAPP_TOKEN`).
- Phase-2 deferrals that cluster here: profile tar.gz import /
  export, per-profile gateway start/stop, active-profile
  switching, streaming log tail.
