import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { listen } from '@tauri-apps/api/event';

import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';
import { llmProfileEnsureAdapter } from '@/lib/ipc/hermes-instances';
import { hermesGatewayRestart } from '@/lib/ipc/hermes-config';

/**
 * Listen for `corey_native:open_route` and `corey_native:open_settings`
 * events emitted by the Corey-native MCP server (see
 * `src-tauri/src/mcp_server/tools.rs`). When the chat agent calls one
 * of those tools, this hook pushes the GUI router to the requested
 * route — that's the "summary in chat + button to the page" pattern.
 *
 * Why two events:
 *   - `open_settings` predates the generalised `open_route` and is
 *     still in the tool catalog under the same name; we keep it
 *     wired so older agent prompts keep working.
 *   - `open_route` accepts any absolute path (`/tasks`, `/models`).
 *
 * Mounted exactly once inside `AppShell` (which is rendered inside
 * `RouterProvider`, so `useNavigate` resolves correctly).
 *
 * Also kicks `useAppStatusStore` to refresh on route navigation when
 * the destination is `/models`, so the LLM model badge in the topbar
 * reflects a freshly-switched default without waiting for the slow
 * poll.
 */
export function useDeepLinkListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlistenRoutePromise = listen<string>('corey_native:open_route', (event) => {
      const path = event.payload;
      if (typeof path !== 'string' || !path.startsWith('/')) return;
      void navigate({ to: path }).then(() => {
        if (path === '/models') {
          void useAppStatusStore.getState().refreshModel();
        }
      });
    });

    const unlistenSettingsPromise = listen<string>('corey_native:open_settings', (event) => {
      const panel = event.payload;
      if (typeof panel !== 'string' || panel.length === 0) return;
      void navigate({ to: '/settings', search: { panel } as never });
    });

    // The agent just called `set_default_llm`. Five things happen:
    //   1. Refresh `currentModel` so the topbar badge updates now.
    //   2. Pin the active chat session to the new LlmProfile so the
    //      next turn routes through `hermes:profile:<id>`.
    //   3. Re-register the profile adapter (idempotent) — keeps
    //      adapter registry in sync with the new selection.
    //   4. **Defer-restart Hermes Gateway** so the new `HERMES_MODEL`
    //      env value takes effect. We MUST wait until the current
    //      chat stream finishes — bouncing the gateway mid-SSE
    //      kills the active socket. 2-second debounce buys us a
    //      window for the chat reply to drain.
    //   5. Once gateway is back, `refreshModel` runs again so the
    //      badge reflects the post-restart truth.
    const unlistenModelChangedPromise = listen<{ profile_id?: string; model?: string }>(
      'corey_native:model_changed',
      (event) => {
        void useAppStatusStore.getState().refreshModel();
        const payload = event.payload;
        if (!payload || typeof payload !== 'object') return;
        const profileId = typeof payload.profile_id === 'string' ? payload.profile_id : null;
        const model = typeof payload.model === 'string' ? payload.model : null;
        if (!profileId || !model) return;
        const sessionId = useChatStore.getState().currentId;
        if (sessionId) {
          // 2 + 3: ensureAdapter then pin the session.
          llmProfileEnsureAdapter(profileId)
            .then(() => {
              useChatStore.getState().setSessionLlmProfile(sessionId, profileId, model);
            })
            .catch(() => {
              /* keep the topbar update even if pinning fails */
            });
        }
        // 4: deferred gateway restart so the new HERMES_MODEL takes
        // effect. Two-second buffer lets the agent loop complete its
        // current SSE stream first.
        setTimeout(() => {
          hermesGatewayRestart()
            .then(() => {
              // 5: post-restart, re-resolve currentModel from the
              // freshly loaded config.
              void useAppStatusStore.getState().refreshModel();
            })
            .catch((e) => {
              console.warn('gateway restart after model change failed', e);
            });
        }, 2_000);
      },
    );

    // The agent called `corey_browser_launch` / `_stop` / `_clear` via
    // chat. The MCP tool path deliberately does NOT restart gateway
    // inline (see ipc/mcp_server/tools.rs comment near `browser_launch`)
    // because bouncing mid-SSE kills the current chat stream. Mirror
    // the `model_changed` pattern: defer the restart 2s so the reply
    // drains first, then bounce gateway so the new `BROWSER_CDP_URL`
    // env value is loaded into Hermes' os.environ for the NEXT chat
    // turn. Without this listener the env-file write was effectively
    // dead — chat would say "switched to AI Browser" but the next
    // browser_navigate would still use Hermes' ephemeral Playwright.
    const unlistenBrowserChangedPromise = listen<{ action?: string }>(
      'corey_native:browser_changed',
      () => {
        setTimeout(() => {
          hermesGatewayRestart().catch((e) => {
            console.warn('gateway restart after browser change failed', e);
          });
        }, 2_000);
      },
    );

    return () => {
      void unlistenRoutePromise.then((fn) => fn());
      void unlistenSettingsPromise.then((fn) => fn());
      void unlistenModelChangedPromise.then((fn) => fn());
      void unlistenBrowserChangedPromise.then((fn) => fn());
    };
  }, [navigate]);
}
