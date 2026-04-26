import type { UnlistenFn } from '@tauri-apps/api/event';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

export interface Tab {
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

export type PtyState =
  | { kind: 'starting' }
  | { kind: 'running'; id: string }
  | { kind: 'error'; message: string };

export interface XtermBundle {
  term: Terminal;
  fit: FitAddon;
  unlisten: UnlistenFn | null;
  ro: ResizeObserver | null;
  /** Set once `ptySpawn` returns; used by teardown to kill the
   *  backend pty. Null while `starting`. */
  ptyId: string | null;
}
