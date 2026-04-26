import { useState, type ClipboardEvent, type DragEvent } from 'react';

import {
  attachmentDelete,
  attachmentStageBlob,
  ipcErrorMessage,
  type StagedAttachment,
} from '@/lib/ipc';

/**
 * Composer-level attachment lifecycle. Owns the staged-but-not-sent
 * blobs the user has dropped / pasted / picked, plus the drag overlay
 * counter and a transient stage-error banner.
 *
 * State stays local (not in a Zustand store) on purpose: pending
 * attachments are UI-local — they should NOT survive a session switch,
 * a navigation, or a window close. Once `send()` bakes them into a
 * `UiMessage`, the on-disk file's lifecycle ties to the DB row's
 * cascade-on-session-delete, so nothing here needs to care about
 * persistence.
 *
 * Returned shape mirrors the previous inline ChatPane vocabulary so
 * the Composer JSX can keep its existing `pendingAttachments`,
 * `dragDepth`, and `attachError` references without a rename.
 */
export interface AttachmentsApi {
  pendingAttachments: StagedAttachment[];
  dragDepth: number;
  attachError: string | null;

  /** Stage a `File` (from paste / drop / picker) into Hermes' attachment dir. */
  stageFile: (file: File) => Promise<void>;
  /** Remove a chip and sweep the on-disk copy. Safe pre-send only. */
  removePendingAttachment: (id: string) => Promise<void>;

  /** Imperative API used by the `send()` orchestration to lock in the
   *  current snapshot of pending blobs and clear the staging area in
   *  one atomic step (so a fast follow-up paste doesn't attach to
   *  the wrong turn). */
  takeSnapshotAndClear: () => StagedAttachment[];

  /** Form-level event handlers — wire directly to the composer form. */
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragEnter: (e: DragEvent<HTMLFormElement>) => void;
  onDragLeave: (e: DragEvent<HTMLFormElement>) => void;
  onDragOver: (e: DragEvent<HTMLFormElement>) => void;
  onDrop: (e: DragEvent<HTMLFormElement>) => Promise<void>;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useAttachments(): AttachmentsApi {
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  const [dragDepth, setDragDepth] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);

  /**
   * Read the file through `FileReader` and base64-encode it so the
   * Rust `attachment_stage_blob` command can decode once server-side.
   * The `data:<mime>;base64,` prefix is stripped because the Rust
   * helper expects bare base64.
   */
  async function stageFile(file: File): Promise<void> {
    setAttachError(null);
    try {
      const base64Body = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(r.error ?? new Error('read failed'));
        r.onload = () => {
          const raw = typeof r.result === 'string' ? r.result : '';
          const comma = raw.indexOf(',');
          resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
        };
        r.readAsDataURL(file);
      });
      const staged = await attachmentStageBlob({
        name: file.name || 'pasted',
        mime: file.type || 'application/octet-stream',
        base64Body,
      });
      setPendingAttachments((prev) => [...prev, staged]);
    } catch (e) {
      setAttachError(ipcErrorMessage(e));
    }
  }

  async function removePendingAttachment(id: string) {
    const victim = pendingAttachments.find((a) => a.id === id);
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    if (victim) {
      // Fire-and-forget — the DB has no row yet (not sent), so only
      // the on-disk file needs sweeping. A missing file is not an
      // error. Silently ignore failures so the UI doesn't pop a toast
      // about a sweep the user didn't initiate.
      void attachmentDelete(victim.path).catch(() => {
        /* intentionally ignored */
      });
    }
  }

  /**
   * Snapshot-and-clear used by `send()`: returns the current pending
   * list, then empties the staging area immediately. Two-step so a
   * paste that lands between snapshot creation and state flush would
   * still go to the NEXT turn, not the current one.
   *
   * Reads via the closure rather than a ref because React batches
   * the state update right after — the next render of the composer
   * shows zero chips, which is the correct UX even though the values
   * we returned here are still alive in the caller.
   */
  function takeSnapshotAndClear(): StagedAttachment[] {
    const snapshot = pendingAttachments;
    setPendingAttachments([]);
    return snapshot;
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void stageFile(file);
        }
      }
    }
  }

  function onDragEnter(e: DragEvent<HTMLFormElement>) {
    // Only react to drags that actually carry files — ignore text
    // drags from within the app (e.g. highlighting a message bubble).
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  }
  function onDragLeave(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }
  function onDragOver(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    // preventDefault allows `drop` to fire.
    e.preventDefault();
  }
  async function onDrop(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth(0);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) await stageFile(f);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) await stageFile(f);
    e.target.value = '';
  }

  return {
    pendingAttachments,
    dragDepth,
    attachError,
    stageFile,
    removePendingAttachment,
    takeSnapshotAndClear,
    onPaste,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onFilePicked,
  };
}
