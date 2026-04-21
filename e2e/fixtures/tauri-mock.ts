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
  };

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

      case 'config_get':
        return state.config;
      case 'config_set':
        state.config = { ...state.config, ...args.config };
        return;
      case 'config_test':
        return { latency_ms: 12, body: 'ok' };

      case 'hermes_config_read':
        return state.hermesConfig;
      case 'hermes_config_write_model':
        state.hermesConfig = { ...state.hermesConfig, model: args.model };
        return state.hermesConfig;
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

      case 'db_load_all':
        return state.sessions;
      case 'db_session_upsert':
      case 'db_session_delete':
      case 'db_message_upsert':
      case 'db_tool_call_append':
        return;

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
