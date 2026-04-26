import type { HermesConfigView } from '@/lib/ipc';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; view: HermesConfigView }
  | { kind: 'error'; message: string };

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

/** Result of the most recent provider `/v1/models` probe. `idle` means
 *  the user hasn't pressed Discover this session. */
export type ProbeState =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok'; count: number; latencyMs: number; endpoint: string }
  | { kind: 'err'; message: string };
