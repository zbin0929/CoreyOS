import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Loader2,
  Plus,
  Terminal as TerminalIcon,
  X,
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
interface Tab {
  /** Stable React key + map key for `bundlesRef`. Generated once on
   *  creation; never reused. */
  key: string;
  /** Human label shown in the tab strip. Defaults to `shell N` where
   *  N counts up monotonically so killing tab 2 and opening a new
   *  one gives `shell 3`, not `shell 2`. Less confusing in demos. */
  label: string;
  /** pty lifecycle state. Kept in React state so the tab pill can
   *  render a spinner while `starting`. */
  state: PtyState;
}

type PtyState =
  | { kind: 'starting' }
  | { kind: 'running'; id: string }
  | { kind: 'error'; message: string };

interface XtermBundle {
  term: Terminal;
  fit: FitAddon;
  unlisten: UnlistenFn | null;
  ro: ResizeObserver | null;
  /** Set once `ptySpawn` returns; used by teardown to kill the
   *  backend pty. Null while `starting`. */
  ptyId: string | null;
}

export function TerminalRoute() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Counter for the default `shell N` labels. Refs so we don't need
  // a render when bumping.
  const labelCounterRef = useRef(0);
  // Per-tab xterm bundles, keyed by `Tab.key`. Never stored in state
  // because xterm owns mutable DOM + WASM-ish internals; React
  // identity would fight it.
  const bundlesRef = useRef(new Map<string, XtermBundle>());
  // DOM hosts, one per tab, registered via callback ref. Needed so
  // we can mount xterm once the host node is attached without racing
  // the next render.
  const hostsRef = useRef(new Map<string, HTMLDivElement>());
  // Tabs that have been declared but not yet initialised with an
  // xterm instance. A separate set (not a per-tab flag) so
  // `useLayoutEffect` can drain it without pulling tab state into
  // the dependency array.
  const pendingInitRef = useRef(new Set<string>());

  /** Register a fresh tab. Returns the new key; the actual xterm +
   *  pty spawn is deferred to a layout effect so the host div exists
   *  by the time `term.open()` runs. */
  const newTab = useCallback(() => {
    labelCounterRef.current += 1;
    const key = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const label = `shell ${labelCounterRef.current}`;
    pendingInitRef.current.add(key);
    setTabs((prev) => [...prev, { key, label, state: { kind: 'starting' } }]);
    setActiveKey(key);
    return key;
  }, []);

  /** Tear down one tab: kill its pty + dispose xterm + drop from
   *  state. Leaves the rest of the tabs alone. If the closed tab
   *  was active, moves focus to the right-neighbour or — when there
   *  isn't one — the left-neighbour, falling back to no selection
   *  when this was the last tab. */
  const closeTab = useCallback(async (key: string) => {
    const bundle = bundlesRef.current.get(key);
    bundlesRef.current.delete(key);
    hostsRef.current.delete(key);
    pendingInitRef.current.delete(key);
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
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.key !== key);
      return next;
    });
    setActiveKey((prev) => {
      if (prev !== key) return prev;
      // Read the current tabs via a closure on the latest state: the
      // filter above hasn't committed yet, so use the last snapshot.
      return pickNeighbour(tabsRef.current, key);
    });
  }, []);

  /** Mirror of `tabs` for closure access inside async handlers that
   *  outlive a single render (close-tab, unmount cleanup). */
  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  /** Mount xterm + spawn pty for any tabs in `pendingInitRef` whose
   *  host div has attached. Runs synchronously after every render
   *  so the user never sees a blank tab panel. */
  useLayoutEffect(() => {
    const pending = pendingInitRef.current;
    if (pending.size === 0) return;
    for (const key of Array.from(pending)) {
      const host = hostsRef.current.get(key);
      if (!host) continue; // host not yet attached; next render will retry
      pending.delete(key);
      void initTab(key, host);
    }
    // Deps intentionally omitted: the effect is idempotent and reads
    // its inputs from refs. Including `tabs` would force a second
    // run per new tab (starting → running state transition) with
    // nothing to do.
  });

  /** Async half of tab creation. Separated from `useLayoutEffect`
   *  because effects can't be async; extracted as a stable closure
   *  here so tests could mock it later if we wanted. */
  const initTab = useCallback(async (key: string, host: HTMLDivElement) => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: { background: '#0b0d12', foreground: '#e6e6e6' },
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
    bundlesRef.current.set(key, bundle);

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
      bundlesRef.current.delete(key);
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

    const ro = new ResizeObserver(() => {
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
  }, []);

  /** When the active tab changes, re-run fit() on the incoming tab so
   *  its xterm catches up with the container's actual size (inactive
   *  tabs were `display: none` so their layout measurements stale). */
  useEffect(() => {
    if (!activeKey) return;
    const bundle = bundlesRef.current.get(activeKey);
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
      bundle.term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  // Teardown all tabs on unmount (route navigation away). Capture the
  // three maps upfront so the cleanup closure doesn't read
  // `ref.current` after the component has torn down (the warning
  // React gives you here is genuinely load-bearing — if a tab is
  // mid-spawn when unmount fires, `current` could get reassigned
  // between capture and teardown).
  useEffect(() => {
    const bundles = bundlesRef.current;
    const hosts = hostsRef.current;
    const pending = pendingInitRef.current;
    return () => {
      for (const [, bundle] of bundles) {
        bundle.unlisten?.();
        bundle.ro?.disconnect();
        bundle.term.dispose();
        if (bundle.ptyId) void ptyKill(bundle.ptyId).catch(() => {});
      }
      bundles.clear();
      hosts.clear();
      pending.clear();
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
          <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
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
            'relative min-h-0 flex-1 rounded-md border border-border bg-[#0b0d12] p-2',
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
                if (node) hostsRef.current.set(tab.key, node);
                else hostsRef.current.delete(tab.key);
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

/** Horizontal pill row: one chip per tab, each with label + ×.
 *  Active tab gets the elev-2 background so it reads as selected. */
function TabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-1"
      data-testid="terminal-tabs"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition',
              active
                ? 'border-border-strong bg-bg-elev-2 text-fg'
                : 'border-border bg-bg-elev-1 text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
            )}
            data-testid={`terminal-tab-${tab.key}`}
            data-active={active ? 'true' : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.key)}
              className="inline-flex items-center gap-1.5"
            >
              {tab.state.kind === 'starting' ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : tab.state.kind === 'error' ? (
                <Icon icon={AlertCircle} size="xs" className="text-danger" />
              ) : (
                <Icon icon={TerminalIcon} size="xs" className="text-fg-subtle" />
              )}
              <span className="max-w-[140px] truncate">{tab.label}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
              }}
              aria-label={`Close ${tab.label}`}
              className="rounded p-0.5 text-fg-subtle hover:bg-bg-elev-3 hover:text-danger"
              data-testid={`terminal-tab-close-${tab.key}`}
            >
              <Icon icon={X} size="xs" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** When the active tab closes, pick its right-neighbour (preserves
 *  tab-bar position), falling back to the left neighbour and then
 *  `null` (empty state). */
function pickNeighbour(tabs: Tab[], removed: string): string | null {
  const idx = tabs.findIndex((tab) => tab.key === removed);
  if (idx < 0) return tabs[0]?.key ?? null;
  const right = tabs[idx + 1];
  if (right) return right.key;
  const left = tabs[idx - 1];
  if (left) return left.key;
  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Decode a base64 string into a Uint8Array. Pure browser atob — no deps. */
function base64DecodeToUint8(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
