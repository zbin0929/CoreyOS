import type { ChatStreamDone, ModelInfo } from '@/lib/ipc';

export type LaneState =
  | { kind: 'idle' }
  | { kind: 'streaming'; content: string; startedAt: number }
  | {
      kind: 'done';
      content: string;
      startedAt: number;
      finishedAt: number;
      summary: ChatStreamDone;
    }
  | { kind: 'error'; message: string; content: string }
  | { kind: 'cancelled'; content: string };

export interface Lane {
  /** Unique per-run lane id. Changing models mid-run would churn this, so
   *  we use a stable `modelId + instanceIndex` suffix when the user adds
   *  two lanes with the same model (rare but not prohibited). */
  laneId: string;
  model: ModelInfo;
  state: LaneState;
}
