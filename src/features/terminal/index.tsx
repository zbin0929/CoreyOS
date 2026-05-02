import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Plus,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from '@/lib/ipc';

import { TabStrip } from './TabStrip';
import { base64DecodeToUint8, pickNeighbour } from './helpers';
import type { XtermBundle } from './types';
import {
  terminalBundles,
  terminalHosts,
  terminalLabelCounter,
  terminalPendingInit,
  terminalPendingReattach,
  useTerminalStore,
} from './store';

/**
 * Phase 4 · T4.5 + T4.5b (multi-tab) — Web terminal.
 *
 * Click "Open terminal" → spawns the user's login shell under a
 * portable-pty on the backend, streams output bytes into xterm.js via
 * base64-encoded Tauri events, and relays keystrokes back.
 * ResizeObserver keeps xterm + the backend pty dimensions in lockstep
 * through the fit addon.
 *
 * ### Multi-tab model (T4.5b)
 *
 * Each tab is an independent pty id + xterm instance. **All tabs stay
 * mounted** once opened — inactive hosts just flip to `display: none`
 * — so switching tabs preserves scrollback without a second
 * round-trip to the shell. The alternative (dispose + respawn on
 * switch) would be simpler but loses the buffer every time, which is
 * the exact UX pain this feature exists to fix.
 *
 * State lives in two parallel structures so React and xterm don't
 * fight each other:
 * - `tabs` (React state) — the ordered list of tab descriptors; what
 *   the UI renders and navigates.
 * - `bundlesRef` (imperative Map) — the xterm instance, fit addon,
 *   event listeners, and ResizeObserver for each tab key. Keyed by
 *   the tab's stable `key`, not index, so reordering/removing tabs
 *   can't mis-attribute a bundle.
 *
 * Explicitly out of scope (still):
 * - Tab reordering / drag-and-drop.
 * - Restoring a tab after process exit (user clicks × or the shell
 *   dies; we close the whole tab).
 * - WebGL renderer. Canvas is fine.
 * - Copy/paste buttons. ⌘C / ⌘V work.
 */
