# Phase 7.5 (T8) · Multi-LLM + multi-Agent console

**Goal**: graduate Corey from "one Hermes gateway, one LLM, one user
typing credentials into config.yaml" into a proper control plane
where the user maintains a **library of named LLM profiles** and
spins up **as many named Hermes agents** as they want, each pointing
at a profile (or its own inline config).

**Est.**: ~3 days solo.

**Status**: **Shipped 2026-04-24 night**.

## Why 7.5 and not 8

Phase 8 is reserved for multimodal (voice + video). T8 was a
parallel-track expansion of the single-model assumption baked into
Phases 0–7; architecturally it's more like a Phase 6 sibling (same
"split the monolithic Hermes config into per-agent state" theme as
T6.2 multi-instance Hermes and T6.5 per-agent sandbox scopes).
Calling it 7.5 keeps Phase 8's scope pristine for when/if multimodal
gets greenlit.

## Exit criteria

All met as of commit `3682cb0`:

1. Users can save an unlimited number of `LlmProfile`s in a library
   (`~/.hermes/llm_profiles.json` or the platform-equivalent config
   dir) with fields `{id, label, provider, base_url, model,
   api_key_env}`.
2. Users can create multiple `HermesInstance` agents, each optionally
   linked to an `LlmProfile` via `llm_profile_id`. Unlinked instances
   still work (hold their config inline, legacy path).
3. The chat composer's agent dropdown lists every registered agent
   with the right display name; selecting routes the next turn to
   that agent's adapter.
4. A guided "Add Agent" wizard covers the typical flow:
   - If profiles exist → show them as primary cards; click one → land
     on a minimal "just name it" screen.
   - Otherwise → the provider template grid (OpenAI / Anthropic /
     DeepSeek / Gemini / Ollama / OpenRouter / Qwen / GLM / Kimi /
     Yi / Baichuan / Hunyuan).
5. Every native `<select>` in the multi-agent flows is replaced with
   the themed `<Select>` (strict) or `<Combobox>` (freeSolo). macOS
   native popup chrome no longer leaks into our dark UI.
6. `hermes_instance_test` works for *every* provider in the template
   list, not just a local Hermes gateway. It uses `GET /v1/models`,
   which every OpenAI-compatible upstream answers.
7. Every destructive action uses the two-click arm-then-fire pattern
   (window.confirm is a known no-op in some Tauri WebView configs).
8. All new strings localized in both `en.json` and `zh.json`.
9. Rust ≥ 211 / Playwright ≥ 81 green.

## Task breakdown

### T8.0 — Preset bundle + install CTA (foundation) · `31ab255`–`070677d`

- Bundled `~/.hermes/` preset gets installed from the app on Home
  "Get started" click (one-shot, idempotent).
- `HermesInstallCard` on Home detects whether the Hermes binary is
  present, offers one-click gateway start if it's installed but not
  running.

### T8.1 — Rust `llm_profiles` module · `a8b4d36`, `1d4d3a2`

- New persisted type `LlmProfile`. File-per-user at
  `<config_dir>/llm_profiles.json`.
- CRUD IPC commands: `llm_profile_list`, `llm_profile_upsert`,
  `llm_profile_delete`, `llm_profile_get`. Mirror of
  `hermes_instance_*` — same validation, same error shape.
- `HermesInstance` gains `llm_profile_id: Option<String>`. When set,
  the runtime adapter copies `{base_url, model, api_key_env}` from
  the profile at turn-resolve time — so profile edits propagate
  without re-registering adapters.

### T8.2 — `/agents` as a top-level route · `eaf0cd4`

- `HermesInstancesSection` moved out of `/settings` into its own
  `app/routes/agents.tsx`. Sidebar link, `⌘4` shortcut.
- Settings keeps a stub note pointing to `/agents` so existing
  muscle memory doesn't end up at a dead link.
- All related Playwright tests (`agent-wizard`, `sandbox-scopes`)
  navigate to `/agents` via client-side link-click (preserves mock
  state across the hop).

### T8.3 — LLM profiles page UI · `a88fd04`, `72306ff`, `5ef8da8`

- `LlmProfilesSection` on `/models`. Responsive card grid (1 col
  mobile / 2 col tablet / 3 col desktop). Each card shows a
  two-letter provider chip, display name, id, model, base_url,
  api_key_env.
- Whole card is a button — tapping jumps to a full-width focused
  edit view; the grid disappears while editing.
