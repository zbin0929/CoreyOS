import { invoke } from '@tauri-apps/api/core';

/**
 * Mirrors `src-tauri/src/artifacts/mod.rs::ArtifactInfo`. Sent
 * snake_case on the wire because the Rust `serde::Serialize`
 * derive doesn't apply a rename_all attribute — keep them aligned
 * if either side ever switches.
 */
export interface ArtifactInfo {
  run_id: string;
  name: string;
  /** Absolute path on disk; ok to surface in the GUI for "reveal"
   *  affordances, never sent to remote services. */
  path: string;
  /** Byte count. */
  size: number;
  /** Last-modified unix ms. */
  mtime_ms: number;
}

/** List artifacts for one run. Empty array when the run has no
 *  artifacts yet (the dir doesn't exist) — not an error. */
export function artifactList(runId: string): Promise<ArtifactInfo[]> {
  return invoke<ArtifactInfo[]>('artifact_list', { runId });
}

/** Resolve absolute path to one named artifact under `runId`. */
export function artifactPath(runId: string, name: string): Promise<string> {
  return invoke<string>('artifact_path', { runId, name });
}

/** Write text content as an artifact. Use for power-user flows that
 *  write structured outputs without going through Hermes Agent. */
export function artifactWrite(
  runId: string,
  name: string,
  content: string,
): Promise<ArtifactInfo> {
  return invoke<ArtifactInfo>('artifact_write', { runId, name, content });
}
