import type { HermesProfilesView, ProfileImportPreview } from '@/lib/ipc';

/**
 * Page-level state for `ProfilesRoute`. The list IPC is async, so the
 * route is always in one of three macro states; `loaded` carries the
 * full snapshot the cards render against.
 */
export type Loaded = { kind: 'loaded'; view: HermesProfilesView };

export type State =
  | { kind: 'loading' }
  | Loaded
  | { kind: 'error'; message: string };

/**
 * Per-card UI mode. State lives per-row so multiple cards can't be in
 * an inconsistent action state at once (e.g. two pending renames).
 */
export type RowMode =
  | { kind: 'view' }
  | { kind: 'rename'; value: string }
  | { kind: 'clone'; value: string }
  | { kind: 'confirm-delete' };

export type RowStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'err'; message: string };

/** Inflight import flow. Lives at the page level (not per-card)
 *  because the user starts it from a global button before choosing
 *  which profile it'll become. */
export type ImportMode =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'preview';
      preview: ProfileImportPreview;
      bytesBase64: string;
      /** Optional rename — the user can type a different target name
       *  before committing. Defaults to the manifest's own name. */
      targetName: string;
    }
  | {
      kind: 'overwrite-prompt';
      preview: ProfileImportPreview;
      bytesBase64: string;
      targetName: string;
    }
  | { kind: 'error'; message: string };

/** Activate-profile flow. `confirm` carries the target and the previous
 *  active profile (when known) so the modal can render `dev → prod`
 *  and the user gets one last chance to back out before the gateway
 *  gets bounced. `busy` is the transient state while the two IPC calls
 *  (activate + optional gateway restart) run in series. */
export type ActivateMode =
  | { kind: 'idle' }
  | { kind: 'confirm'; target: string; previous: string | null; restartGateway: boolean }
  | { kind: 'busy'; target: string; restartGateway: boolean }
  | { kind: 'error'; target: string; message: string };
