import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRouter } from '@tanstack/react-router';
import i18n from 'i18next';
import { menuSetLocale } from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';
import { useUIStore } from '@/stores/ui';

/**
 * Bridges native menubar clicks into the React app.
 *
 * Rust emits a single `menu-action` Tauri event carrying the id of the
 * clicked item (see `src-tauri/src/menu.rs`). We fan each id out to a
 * store mutation or router navigation. Predefined system items
 * (Cut / Copy / Paste / Minimize / …) never reach us — the OS handles
 * them — so this handler only needs to know about the Corey-specific
 * ids that `menu.rs::is_app_action` filters on.
 *
 * Mounted inside `AppShell` because that's where the TanStack Router
 * context is available (we need `useRouter()` to navigate).
 */
const DOCS_URL = 'https://github.com/EKKOLearnAI/hermes-ui#readme';
const ISSUES_URL = 'https://github.com/EKKOLearnAI/hermes-ui/issues/new';

const NAV_PREFIX = 'nav:';

export function useMenuEvents(): void {
  const router = useRouter();

  useEffect(() => {
    // `listen` returns a Promise<UnlistenFn>. Keep the unlisten around
    // so StrictMode's double-mount in dev doesn't stack duplicate
    // handlers (every menu click would otherwise fire N times).
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen<string>('menu-action', (event) => {
      void dispatch(event.payload, router);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => {
        // Non-Tauri contexts (Storybook, Playwright mock) don't have
        // the event bus — log to console only so the hook stays safe
        // to mount everywhere.
        console.debug('menu-action listen unavailable:', e);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [router]);

  // Keep the native menubar's locale in sync with i18next. Pushes once
  // on mount (Rust boots with an English fallback so the bar is never
  // empty during the cold-boot JS load), then subscribes to
  // `languageChanged` so the Settings > Language selector takes effect
  // immediately — no restart, no flicker on other routes.
  useEffect(() => {
    const push = (lng: string) => {
      void menuSetLocale(lng).catch(() => {
        /* non-Tauri contexts or a rebuild race — menu stays on
         * whatever it last had; not worth surfacing to the user. */
      });
    };
    push(i18n.language);
    i18n.on('languageChanged', push);
    return () => {
      i18n.off('languageChanged', push);
    };
  }, []);
}

async function dispatch(
  id: string,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  if (id.startsWith(NAV_PREFIX)) {
    const path = id.slice(NAV_PREFIX.length);
    void router.navigate({ to: path });
    return;
  }

  switch (id) {
    case 'new-chat': {
      const chat = useChatStore.getState();
      // `newSession` requires hydration to have completed (so we don't
      // duplicate a session that's about to load from disk). On a
      // cold-boot menu click the odds are near zero, but be defensive.
      if (!chat.hydrated) await chat.hydrateFromDb();
      useChatStore.getState().newSession();
      void router.navigate({ to: '/chat' });
      return;
    }
    case 'toggle-theme': {
      useUIStore.getState().toggleTheme();
      return;
    }
    case 'help:docs': {
      await openExternal(DOCS_URL);
      return;
    }
    case 'help:issues': {
      await openExternal(ISSUES_URL);
      return;
    }
    default: {
      console.warn('unhandled menu action:', id);
    }
  }
}

/**
 * Open a URL in the user's default browser. Uses tauri-plugin-shell;
 * falls back to `window.open` when the plugin isn't available (tests /
 * Storybook) so links still work.
 */
async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
