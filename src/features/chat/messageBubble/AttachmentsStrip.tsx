import { useEffect, useState } from 'react';
import { Film, Loader2, Paperclip } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { attachmentThumbnail } from '@/lib/ipc';
import type { UiAttachment } from '@/stores/chat';

/**
 * Module-level LRU cache for image preview data URLs. Virtualised scroll
 * (react-virtuoso) remounts bubbles as they enter/exit the viewport,
 * which without a cache means every scroll re-fires `attachment_preview`
 * over IPC — cheap in isolation but visibly janky on long sessions with
 * 20+ images. Keyed on `path` (mime doesn't affect bytes). Capped at 64
 * entries; each is ≤ 5 MB per the Rust-side cap so worst-case in-RAM
 * footprint is ~320 MB, acceptable for a desktop app that typical
 * sessions never get close to.
 *
 * Failure caching is intentional too: if the file is gone / too big the
 * first time, we remember `'failed'` and skip re-trying on every
 * scroll. Users who swap in a new file get a fresh mount (different
 * path) so the cache doesn't mask legitimate retries.
 */
type PreviewEntry = { kind: 'ok'; url: string } | { kind: 'failed' };
const PREVIEW_CACHE = new Map<string, PreviewEntry>();
const PREVIEW_CACHE_CAP = 64;

function cacheGet(path: string): PreviewEntry | undefined {
  const entry = PREVIEW_CACHE.get(path);
  if (!entry) return undefined;
  // Touch to move to LRU end.
  PREVIEW_CACHE.delete(path);
  PREVIEW_CACHE.set(path, entry);
  return entry;
}

function cacheSet(path: string, entry: PreviewEntry): void {
  PREVIEW_CACHE.set(path, entry);
  if (PREVIEW_CACHE.size > PREVIEW_CACHE_CAP) {
    // Evict the oldest (first insertion-order entry).
    const oldest = PREVIEW_CACHE.keys().next().value;
    if (oldest !== undefined) PREVIEW_CACHE.delete(oldest);
  }
}

/**
 * T1.5 — user-bubble attachment chips. Inside the gold bubble we swap to
 * a semi-transparent chip so legibility holds against the gold backdrop;
 * otherwise the same visual shape as the composer's pending-chip row.
 */
export function AttachmentsStrip({ attachments }: { attachments: UiAttachment[] }) {
  return (
    <ul
      className="mb-2 flex flex-wrap items-start gap-1.5"
      data-testid="bubble-attachments"
    >
      {attachments.map((a) =>
        a.mime.startsWith('image/') ? (
          <AttachmentImageTile key={a.id} attachment={a} />
        ) : a.mime.startsWith('video/') ? (
          <li
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/[0.08] px-2 py-0.5 text-[11px] text-purple-500 dark:text-purple-300"
            title={a.mime}
            data-testid={`bubble-attachment-${a.id}`}
          >
            <Icon icon={Film} size="xs" className="opacity-70" />
            <span className="max-w-[220px] truncate">{a.name}</span>
          </li>
        ) : (
          <li
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-bg-elev-2/70 px-2 py-0.5 text-[11px] text-fg-muted"
            title={a.mime}
            data-testid={`bubble-attachment-${a.id}`}
          >
            <Icon icon={Paperclip} size="xs" className="opacity-70" />
            <span className="max-w-[220px] truncate">{a.name}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * T1.5d — per-image thumbnail tile. Fires a lazy `attachment_preview`
 * IPC on mount; until it resolves (or when it fails, e.g. file has
 * been GC'd), we show a filename-only chip so the bubble layout never
 * jumps. The preview IPC is capped at 5 MB on the backend — oversize
 * images also fall back to the chip.
 *
 * Preview data URLs are cached at module scope so virtualised scroll
 * doesn't re-fire the IPC every time a bubble enters the viewport.
 * See `PREVIEW_CACHE` above.
 */
function AttachmentImageTile({ attachment }: { attachment: UiAttachment }) {
  // Initialize from cache so the first paint already shows the image
  // when we scroll back to an already-seen attachment. `useState`
  // initializer runs once per mount — exactly the right window.
  const cached = cacheGet(attachment.path);
  const [url, setUrl] = useState<string | null>(
    cached?.kind === 'ok' ? cached.url : null,
  );
  const [failed, setFailed] = useState<boolean>(cached?.kind === 'failed');

  useEffect(() => {
    // Already resolved from cache → no IPC.
    if (cached) return;
    let cancelled = false;
    attachmentThumbnail(attachment.path)
      .then((data) => {
        cacheSet(attachment.path, { kind: 'ok', url: data });
        if (!cancelled) setUrl(data);
      })
      .catch(() => {
        cacheSet(attachment.path, { kind: 'failed' });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `cached` is computed at mount and never changes across this
    // component's lifetime; intentionally kept off the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.path, attachment.mime]);

  // On preview failure, fall back to the filename chip so the user
  // still sees that an image was attached.
  if (failed || (!url && attachment.size > 5 * 1024 * 1024)) {
    return (
      <li
        className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-bg-elev-2/70 px-2 py-0.5 text-[11px] text-fg-muted"
        title={`${attachment.mime} · preview unavailable`}
        data-testid={`bubble-attachment-${attachment.id}`}
      >
        <Icon icon={Paperclip} size="xs" className="opacity-70" />
        <span className="max-w-[220px] truncate">{attachment.name}</span>
      </li>
    );
  }

  return (
    <li
      className="overflow-hidden rounded-md bg-bg-elev-2/70"
      title={`${attachment.name} · ${attachment.mime}`}
      data-testid={`bubble-attachment-${attachment.id}`}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className="block h-24 w-24 object-cover"
          data-testid={`bubble-attachment-image-${attachment.id}`}
        />
      ) : (
        // Placeholder keeps the layout stable while the preview loads.
        <div className="flex h-24 w-24 items-center justify-center text-[11px] opacity-70">
          <Icon icon={Loader2} size="md" className="animate-spin" />
        </div>
      )}
    </li>
  );
}