export function TerminalRoute() {
  const { t } = useTranslation();
  // Tabs and active key live in the module-level zustand store so
  // they survive when this route unmounts (user navigates elsewhere
  // and back). Non-reactive maps (bundles/hosts/pending*) are
  // imported as singletons; see `./store.ts` for the rationale.
  const tabs = useTerminalStore((s) => s.tabs);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const setTabs = useTerminalStore((s) => s.setTabs);
  const setActiveKey = useTerminalStore((s) => s.setActiveKey);

  /** Register a fresh tab. Returns the new key; the actual xterm +
   *  pty spawn is deferred to a layout effect so the host div exists
   *  by the time `term.open()` runs. */
  const newTab = useCallback(() => {
    terminalLabelCounter.value += 1;
    const key = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const label = `shell ${terminalLabelCounter.value}`;
    terminalPendingInit.add(key);
    setTabs((prev) => [...prev, { key, label, state: { kind: 'starting' } }]);
    setActiveKey(key);
    return key;
  }, [setTabs, setActiveKey]);

  /** Tear down one tab: kill its pty + dispose xterm + drop from
   *  state. Leaves the rest of the tabs alone. If the closed tab
   *  was active, moves focus to the right-neighbour or — when there
   *  isn't one — the left-neighbour, falling back to no selection
   *  when this was the last tab. */
  const closeTab = useCallback(async (key: string) => {
    const bundle = terminalBundles.get(key);
    terminalBundles.delete(key);
    terminalHosts.delete(key);
    terminalPendingInit.delete(key);
    terminalPendingReattach.delete(key);
    if (bundle) {
      bundle.unlisten?.();
      bundle.ro?.disconnect();
      bundle.term.dispose();
      if (bundle.ptyId) {
        try {
          await ptyKill(bundle.ptyId);
        } catch {
          /* shell may have already exited; ignore. */
        }
      }
    }
    const prevTabs = useTerminalStore.getState().tabs;
    setTabs(prevTabs.filter((tab) => tab.key !== key));
    setActiveKey((prev) => (prev !== key ? prev : pickNeighbour(prevTabs, key)));
  }, [setTabs, setActiveKey]);

  /** Mount xterm + spawn pty for any tabs in `pendingInitRef` whose
   *  host div has attached. Runs synchronously after every render
   *  so the user never sees a blank tab panel. */
  useLayoutEffect(() => {
    // Drain newly-created tabs first (no bundle yet).
    for (const key of Array.from(terminalPendingInit)) {
      const host = terminalHosts.get(key);
      if (!host) continue;
      terminalPendingInit.delete(key);
      void initTab(key, host);
    }
    // Then drain re-attachments (bundle exists from a previous mount;
    // host is fresh). Re-parent the xterm, rewire ResizeObserver.
    for (const key of Array.from(terminalPendingReattach)) {
      const host = terminalHosts.get(key);
      const bundle = terminalBundles.get(key);
      if (!host || !bundle) continue;
      terminalPendingReattach.delete(key);
      reattachTab(key, host, bundle);
    }
  });

  /** Async half of tab creation. Separated from `useLayoutEffect`
   *  because effects can't be async; extracted as a stable closure
   *  here so tests could mock it later if we wanted. */
  const initTab = useCallback(async (key: string, host: HTMLDivElement) => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12.5,
      theme: { background: '#0a0c14', foreground: '#e2e4e8', cursor: '#d4a054', selectionBackground: '#d4a05440' },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // fit() throws on 0-height containers (route not yet laid out).
      // The ResizeObserver below will retry once the layout settles.
    }

    const ptyId = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cols = term.cols || 80;
    const rows = term.rows || 24;

    // Stash the bundle immediately so a rapid closeTab() can still
    // find + tear it down even if we error out half-way through.
    const bundle: XtermBundle = {
      term,
      fit,
      unlisten: null,
      ro: null,
      ptyId: null,
    };
    terminalBundles.set(key, bundle);

    // Attach the data listener BEFORE spawn so the shell's banner
    // doesn't race ahead of us.
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<string>(`pty:data:${ptyId}`, (e) => {
        term.write(base64DecodeToUint8(e.payload));
      });
      bundle.unlisten = unlisten;
      await ptySpawn(ptyId, rows, cols);
      bundle.ptyId = ptyId;
    } catch (e) {
      unlisten?.();
      term.dispose();
      terminalBundles.delete(key);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.key === key
            ? { ...tab, state: { kind: 'error', message: ipcErrorMessage(e) } }
            : tab,
        ),
      );
      return;
    }

    term.onData((data) => {
      void ptyWrite(ptyId, data).catch(() => {
        /* Swallow — shell may have exited between keystroke and dispatch. */
      });
    });

    // Clipboard paste: xterm's default key handling swallows ⌘V /
    // Ctrl+Shift+V on some platforms (especially when the iframe/
    // webview doesn't forward the native paste). We listen for the
    // DOM `paste` event on the host and forward clipboard text to the
    // pty directly, which works uniformly across Tauri on macOS /
    // Windows / Linux. The abort controller lives on the bundle so a
    // later `reattachTab` can detach this listener cleanly before
    // wiring its own; otherwise listeners stack on every route
    // navigate-and-back cycle.
    const pasteAbort = new AbortController();
    bundle.pasteAbort = pasteAbort;
    host.addEventListener(
      'paste',
      (ev) => {
        const clipboard = (ev as ClipboardEvent).clipboardData;
        const text = clipboard?.getData('text/plain');
        if (text) {
          ev.preventDefault();
          void ptyWrite(ptyId, text).catch(() => {});
        }
      },
      { signal: pasteAbort.signal },
    );

    const ro = new ResizeObserver(() => {
      // Hidden tabs (display:none on a sibling host) report 0×0 here.
      // Calling fit.fit() in that state would resize xterm to 0
      // cols/rows and wipe the visible buffer — when the user
      // switches back the panel renders as a black void. Skip until
      // the host has real dimensions; the next ResizeObserver tick
      // (fired when display flips back to block) will catch up.
      if (host.clientHeight === 0 || host.clientWidth === 0) return;
      try {
        fit.fit();
        void ptyResize(ptyId, term.rows, term.cols).catch(() => {});
      } catch {
        /* see fit.fit() comment above. */
      }
    });
    ro.observe(host);
    bundle.ro = ro;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.key === key
          ? { ...tab, state: { kind: 'running', id: ptyId } }
          : tab,
      ),
    );
  }, [setTabs]);

  /** Re-attach an existing xterm bundle onto a freshly mounted host
   *  div after the route remounts. The pty keeps running; we just
   *  rebind the DOM half.
   *
   *  Two foot-guns this is careful about:
   *    1. The ResizeObserver MUST guard on `clientHeight/Width === 0`
   *       before calling fit. When the user opens a 2nd tab, the
   *       previously-active host flips to `display:none`, which fires
   *       RO with a 0×0 contentRect. fit.fit() at 0×0 resizes xterm to
   *       0 cols/rows and wipes the visible buffer — the original
   *       "switch back, terminal is black" bug.
   *    2. The paste handler is `AbortController`-scoped, so a second
   *       remount doesn't double-fire writes. Without this each
   *       navigate-away-and-back cycle stacks another listener.
   */
  const reattachTab = useCallback((key: string, host: HTMLDivElement, bundle: XtermBundle) => {
    bundle.ro?.disconnect();
    bundle.pasteAbort?.abort();
    // Move the existing xterm root element into the new host instead
    // of calling `term.open(host)` again. xterm 5 doesn't reliably
    // re-open to a fresh parent — the second call leaves the renderer
    // in a half-initialized state and the panel paints solid black
    // (the bug reported on 2026-04-27 right after a route navigate-
    // away-and-back). Moving the DOM node sidesteps the renderer
    // entirely; the buffer + scrollback live on `term._core` and
    // survive the move.
    //
    // Fallback to `term.open(host)` only when the term has no element
    // yet (shouldn't happen for reattach — the bundle always existed
    // — but defensively cover it so a corrupted state doesn't throw).
    const termEl = bundle.term.element;
    if (termEl) {
      if (termEl.parentElement !== host) {
        // appendChild auto-detaches from the old (likely-orphaned)
        // parent so we don't need an explicit removeChild.
        host.appendChild(termEl);
      }
    } else {
      bundle.term.open(host);
    }
    try {
      bundle.fit.fit();
    } catch {
      /* layout not ready yet; ResizeObserver will catch up. */
    }
    const ro = new ResizeObserver(() => {
      // Same 0-size guard as `initTab` — see comment there.
      if (host.clientHeight === 0 || host.clientWidth === 0) return;
      try {
        bundle.fit.fit();
        if (bundle.ptyId) {
          void ptyResize(bundle.ptyId, bundle.term.rows, bundle.term.cols).catch(() => {});
        }
      } catch {
        /* see fit() above. */
      }
    });
    ro.observe(host);
    bundle.ro = ro;
    const abort = new AbortController();
    bundle.pasteAbort = abort;
    host.addEventListener(
      'paste',
      (ev) => {
        const clipboard = (ev as ClipboardEvent).clipboardData;
        const text = clipboard?.getData('text/plain');
        if (text && bundle.ptyId) {
          ev.preventDefault();
          void ptyWrite(bundle.ptyId, text).catch(() => {});
        }
      },
      { signal: abort.signal },
    );
    void key;
  }, []);

  /** When the active tab changes, re-run fit() on the incoming tab so
   *  its xterm catches up with the container's actual size (inactive
   *  tabs were `display: none` so their layout measurements stale).
   *
   *  We also call `term.refresh(...)` to force xterm's renderer to
   *  repaint every visible row from its buffer state. On some
   *  Chromium / WebKit2GTK builds the terminal panel comes back blank
   *  after a display:none → block flip even when fit() and focus()
   *  ran successfully — refresh nudges the canvas/DOM renderer to
   *  actually draw the cells the buffer already has. Without this
   *  the panel renders as a black rectangle, which is the bug
   *  reported on 2026-04-27.
   */
  useEffect(() => {
    if (!activeKey) return;
    const bundle = terminalBundles.get(activeKey);
    if (!bundle) return;
    // Defer one frame so the display: none → block transition paints
    // before we measure.
    const raf = requestAnimationFrame(() => {
      try {
        bundle.fit.fit();
        if (bundle.ptyId) {
          void ptyResize(
            bundle.ptyId,
            bundle.term.rows,
            bundle.term.cols,
          ).catch(() => {});
        }
      } catch {
        /* layout may still be settling on first switch; no-op. */
      }
      // Repaint every visible row regardless of fit result. Cheap —
      // xterm only redraws the requested range.
      try {
        const last = Math.max(0, bundle.term.rows - 1);
        bundle.term.refresh(0, last);
      } catch {
        /* term may have been disposed mid-switch; harmless. */
      }
      bundle.term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  // Unmount: do NOT tear down bundles. They live in the module-level
  // store so the ptys + scrollback survive route navigation. We do
  // release DOM host refs (the old host nodes are about to be
  // removed from the DOM anyway) and queue a re-attach for each
  // surviving tab so the next mount re-parents them.
  useEffect(() => {
    return () => {
      for (const key of Array.from(terminalBundles.keys())) {
        terminalPendingReattach.add(key);
      }
      terminalHosts.clear();
    };
  }, []);

  const hasTabs = tabs.length > 0;
  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? null;
  const headerError =
    activeTab?.state.kind === 'error' ? activeTab.state.message : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('terminal.title')}
        subtitle={t('terminal.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('terminal.title')}
              content={t('terminal.help_page')}
              testId="terminal-help"
            />
            {hasTabs ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => newTab()}
                  data-testid="terminal-new-tab"
                  title={t('terminal.new_tab')}
                >
                  <Icon icon={Plus} size="sm" />
                  {t('terminal.new_tab')}
                </Button>
                {activeKey && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void closeTab(activeKey)}
                    data-testid="terminal-close"
                  >
                    {t('terminal.close')}
                  </Button>
                )}
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => newTab()}
                data-testid="terminal-open"
              >
                <Icon icon={TerminalIcon} size="sm" />
                {t('terminal.open')}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {hasTabs && (
          <TabStrip
            tabs={tabs}
            activeKey={activeKey}
            onSelect={setActiveKey}
            onClose={(key) => void closeTab(key)}
          />
        )}
        {headerError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
            <span data-testid="terminal-error">{headerError}</span>
          </div>
        )}
        {/* One host per tab; stacked and toggled via display. The
         *  ACTIVE host also carries `data-testid="terminal-host"` so
         *  the existing e2e suite — which targets a singular host —
         *  keeps passing unchanged. */}
        <div
          className={cn(
            'relative min-h-0 flex-1 rounded-xl border border-border/60 bg-[#0a0c14] p-2 shadow-[var(--shadow-1)]',
            !activeTab && 'flex items-center justify-center opacity-70',
          )}
        >
          {!hasTabs && (
            <span
              className="text-xs text-fg-subtle"
              data-testid="terminal-host"
            >
              {t('terminal.open_hint', 'Open a terminal to get started.')}
            </span>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.key}
              ref={(node) => {
                if (node) terminalHosts.set(tab.key, node);
                else terminalHosts.delete(tab.key);
              }}
              data-testid={activeKey === tab.key ? 'terminal-host' : undefined}
              data-tab-key={tab.key}
              className={cn(
                'absolute inset-2',
                activeKey === tab.key ? 'block' : 'hidden',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

