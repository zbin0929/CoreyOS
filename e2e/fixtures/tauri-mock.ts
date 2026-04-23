/**
 * Tauri IPC mock that runs INSIDE the page (via page.addInitScript).
 *
 * We emulate just enough of `window.__TAURI_INTERNALS__` for the app's
 * imports of `@tauri-apps/api/core` and `@tauri-apps/api/event` to resolve:
 *   - `invoke(cmd, args)` → dispatched by command name below.
 *   - `transformCallback(fn)` → registers `fn` and returns an id.
 *   - `plugin:event|listen` / `|unlisten` / `|emit` → in-memory pub/sub.
 *
 * Tests can reach into `window.__CADUCEUS_MOCK__` to mutate fixtures
 * before triggering UI actions, and can override per-command handlers
 * via `window.__CADUCEUS_MOCK__.on(cmd, handler)` (handler wins over
 * the defaults and can itself call `emit(event, payload)`).
 */

/** The script below is stringified and injected verbatim by Playwright. */
export const tauriMockInitScript = /* js */ `
(function() {
  // ── callback registry (for transformCallback) ──
  const callbacks = new Map();
  let nextCallbackId = 1;

  // ── event plugin state ──
  const listenersByEvent = new Map(); // event -> Map(eventRegId -> callbackId)
  let nextEventRegId = 1;
  let nextEventDispatchId = 1;

  // ── user-editable fixture state ──
  const state = {
    homeStats: { path: '/tmp/caduceus', entry_count: 3, sandbox_mode: 'dev-allow' },
    // T3.2 channel state — kept as mutable state so save round-trips.
    // Shape mirrors the hermes_channel_list response exactly.
    channels: /** @type {any[]} */ ([
      {
        id: 'telegram',
        display_name: 'Telegram',
        yaml_root: 'channels.telegram',
        env_keys: [{ name: 'TELEGRAM_BOT_TOKEN', required: true }],
        yaml_fields: [
          { path: 'mention_required', kind: 'bool', label_key: 'channels.field.mention_required', default_bool: true },
          { path: 'reactions', kind: 'bool', label_key: 'channels.field.reactions', default_bool: true },
        ],
        hot_reloadable: false,
        has_qr_login: false,
        env_present: { TELEGRAM_BOT_TOKEN: true },
        yaml_values: { mention_required: true, reactions: false },
      },
      {
        id: 'discord',
        display_name: 'Discord',
        yaml_root: 'channels.discord',
        env_keys: [{ name: 'DISCORD_BOT_TOKEN', required: true }],
        yaml_fields: [],
        hot_reloadable: false,
        has_qr_login: false,
        env_present: { DISCORD_BOT_TOKEN: false },
        yaml_values: {},
      },
      {
        id: 'matrix',
        display_name: 'Matrix',
        yaml_root: 'channels.matrix',
        env_keys: [
          { name: 'MATRIX_ACCESS_TOKEN', required: true },
          { name: 'MATRIX_HOMESERVER', required: true },
        ],
        yaml_fields: [],
        hot_reloadable: false,
        has_qr_login: false,
        env_present: { MATRIX_ACCESS_TOKEN: true, MATRIX_HOMESERVER: false },
        yaml_values: {},
      },
      {
        id: 'wechat',
        display_name: 'WeChat',
        yaml_root: '',
        env_keys: [{ name: 'WECHAT_SESSION', required: false }],
        yaml_fields: [],
        hot_reloadable: false,
        has_qr_login: true,
        env_present: { WECHAT_SESSION: false },
        yaml_values: {},
      },
    ]),
    // Captured save payloads, so tests can assert the exact
    // env_updates / yaml_updates the UI sent.
    channelSaves: /** @type {any[]} */ ([]),
    // T3.3 WeChat QR stub. Each wechat_qr_start mints a new id;
    // subsequent wechat_qr_poll calls advance on the same cadence
    // the Rust stub uses (2 pending, 1 scanning, then scanned). On
    // scanned we flip WECHAT_SESSION on the WeChat card so the UI
    // sees the same end state the real backend would produce.
    wechatSessions: /** @type {any} */ ({}),
    // T4.6 Runbooks — mutable in-memory list.
    runbooks: /** @type {any[]} */ ([]),
    // T4.2 Skills — in-memory file tree. Keyed by relative posix path.
    skills: /** @type {Record<string, { body: string; updated_at_ms: number }>} */ ({}),
    // T4.5 PTY ids currently alive in the mock. Tests can count or
    // assert; the real backend's pty state isn't reachable from JS.
    ptyIds: /** @type {string[]} */ ([]),
    // T4.4 Budgets — mutable in-memory list.
    budgets: /** @type {any[]} */ ([]),
    // T3.4: per-channel live-status overrides keyed by channel id.
    // Tests push values here via page.evaluate() before navigating
    // so the first hermes_channel_status_list call returns the
    // verdict under test; default "unknown" is what a fresh install
    // with no logs would report.
    channelStatuses: /** @type {any} */ ({}),
    // T2.7 profile fixture. The mock treats the list as mutable state so
    // create/rename/delete/clone round-trip through the same array the UI
    // reads back in its subsequent hermes_profile_list call.
    profilesRoot: '/Users/test/.hermes/profiles',
    profilesActive: 'dev',
    profiles: [
      { name: 'dev', is_active: true, updated_at: 1714000000000 },
      { name: 'prod', is_active: false, updated_at: 1713000000000 },
    ],
    // Fixture lines for hermes_log_tail, keyed by kind. Tests can override
    // lines or missing at runtime via window.__CADUCEUS_MOCK__.state.
    hermesLogs: {
      agent: {
        missing: false,
        path: '/Users/test/.hermes/logs/agent.log',
        lines: [
          '2026-04-22 15:12:03 INFO  agent boot',
          '2026-04-22 15:12:04 INFO  loaded 3 skills',
          '2026-04-22 15:12:12 WARN  rate limiter near cap',
          '2026-04-22 15:12:20 ERROR upstream 503 on /v1/chat',
        ],
      },
      gateway: {
        missing: false,
        path: '/Users/test/.hermes/logs/gateway.log',
        lines: [
          '2026-04-22 15:12:02 INFO  listening on 127.0.0.1:8642',
          '2026-04-22 15:12:10 INFO  POST /v1/chat/completions 200 1.8s',
        ],
      },
      error: {
        missing: true,
        path: '/Users/test/.hermes/logs/error.log',
        lines: [],
      },
    },
    /** Canned result for app_paths. Tests can override by mutating this. */
    appPaths: {
      config_dir: '/Users/test/Library/Application Support/com.caduceus.app',
      data_dir: '/Users/test/Library/Application Support/com.caduceus.app',
      db_path: '/Users/test/Library/Application Support/com.caduceus.app/caduceus.db',
      changelog_path:
        '/Users/test/Library/Application Support/com.caduceus.app/changelog.jsonl',
    },
    config: {
      base_url: 'http://127.0.0.1:8642',
      api_key: null,
      default_model: 'hermes-agent',
    },
    hermesConfig: {
      config_path: '/tmp/.hermes/config.yaml',
      present: true,
      model: {
        default: 'deepseek-chat',
        // Use a slug that exists in PROVIDER_CATALOG so the ApiKeyPanel
        // renders — otherwise the "DEEPSEEK_API_KEY is set" badge won't
        // appear and the env-key assertion has nothing to grab onto.
        provider: 'deepseek',
        base_url: 'https://api.deepseek.com/v1',
      },
      env_keys_present: ['DEEPSEEK_API_KEY'],
    },
    models: [
      {
        id: 'hermes-agent',
        provider: 'hermes',
        display_name: 'Hermes',
        context_window: 200000,
        is_default: true,
        capabilities: { vision: false, tool_use: true, reasoning: true },
      },
    ],
    sessions: [],
    /** Canned reply emitted chunk-by-chunk when chat_stream_start fires. */
    chatReply: 'Hello from the mock gateway.',
    /** Seed payload returned by analytics_summary. Tests can override. */
    analytics: {
      totals: {
        sessions: 42,
        messages: 137,
        tool_calls: 58,
        active_days: 12,
        prompt_tokens: 82_345,
        completion_tokens: 61_210,
        total_tokens: 143_555,
      },
      messages_per_day: [
        { date: isoDaysAgo(5), count: 9 },
        { date: isoDaysAgo(3), count: 14 },
        { date: isoDaysAgo(1), count: 6 },
      ],
      tokens_per_day: [
        { date: isoDaysAgo(5), count: 12_400 },
        { date: isoDaysAgo(3), count: 51_120 },
        { date: isoDaysAgo(1), count: 8_880 },
      ],
      model_usage: [
        { name: 'deepseek-chat', count: 28 },
        { name: 'claude-3-5-sonnet', count: 10 },
        { name: 'gpt-4o', count: 4 },
      ],
      tool_usage: [
        { name: 'terminal', count: 20 },
        { name: 'file_read', count: 18 },
        { name: 'web_search', count: 9 },
      ],
      // T5.6 — the Analytics route destructures adapter_usage; mocks
      // without this key crash the render (undefined.map).
      adapter_usage: [
        { name: 'hermes', count: 36 },
        { name: 'claude_code', count: 5 },
        { name: 'aider', count: 1 },
      ],
      generated_at: Date.now(),
    },
    /** Mutable journal backing changelog_list / changelog_revert. The mock
     *  appends entries on hermes_config_write_model so the revert roundtrip
     *  is testable end-to-end. */
    changelog: [],
  };

  function isoDaysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  // ── user-supplied per-command overrides ──
  const overrides = new Map();

  function emit(event, payload) {
    const regs = listenersByEvent.get(event);
    if (!regs) return;
    for (const cbId of regs.values()) {
      const cb = callbacks.get(cbId);
      if (cb) cb({ event, id: nextEventDispatchId++, payload });
    }
  }

  async function handle(cmd, args) {
    // Per-command overrides win first.
    if (overrides.has(cmd)) {
      return overrides.get(cmd)(args, { state, emit });
    }

    // ── tauri event plugin ──
    if (cmd === 'plugin:event|listen') {
      const id = nextEventRegId++;
      const bucket = listenersByEvent.get(args.event) ?? new Map();
      bucket.set(id, args.handler); // args.handler is the callback id
      listenersByEvent.set(args.event, bucket);
      return id;
    }
    if (cmd === 'plugin:event|unlisten') {
      listenersByEvent.get(args.event)?.delete(args.eventId);
      return;
    }
    if (cmd === 'plugin:event|emit') {
      emit(args.event, args.payload);
      return;
    }

    // ── app commands ──
    switch (cmd) {
      case 'home_stats':
        return state.homeStats;

      case 'app_paths':
        return state.appPaths;

      case 'hermes_channel_list': {
        // Return a deep clone so the UI can't accidentally mutate
        // the fixture by reference.
        return JSON.parse(JSON.stringify(state.channels));
      }

      case 'hermes_channel_status_list': {
        // T3.4: return a deterministic probe snapshot. Tests that
        // want different verdicts can override state.channelStatuses
        // before the first page visit. force=true is a no-op for the
        // mock (no real cache to bypass).
        const now = Date.now();
        return state.channels.map((c) => {
          const override = state.channelStatuses?.[c.id];
          return {
            id: c.id,
            state: override?.state ?? 'unknown',
            last_marker: override?.last_marker ?? null,
            probed_at_ms: now,
          };
        });
      }

      case 'wechat_qr_start': {
        const qrId = 'stub-' + Math.random().toString(36).slice(2);
        state.wechatSessions[qrId] = {
          pollCount: 0,
          status: { kind: 'pending' },
          cancelled: false,
          createdAt: Date.now(),
        };
        return {
          qr_id: qrId,
          // Tiny inline SVG placeholder — the real backend returns a
          // much richer one but the test only asserts on testid, not
          // pixel count.
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>',
          expires_in_s: 300,
        };
      }

      case 'wechat_qr_poll': {
        const s = state.wechatSessions[args.qrId];
        if (!s) throw { kind: 'internal', message: 'qr session expired: ' + args.qrId };
        if (s.status.kind && ['scanned', 'expired', 'cancelled', 'failed'].includes(s.status.kind)) {
          return {
            qr_id: args.qrId,
            status: s.status,
            elapsed_s: Math.floor((Date.now() - s.createdAt) / 1000),
          };
        }
        s.pollCount += 1;
        if (s.pollCount <= 2) s.status = { kind: 'pending' };
        else if (s.pollCount <= 3) s.status = { kind: 'scanning' };
        else {
          s.status = { kind: 'scanned' };
          // Flip env_present on the WeChat fixture row so the card
          // refresh sees the new credential state.
          const w = state.channels.find((c) => c.id === 'wechat');
          if (w) w.env_present.WECHAT_SESSION = true;
        }
        return {
          qr_id: args.qrId,
          status: s.status,
          elapsed_s: Math.floor((Date.now() - s.createdAt) / 1000),
        };
      }

      case 'wechat_qr_cancel': {
        const s = state.wechatSessions[args.qrId];
        if (!s) throw { kind: 'internal', message: 'qr session expired: ' + args.qrId };
        if (!['scanned', 'expired', 'cancelled', 'failed'].includes(s.status.kind)) {
          s.status = { kind: 'cancelled' };
        }
        return null;
      }

      case 'hermes_channel_save': {
        const payload = args.args;
        const row = state.channels.find((c) => c.id === payload.id);
        if (!row) {
          throw { kind: 'internal', message: 'unknown channel id: ' + payload.id };
        }
        // Record the exact patch the UI sent so the test can assert
        // against env_updates + yaml_updates without reading files.
        state.channelSaves.push(payload);
        // Apply env updates to the env_present map (values never
        // flow through the mock; we only flip booleans).
        const env = payload.env_updates || {};
        for (const key of Object.keys(env)) {
          const v = env[key];
          row.env_present[key] = typeof v === 'string' && v.length > 0;
        }
        // Apply yaml updates.
        const ymu = payload.yaml_updates || {};
        for (const path of Object.keys(ymu)) {
          const val = ymu[path];
          if (val === null) delete row.yaml_values[path];
          else row.yaml_values[path] = val;
        }
        return JSON.parse(JSON.stringify(row));
      }

      case 'hermes_profile_list': {
        return {
          root: state.profilesRoot,
          missing_root: false,
          active: state.profilesActive,
          profiles: state.profiles.map((p) => ({
            name: p.name,
            path: state.profilesRoot + '/' + p.name,
            is_active: p.name === state.profilesActive,
            updated_at: p.updated_at,
          })),
        };
      }
      case 'hermes_profile_create': {
        if (state.profiles.some((p) => p.name === args.name)) {
          throw new Error('profile already exists: ' + args.name);
        }
        const row = { name: args.name, is_active: false, updated_at: Date.now() };
        state.profiles.push(row);
        return {
          name: row.name,
          path: state.profilesRoot + '/' + row.name,
          is_active: false,
          updated_at: row.updated_at,
        };
      }
      case 'hermes_profile_rename': {
        const row = state.profiles.find((p) => p.name === args.from);
        if (!row) throw new Error('not found: ' + args.from);
        if (state.profiles.some((p) => p.name === args.to)) {
          throw new Error('already exists: ' + args.to);
        }
        row.name = args.to;
        if (state.profilesActive === args.from) state.profilesActive = args.to;
        return;
      }
      case 'hermes_profile_delete': {
        if (args.name === state.profilesActive) {
          throw new Error('refusing to delete active profile');
        }
        const i = state.profiles.findIndex((p) => p.name === args.name);
        if (i < 0) throw new Error('not found: ' + args.name);
        state.profiles.splice(i, 1);
        return;
      }
      case 'hermes_profile_clone': {
        if (state.profiles.some((p) => p.name === args.dst)) {
          throw new Error('already exists: ' + args.dst);
        }
        const row = { name: args.dst, is_active: false, updated_at: Date.now() };
        state.profiles.push(row);
        return {
          name: row.name,
          path: state.profilesRoot + '/' + row.name,
          is_active: false,
          updated_at: row.updated_at,
        };
      }

      case 'hermes_log_tail': {
        const bucket = state.hermesLogs[args.kind];
        if (!bucket) {
          return { path: '', missing: true, lines: [], total_lines: 0 };
        }
        return {
          path: bucket.path,
          missing: bucket.missing,
          lines: bucket.lines,
          total_lines: bucket.lines.length,
        };
      }

      case 'config_get':
        return state.config;
      case 'config_set':
        state.config = { ...state.config, ...args.config };
        return;
      case 'config_test':
        return { latency_ms: 12, body: 'ok' };

      case 'hermes_config_read':
        return state.hermesConfig;
      case 'hermes_config_write_model': {
        // Journal the change before flipping state so the revert can replay
        // the original before-model.
        const beforeModel = state.hermesConfig.model;
        const afterModel = args.model;
        const nowIso = new Date().toISOString();
        state.changelog.unshift({
          id: nowIso + '-' + state.changelog.length,
          ts: nowIso,
          op: 'hermes.config.model',
          before: beforeModel,
          after: afterModel,
          summary:
            'default: ' +
            (beforeModel.default || 'empty') +
            ' -> ' +
            (afterModel.default || 'empty'),
        });
        state.hermesConfig = { ...state.hermesConfig, model: afterModel };
        return state.hermesConfig;
      }
      case 'hermes_env_set_key': {
        const next = new Set(state.hermesConfig.env_keys_present);
        if (args.value) next.add(args.key);
        else next.delete(args.key);
        state.hermesConfig = {
          ...state.hermesConfig,
          env_keys_present: [...next],
        };
        return state.hermesConfig;
      }
      case 'hermes_gateway_restart':
        return 'gateway restarted (mock)';

      case 'model_list':
        return state.models;

      case 'model_provider_probe': {
        // Echo a deterministic three-model report so the Discover UX is
        // testable without network. Endpoint mirrors the normalized form.
        // NOTE: this file is stringified + injected, so NO template literals
        // here — they would break the outer backtick string.
        const raw = String(args.baseUrl || '').replace(/\\/+$/, '');
        const endpoint = raw.endsWith('/v1/models')
          ? raw
          : raw.endsWith('/v1')
            ? raw + '/models'
            : raw + '/v1/models';
        return {
          endpoint: endpoint,
          latency_ms: 42,
          models: [
            { id: 'mock-large', owned_by: 'mock' },
            { id: 'mock-medium', owned_by: 'mock' },
            { id: 'mock-small', owned_by: 'mock' },
          ],
        };
      }

      case 'changelog_list':
        return state.changelog.slice(0, args.limit || 100);

      case 'changelog_revert': {
        const target = state.changelog.find((e) => e.id === args.entryId);
        if (!target) {
          throw { kind: 'not_configured', hint: 'entry not found' };
        }
        if (target.op === 'hermes.env.key') {
          throw { kind: 'unsupported', capability: 'env key revert' };
        }
        if (target.op !== 'hermes.config.model') {
          throw { kind: 'unsupported', capability: 'revert for op ' + target.op };
        }
        // Restore the before-model; the act of writing appends a fresh entry
        // via the hermes_config_write_model handler above.
        const restored = target.before || {};
        state.hermesConfig = { ...state.hermesConfig, model: restored };
        const nowIso = new Date().toISOString();
        const revertEntry = {
          id: nowIso + '-' + state.changelog.length,
          ts: nowIso,
          op: 'hermes.config.model',
          before: target.after,
          after: target.before,
          summary:
            'default: ' +
            ((target.after && target.after.default) || 'empty') +
            ' -> ' +
            ((target.before && target.before.default) || 'empty'),
        };
        state.changelog.unshift(revertEntry);
        return { revert_entry: revertEntry };
      }

      case 'db_load_all':
        return state.sessions;
      case 'db_session_upsert':
      case 'db_session_delete':
      case 'db_message_upsert':
      case 'db_message_set_usage':
      case 'db_tool_call_append':
        return;

      // T1.5 — attachments. Backend-side: we simulate the on-disk
      // staging by synthesising a path and returning metadata. The
      // bytes themselves are discarded — e2e tests only care about
      // the metadata round-trip through the UI + zustand + DB mock.
      case 'attachment_stage_blob': {
        const id = 'att-' + Math.random().toString(36).slice(2, 10);
        const ext = (args.name || '').split('.').pop() || 'bin';
        return {
          id,
          name: args.name,
          mime: args.mime,
          size: Math.max(1, Math.floor(((args.base64Body?.length || 0) * 3) / 4)),
          path: '/mock/home/.hermes/attachments/' + id + '.' + ext,
          created_at: Date.now(),
        };
      }
      case 'attachment_stage_path': {
        const id = 'att-' + Math.random().toString(36).slice(2, 10);
        // basename: normalise Windows backslashes to forward-slashes then
        // split. Avoids a regex char class, which the browser engine
        // once mis-parsed when this whole file is injected as a single
        // template-literal blob.
        const rawPath = args.path || '';
        const name = rawPath.split('\\\\').join('/').split('/').pop() || 'unknown';
        const ext = name.split('.').pop() || 'bin';
        return {
          id,
          name,
          mime: args.mimeHint || 'application/octet-stream',
          size: 1024,
          path: '/mock/home/.hermes/attachments/' + id + '.' + ext,
          created_at: Date.now(),
        };
      }
      case 'attachment_delete':
      case 'db_attachment_insert':
      case 'db_attachment_delete':
        return;

      // T1.5d — preview: in browser-e2e there's no actual on-disk file,
      // so we return a tiny embedded 1x1 PNG data URL whose round-trip
      // proves the IPC plumbing. Tests can assert on the data-attr or
      // the img-src prefix without depending on a real image. (String
      // concat, not template literals — the whole mock lives inside an
      // outer backtick-delimited string and nested backticks would
      // close the outer template early.)
      case 'attachment_preview': {
        const mime =
          (args.mime && String(args.mime).indexOf('image/') === 0 && String(args.mime)) ||
          'image/png';
        const ONE_PX_PNG_B64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        return 'data:' + mime + ';base64,' + ONE_PX_PNG_B64;
      }

      // T1.5e — GC: the mock has no disk state, so there's nothing to
      // sweep. Return an empty report so the caller's telemetry logs
      // cleanly in browser-mode runs.
      case 'attachment_gc':
        return { removed_count: 0, removed_bytes: 0, failed: [] };

      case 'analytics_summary':
        return state.analytics;

      case 'chat_send':
        return { content: state.chatReply };

      case 'chat_stream_start': {
        // Shape matches the real Rust IPC: args.args = { messages, model, handle }.
        const h = args.args.handle;
        // T4.1: include the model id in the reply so Compare lanes are
        // visibly distinguishable in tests. Falls back to the generic
        // reply for older consumers (chat feature).
        const modelId = args.args.model;
        const reply = modelId
          ? state.chatReply + ' [model=' + modelId + ']'
          : state.chatReply;
        // Emit two deltas then done — on a microtask so \`listen\` returns first.
        queueMicrotask(() => {
          emit('chat:delta:' + h, reply.slice(0, 5));
          setTimeout(() => emit('chat:delta:' + h, reply.slice(5)), 10);
          setTimeout(
            () =>
              emit('chat:done:' + h, {
                finish_reason: 'stop',
                model: modelId || 'mock',
                latency_ms: 42,
                prompt_tokens: 10,
                completion_tokens: 5,
              }),
            20,
          );
        });
        return h;
      }
      case 'chat_stop':
        return;

      // T4.6 Runbooks — simple in-memory CRUD keyed by id.
      case 'runbook_list':
        return [...state.runbooks];
      case 'runbook_upsert': {
        const rb = args.runbook;
        const idx = state.runbooks.findIndex((r) => r.id === rb.id);
        if (idx >= 0) state.runbooks[idx] = rb;
        else state.runbooks.unshift(rb);
        return;
      }
      case 'runbook_delete':
        state.runbooks = state.runbooks.filter((r) => r.id !== args.id);
        return;

      // T4.2 Skills — in-memory file system keyed by relative path.
      case 'skill_list': {
        const rows = Object.entries(state.skills).map(([path, entry]) => {
          const segs = path.split('/');
          const name = segs[segs.length - 1].replace(/\.md$/i, '');
          const group = segs.length > 1 ? segs.slice(0, -1).join('/') : null;
          return {
            path,
            name,
            group,
            size: entry.body.length,
            updated_at_ms: entry.updated_at_ms,
          };
        });
        rows.sort((a, b) => b.updated_at_ms - a.updated_at_ms);
        return rows;
      }
      case 'skill_get': {
        const entry = state.skills[args.path];
        if (!entry) {
          throw { kind: 'internal', message: 'skill not found: ' + args.path };
        }
        return { path: args.path, body: entry.body, updated_at_ms: entry.updated_at_ms };
      }
      case 'skill_save': {
        if (args.createNew && state.skills[args.path]) {
          throw {
            kind: 'internal',
            message: 'skill already exists: ' + args.path,
          };
        }
        const now = Date.now();
        state.skills[args.path] = { body: args.body, updated_at_ms: now };
        return { path: args.path, body: args.body, updated_at_ms: now };
      }
      case 'skill_delete':
        delete state.skills[args.path];
        return;

      // T4.5 PTY — echoes a canned banner + parrot-on-write. The
      // backend's real behaviour (interactive shell bytes) isn't
      // reproducible in a browser mock, but we can exercise the
      // spawn → stream → kill lifecycle + base64 event envelope.
      case 'pty_spawn': {
        const id = args.id;
        const ev = 'pty:data:' + id;
        queueMicrotask(() => {
          emit(ev, btoa('mock-shell $ '));
        });
        state.ptyIds = state.ptyIds || [];
        state.ptyIds.push(id);
        return id;
      }
      case 'pty_write': {
        // Echo whatever the user typed back on the data channel so a
        // Playwright test can verify round-trip without a real shell.
        const id = args.id;
        const data = args.data;
        queueMicrotask(() => {
          emit('pty:data:' + id, btoa(data));
        });
        return;
      }
      case 'pty_resize':
        return;
      case 'pty_kill':
        state.ptyIds = (state.ptyIds || []).filter((x) => x !== args.id);
        return;

      // T4.4 Budgets — same pattern.
      case 'budget_list':
        return [...state.budgets];
      case 'budget_upsert': {
        const b = args.budget;
        const idx = state.budgets.findIndex((x) => x.id === b.id);
        if (idx >= 0) state.budgets[idx] = b;
        else state.budgets.unshift(b);
        return;
      }
      case 'budget_delete':
        state.budgets = state.budgets.filter((b) => b.id !== args.id);
        return;
    }

    // Anything we don't recognise is a real bug in the test — surface it loudly.
    const err = { kind: 'internal', message: 'unmocked IPC: ' + cmd };
    throw err;
  }

  window.__TAURI_INTERNALS__ = {
    invoke: handle,
    transformCallback(callback, once) {
      const id = nextCallbackId++;
      const wrapped = once
        ? (payload) => { callbacks.delete(id); callback(payload); }
        : callback;
      callbacks.set(id, wrapped);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    metadata: { currentWindow: { label: 'main' }, windows: [] },
    convertFileSrc: (p) => p,
  };

  // Test hook: tweak fixtures + register command overrides from the spec.
  window.__CADUCEUS_MOCK__ = {
    state,
    emit,
    on(cmd, handler) {
      overrides.set(cmd, handler);
    },
    off(cmd) {
      overrides.delete(cmd);
    },
    reset() {
      overrides.clear();
      listenersByEvent.clear();
      callbacks.clear();
    },
  };
})();
`;
