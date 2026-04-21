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
