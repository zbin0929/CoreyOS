# Hermes Agent reality check · 2026-04-23

After the user shared the canonical upstream URL — <https://github.com/NousResearch/hermes-agent> — this document reconciles our Corey UI assumptions with the actual Hermes Agent schema. The findings materially change Phase 3 (channels), Phase 6 T6.7, and Phase 7 T7.4.

## Who Hermes Agent actually is

- **Owner**: Nous Research (not EKKOLearnAI or any unofficial fork).
- **Language**: Python, `uv`-managed, MIT license.
- **CLI entry points**: `hermes`, `hermes gateway`, `hermes model`, `hermes tools`, `hermes setup`, `hermes claw migrate`.
- **Config home**: `~/.hermes/` (matches our assumption ✓).
- **API server port**: `API_SERVER_PORT=8642`, `/v1/*` OpenAI-compatible (matches our `HermesGateway` client — see `@/Users/zbin/AI项目/hermes_ui/src-tauri/src/adapters/hermes/gateway.rs:46-48` ✓).
- **Relationship to OpenClaw**: OpenClaw has been **merged/migrated into Hermes Agent**, not a peer competitor. `hermes claw migrate` auto-imports `~/.openclaw/` settings, memories, skills, API keys. This invalidates our previous Phase 7 T7.4 OpenClaw positioning.

## Chat / LLM integration — ALIGNED ✓

Our `HermesAdapter` talks to `http://127.0.0.1:8642/health`, `/v1/models`, `/v1/chat/completions`. This is exactly what Hermes Agent's `API_SERVER_ENABLED` gateway exposes. No changes needed on the chat path.

## Channel schema reconciliation — **3 of 8 BROKEN**

| Corey channel | Our env name(s) | Hermes actual env name(s) | Status |
|---|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | ✅ **correct** |
| Discord | `DISCORD_BOT_TOKEN` | `DISCORD_BOT_TOKEN` | ✅ **correct** |
| Slack | `SLACK_BOT_TOKEN` | `SLACK_BOT_TOKEN` + **`SLACK_APP_TOKEN`** | ⚠️ **incomplete** — Hermes Slack integration uses Socket Mode which requires **both**. We only expose one. Slack will silently fail to start until both are set. |
| WhatsApp | `WHATSAPP_TOKEN` | **NO SUCH KEY**. Real: `WHATSAPP_ENABLED`, `WHATSAPP_MODE` (`bot` or `self-chat`), `WHATSAPP_ALLOWED_USERS`, `WHATSAPP_ALLOW_ALL_USERS` | ❌ **completely wrong**. We never wrote to any variable Hermes reads. |
| Matrix | `MATRIX_ACCESS_TOKEN`, `MATRIX_HOMESERVER` | Same, plus optional `MATRIX_USER_ID`, `MATRIX_PASSWORD`, `MATRIX_HOME_ROOM`, `MATRIX_ENCRYPTION`, `MATRIX_DEVICE_ID`, `MATRIX_REACTIONS`, `MATRIX_REQUIRE_MENTION`, `MATRIX_AUTO_THREAD`, `MATRIX_RECOVERY_KEY` | ✅ **correct but minimal** — basic path works; advanced features (E2EE, reactions, auto-thread) unreachable from UI. |
| Feishu (Lark) | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` | Same, plus `FEISHU_DOMAIN` (`feishu`/`lark`), `FEISHU_CONNECTION_MODE` (`websocket`/`webhook`), `FEISHU_ENCRYPT_KEY`, `FEISHU_VERIFICATION_TOKEN` | ✅ **correct but minimal** — Lark (non-CN) mode and webhook mode unreachable. |
| WeCom | `WECOM_BOT_ID`, **`WECOM_BOT_SECRET`** | `WECOM_BOT_ID`, **`WECOM_SECRET`** (no `BOT_` prefix). Plus `WECOM_WEBSOCKET_URL`, `WECOM_ALLOWED_USERS`, `WECOM_CALLBACK_*` | ❌ **typo'd env name**. Our save will land in an unread variable. |
| WeChat (个人) | `WECHAT_SESSION` via stub QR flow | **NO SUCH KEY**. Real: `WEIXIN_ACCOUNT_ID`, `WEIXIN_TOKEN`, `WEIXIN_BASE_URL` (defaults to `https://ilinkai.weixin.qq.com`), `WEIXIN_DM_POLICY`, `WEIXIN_GROUP_POLICY`, etc. | ❌ **entire schema wrong + the QR UX is fictional**. Hermes hits iLink directly with a plain token — no QR scan flow. Our `StubQrProvider` + "future iLink client" backlog item is obsolete. |

**Summary**: of 8 channels, **3 are silently broken** (WhatsApp, WeCom, WeChat), **1 is incomplete** (Slack missing App Token), and **3 work correctly but expose only a subset** (Matrix, Feishu, the rest).

## Channels Hermes supports that we don't surface

Hermes Agent's full messaging matrix includes, beyond our 8:

- **Signal** (`SIGNAL_HTTP_URL`, `SIGNAL_ACCOUNT`, `SIGNAL_ALLOWED_USERS`)
- **SMS** via Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SMS_WEBHOOK_*`)
- **Email** via IMAP/SMTP (`EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_IMAP_HOST`, ...)
- **DingTalk (钉钉)** (`DINGTALK_CLIENT_ID`, `DINGTALK_CLIENT_SECRET`)
- **QQ (official bot)** (`QQ_APP_ID`, `QQ_CLIENT_SECRET`, `QQ_STT_*`, `QQ_SANDBOX`)
- **BlueBubbles (iMessage bridge)** (`BLUEBUBBLES_SERVER_URL`, `BLUEBUBBLES_PASSWORD`, ...)
- **Mattermost** (`MATTERMOST_URL`, `MATTERMOST_TOKEN`, ...)
- **Home Assistant** (`HASS_TOKEN`, `HASS_URL`)
- **Webhooks** (`WEBHOOK_ENABLED`, `WEBHOOK_PORT`, `WEBHOOK_SECRET`)
- **OpenAI-compatible API server** (`API_SERVER_*` — already what our adapter uses for chat; unrelated to messaging)

10 channels we could expose with the same config-writing plumbing we already have.

## Impact on existing plans

### Phase 3 (shipped) carries 3 live bugs

- `WHATSAPP_TOKEN` never reaches Hermes.
- `WECOM_BOT_SECRET` never reaches Hermes (should be `WECOM_SECRET`).
- `WECHAT_SESSION` never reaches Hermes (should be three `WEIXIN_*` keys, and the QR UX should be a plain text input).

A hotfix PR can land these in ~1 day: update `src-tauri/src/channels.rs` catalog, update i18n labels, remove the Stub QR provider and related IPC, add WeChat/WeiXin schema fields.

### Phase 6 T6.7 must expand

Original T6.7 was "prove Telegram end-to-end". That still stands but T6.7 now also absorbs:

- Fix the 3 broken channel schemas.
- Close the "Tencent iLink real QR client" backlog item (it's obsolete — no QR flow exists upstream).
- Decide whether to add Slack App Token field (Socket Mode requirement).

New T6.7 estimate: **~5 days** (up from 3).

### Phase 7 T7.4 OpenClaw — **mostly obsolete**

OpenClaw is being migrated into Hermes. Implications:

- **T7.4a OpenClawAdapter** — **drop**. There's no parallel control plane to bridge to; `hermes claw migrate` is the migration path and it runs inside Hermes CLI, not something Corey adapts.
- **T7.4b ClawHub skill importer** — **retain but re-scope**. Hermes uses `agentskills.io` as its open standard, not ClawHub directly. The importer should target the `agentskills.io` registry (or the migrated `~/.hermes/skills/openclaw-imports/` directory) not ClawHub URLs.
- **Positioning update**: remove the "OpenClaw as peer competitor" framing from `docs/00-vision.md`. OpenClaw is legacy.

### Backlog items to close

- **Tencent iLink real QR client** → close as "obsolete — no QR flow exists in Hermes".
- **WhatsApp env name** → close as part of T6.7 schema fix.
- **`/health/channels` probe** → still deferred (Hermes doesn't expose it today).

## Redundancy check — do we duplicate Hermes features?

Hermes already ships:

- **Cron scheduler** (`Cron Scheduling` in docs) with platform delivery. **Our Phase-MVP Scheduler overlaps**. Two questions:
  - Does Corey's Scheduler write to `~/.hermes/` or to its own SQLite?
  - If Hermes runs cron natively, should Corey's Scheduler become a **view/editor for Hermes cron jobs** rather than a parallel runner?
- **Skills system** with Skills Hub — overlaps with our Phase 4 Skills editor. Should audit alignment.
- **Subagent delegation** (`delegate_task` tool) — overlaps substantially with our Phase 6 T6.3 orchestrator design. If Hermes already does supervisor/worker, our "Orchestrator meta-adapter" may just need to **surface Hermes' native delegation** rather than invent its own JSON protocol.
- **FTS5 session search + memory** — overlaps with Phase 7 T7.3 memory layer. Could be a pass-through rather than a separate qdrant.
- **MCP integration** — not in our plan at all; Hermes supports any MCP server.

**Strong implication**: much of Phase 6 / 7's value becomes **"surface Hermes' native capabilities in the UI"** rather than **"build parallel capabilities client-side"**. This is a welcome trim — less code, more alignment.

## Recommended immediate actions

Ordered by ROI:

1. **Channel schema hotfix** (~1 day) — fix WhatsApp, WeCom, WeChat. High-value, low-risk. Unblocks any real smoke test.
2. **Update `docs/00-vision.md`** — correct the OpenClaw positioning, remove the "peer competitor" framing.
3. **Update Phase 6 T6.7** and **Phase 7 T7.4** — scope changes documented above.
4. **Close obsolete backlog items** — iLink QR, WhatsApp env name.
5. **Redundancy audit** — for each of Scheduler / Skills / Orchestrator / Memory, ask "surface Hermes' or build parallel?" This probably kills ~30% of Phase 6/7 task volume.
6. **Decide on adding new channels** — Signal / DingTalk / QQ / Email are compelling. Each is a small card in `channels.rs`.

## Lessons learned

- We built Phase 3 against **inferred** Hermes behaviour rather than reading upstream docs. The WhatsApp env name was flagged as "TBD" in the code comments but never followed up. Three of eight channels silently broken is the cost.
- The "OpenClaw as peer" framing was based on reading OpenClaw's own README without cross-checking Hermes'. Twenty minutes of reading the right upstream docs would have saved an entire phase's worth of integration design.
- **Rule**: any future claim about upstream behaviour must cite a docs URL or a source file path. No more inferred integration.
