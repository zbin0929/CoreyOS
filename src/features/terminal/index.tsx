import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Terminal as TerminalIcon } from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { PageHeader } from '@/app/shell/PageHeader';
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
 * Phase 4 · T4.5 — Web terminal.
 *
 * Single-tab MVP: click "Open terminal" → spawns the user's login shell
 * under a portable-pty on the backend, streams output bytes into
 * xterm.js via base64-encoded Tauri events, and relays keystrokes back.
 * ResizeObserver keeps xterm + the backend pty dimensions in lockstep
 * through the fit addon.
 *
 * Explicitly out of scope for this sprint:
 * - Multi-tab. The state machine supports only one active session.
 *   Generalising to tabs is a pure UI concern once we need it.
 * - WebGL renderer. Canvas (xterm.js default) looks fine for a demo.
 * - Copy/paste affordances. Browser defaults (⌘C / ⌘V) work — custom
 *   buttons are polish.
 * - Persistent scrollback across kills. Restart = fresh shell.
 */
type PtyState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; id: string }
  | { kind: 'error'; message: string };

export function TerminalRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<PtyState>({ kind: 'idle' });
  const containerRef = useRef<HTMLDivElement>(null);
  // xterm instance + fit addon kept in refs so the open/close buttons
  // don't force re-renders of the whole component.
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Holds the pty id for the currently-running session so the unmount
  // cleanup can kill it even if React has moved on to a different state.
  const activeIdRef = useRef<string | null>(null);

  const open = useCallback(async () => {
    if (state.kind !== 'idle' && state.kind !== 'error') return;
    setState({ kind: 'starting' });

    // Late-mount the xterm instance — doing it before `containerRef`
    // holds a DOM node is pointless and forces a second initial paint.
    const host = containerRef.current;
    if (!host) {
      setState({ kind: 'error', message: 'terminal container not ready' });
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#0b0d12',
        foreground: '#e6e6e6',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // fit() throws if the container has 0-height (route not laid out
      // yet). We'll get another shot from the ResizeObserver below.
    }
    termRef.current = term;
    fitRef.current = fit;

    const id = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cols = term.cols || 80;
    const rows = term.rows || 24;

    // Attach the data listener BEFORE the spawn call so the shell's
    // banner doesn't race ahead of us.
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<string>(`pty:data:${id}`, (e) => {
        const bytes = base64DecodeToUint8(e.payload);
        // xterm.write accepts Uint8Array and handles UTF-8 internally.
        term.write(bytes);
      });
      await ptySpawn(id, rows, cols);
    } catch (e) {
      if (unlisten) unlisten();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setState({ kind: 'error', message: ipcErrorMessage(e) });
      return;
    }

    activeIdRef.current = id;

    // User keystrokes → backend.
    term.onData((data) => {
      void ptyWrite(id, data).catch(() => {
        /* Swallow — shell might have just exited; the unmount cleanup
           will clean up the listener and the error surfaces nowhere
           useful. */
      });
    });

    // Keep the pty dimensions synced to the visible viewport.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void ptyResize(id, term.rows, term.cols).catch(() => {});
      } catch {
        /* see fit.fit() comment above — first few observations can
           fire before the layout settles. */
      }
    });
    ro.observe(host);

    setState({ kind: 'running', id });

    // Store teardown on the term itself via a tag so the unmount path
    // can grab it without pulling more refs into the closure.
    (term as unknown as { __unlisten?: UnlistenFn; __ro?: ResizeObserver }).__unlisten = unlisten;
    (term as unknown as { __unlisten?: UnlistenFn; __ro?: ResizeObserver }).__ro = ro;
  }, [state.kind]);

  const close = useCallback(async () => {
    const id = activeIdRef.current;
    activeIdRef.current = null;
    const term = termRef.current;
    termRef.current = null;
    fitRef.current = null;
    if (term) {
      const tagged = term as unknown as { __unlisten?: UnlistenFn; __ro?: ResizeObserver };
      tagged.__unlisten?.();
      tagged.__ro?.disconnect();
      term.dispose();
    }
    if (id) {
      try {
        await ptyKill(id);
      } catch {
        /* shell may have already exited; ignore. */
      }
    }
    setState({ kind: 'idle' });
  }, []);

  // Teardown on unmount (route navigation away).
  useEffect(() => {
    return () => {
      const id = activeIdRef.current;
      activeIdRef.current = null;
      const term = termRef.current;
      termRef.current = null;
      fitRef.current = null;
      if (term) {
        const tagged = term as unknown as {
          __unlisten?: UnlistenFn;
          __ro?: ResizeObserver;
        };
        tagged.__unlisten?.();
        tagged.__ro?.disconnect();
        term.dispose();
      }
      if (id) void ptyKill(id).catch(() => {});
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('terminal.title')}
        subtitle={t('terminal.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {state.kind === 'running' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void close()}
                data-testid="terminal-close"
              >
                {t('terminal.close')}
              </Button>
            )}
            {(state.kind === 'idle' || state.kind === 'error') && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void open()}
                data-testid="terminal-open"
              >
                <TerminalIcon className="h-3.5 w-3.5" />
                {t('terminal.open')}
              </Button>
            )}
            {state.kind === 'starting' && (
              <Button size="sm" variant="ghost" disabled>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('terminal.starting')}
              </Button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {state.kind === 'error' && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span data-testid="terminal-error">{state.message}</span>
          </div>
        )}
        <div
          ref={containerRef}
          className={cn(
            'h-full w-full rounded-md border border-border bg-[#0b0d12] p-2',
            state.kind !== 'running' && 'opacity-70',
          )}
          data-testid="terminal-host"
        />
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Decode a base64 string into a Uint8Array. Pure browser atob — no deps. */
function base64DecodeToUint8(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