- The old single-model config.yaml form (targets
  `~/.hermes/config.yaml`'s `model:` block for the Hermes gateway's
  *default fallback*) collapsed under a `<details>` disclosure
  labeled "Hermes gateway default model" — it was the biggest source
  of first-run clutter complaints.
- Provider is a themed `<Combobox>` (freeSolo). Selecting a template
  REPLACES base_url + api_key_env + suggested model so switching
  providers doesn't keep stale URLs.
- Model is another Combobox with the provider's suggested shortlist;
  user can type a custom fine-tune / new release.
- ID auto-slugs from display-name on create. Manual edit wins.

### T8.4 — Agent wizard redesign · `ed5c767`, `4074f78`, `7ec8991`, `2cd3727`

- Step 1 is now a "source picker":
  - If the user has LLM profiles → render them as golden cards at
    the top. Clicking a profile jumps to a streamlined Step 2 with
    the profile pre-attached (no model picker, no API key input).
  - Provider template grid is always available below as "or start
    fresh from a provider".
- Step 2 (DetailsStep) can still inline-pick a profile mid-flow via
  a themed `<Select>`. When linked, the model picker collapses into
  a summary card.
- Model picker is a `<Combobox>` — freeSolo for fine-tunes the
  template doesn't know about. Refresh-from-`/v1/models` button
  still works, probes with the key the user just typed.
- Every native `<select>` replaced.

### T8.5 — Test-button probe fix · `41e1d25`

- `hermes_instance_test` used to hit `GET /health`. Hermes-only
  endpoint; upstream providers (DeepSeek's governor, OpenAI's edge)
  return 401 for unknown paths and their own "Authentication Fails"
  copy. The test button was lying about valid keys.
- Now hits `GET /v1/models` via the existing probe module. Body
  previews the first few model ids on success so users can
  sanity-check the endpoint actually speaks OpenAI.

### T8.6 — Destructive-action safety · `41e1d25` (partial)

- Replaced `window.confirm()` gates in `LlmProfilesSection` and
  `HermesInstanceRow` with a two-click arm-then-fire pattern:
  first click swaps button to `variant="danger"` with copy "再次点击
  以删除「{label}」" (3s auto-disarm); second click fires. `window.
  confirm` is flaky in the Tauri WebView on macOS — at least one
  user reported silent deletions.

### T8.7 — 国产 LLM templates · `3682cb0`

- 6 high-confidence vendor-official OpenAI-compatible endpoints
  added to `PROVIDER_TEMPLATES`. Every entry includes `setupUrl`
  pointing at the vendor's API-key console:
  - 通义千问 (Qwen / 阿里百炼) — `DASHSCOPE_API_KEY`
  - 智谱 GLM — `ZHIPUAI_API_KEY`
  - 月之暗面 Kimi — `MOONSHOT_API_KEY`
  - 零一万物 Yi — `YI_API_KEY`
  - 百川 Baichuan — `BAICHUAN_API_KEY`
  - 腾讯混元 — `HUNYUAN_API_KEY`

### T8.8 — i18n sweep · `a4604f6`

- Audit-and-fix pass: `/models` legacy form (Reload, Discover, Model
  id, Save to config.yaml, Restart banner); SessionsPanel ("Sessions"
  / "New" / aria-label); AgentWizard profile-summary env chip.
- Both `en.json` and `zh.json` kept in lockstep.

## Explicitly deferred

- **字节豆包 (Volcengine Ark)**. OpenAI-compatible in theory but
  requires the user to create an "inference endpoint" in the vendor
  console first and use `ep-xxxxx` endpoint ids (not model names).
  Adding a template without bespoke UI accommodations would fail
  first-run for every user. Parked until someone needs it.
- **百度文心 (Qianfan)**. Auth is split across legacy AK/SK
  pair-auth and newer Bearer tokens; OpenAI-compat mode has edge
  cases. Needs an adapter-side branch, not a template entry.
- **Masonic card grid + right-side Drawer editor**. User picked the
  lightweight "card → full-screen focused edit" UX. The fancier
  version (hover animations, Drawer-with-backdrop, transition
  preserving scroll position) is parked.
- **Card-based wizard DetailsStep**. Step 2 is still a vertical
  form stack. Works fine; not a priority.

## Follow-up candidates (future)

- Reachability probe in `LlmProfileCard` — badge ✅ green / ⚠ gray
  if the most recent `hermes_instance_test` against that profile's
  base URL succeeded. Would require either a background probe worker
  or lazy-on-first-render ping.
- Profile import/export (YAML or JSON) for sharing configs
  across machines.
- Bulk "edit all profiles using env var X" action for users who
  rotate API keys.
