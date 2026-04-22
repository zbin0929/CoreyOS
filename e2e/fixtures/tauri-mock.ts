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

      case 'analytics_summary':
        return state.analytics;

      case 'chat_send':
        return { content: state.chatReply };

      case 'chat_stream_start': {
        // Shape matches the real Rust IPC: args.args = { messages, model, handle }.
        const h = args.args.handle;
        const reply = state.chatReply;
        // Emit two deltas then done — on a microtask so \`listen\` returns first.
        queueMicrotask(() => {
          emit('chat:delta:' + h, reply.slice(0, 5));
          setTimeout(() => emit('chat:delta:' + h, reply.slice(5)), 10);
          setTimeout(
            () =>
              emit('chat:done:' + h, {
                finish_reason: 'stop',
                model: 'mock',
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
