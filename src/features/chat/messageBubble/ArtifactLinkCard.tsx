import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileSpreadsheet,
  FileText,
  FileType,
  File as FileIcon,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { revealInFinder } from '@/features/memory/utils';
import { artifactPath, ipcErrorMessage } from '@/lib/ipc';

/**
 * In-chat card for `corey://artifact/<run_id>/<name>` links.
 *
 * The agent is told (via base soul) to emit this exact URL scheme
 * whenever it has finished writing an Excel / PDF / report. Without
 * the card the user would have to navigate to /tasks, find the run,
 * click into artifacts — three clicks and a context switch. With it
 * the file is one click away inside the chat thread that produced it.
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ [📊] sales-2026-W19.xlsx          [打开][📂] │
 *   │       Excel spreadsheet · 42 KB              │
 *   └─────────────────────────────────────────────┘
 *
 * "打开" uses Tauri's shell plugin (`open(path)`) so the OS picks
 * the default app for the extension — Excel, Numbers, Preview, etc.
 * "📂" reveals the artifact folder in Finder / Explorer for users
 * who want to copy / rename / share the file elsewhere.
 *
 * Outside Tauri (Storybook, Playwright on a plain browser) the open
 * call is a no-op — we degrade silently rather than throw.
 */

function pickIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return FileSpreadsheet;
  if (['docx', 'doc', 'rtf'].includes(ext)) return FileType;
  if (['pdf', 'md', 'txt'].includes(ext)) return FileText;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return ImageIcon;
  return FileIcon;
}

function friendlyKind(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  // Keep this list short — no need to enumerate every MIME on earth.
  // The customer mainly cares about Office docs + images + plain text.
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return 'Excel spreadsheet';
    case 'csv':
      return 'CSV';
    case 'docx':
    case 'doc':
      return 'Word document';
    case 'pptx':
    case 'ppt':
      return 'PowerPoint';
    case 'pdf':
      return 'PDF';
    case 'md':
      return 'Markdown';
    case 'json':
      return 'JSON';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'Image';
    default:
      return ext ? ext.toUpperCase() : 'File';
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  runId: string;
  name: string;
}

export function ArtifactLinkCard({ runId, name }: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve the abs path + size up front so the card can show
  // metadata (size, exists?) without waiting for the user to click.
  // If the artifact is missing (agent claimed to write it but didn't)
  // we surface a clear error rather than failing only at open time.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await artifactPath(runId, name);
        if (cancelled) return;
        setPath(p);
        try {
          // We don't have a dedicated stat IPC — list and find the
          // entry matching `name`. This is fine because artifact dirs
          // are small (under a hundred entries in practice).
          const { artifactList } = await import('@/lib/ipc');
          const list = await artifactList(runId);
          const found = list.find((a) => a.name === name);
          if (!cancelled && found) setSize(found.size);
        } catch {
          /* size is decorative; ignore failures */
        }
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, name]);

  const Icon_ = pickIcon(name);

  const onOpen = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(path);
    } catch {
      /* outside Tauri or open denied — silent */
    } finally {
      setBusy(false);
    }
  };

  const onReveal = async () => {
    if (!path) return;
    await revealInFinder(path);
  };

  return (
    <span
      className="my-1 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm"
      data-testid="chat-artifact-card"
    >
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded bg-gold-500/10 text-gold-500">
        <Icon icon={Icon_} size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-fg" title={name}>
          {name}
        </span>
        <span className="text-xs text-fg-subtle">
          {friendlyKind(name)}
          {size != null && ` · ${formatBytes(size)}`}
          {error && (
            <span className="text-danger" data-testid="chat-artifact-error">
              {' '}
              · {error}
            </span>
          )}
        </span>
      </span>
      <Button
        size="xs"
        variant="ghost"
        onClick={onOpen}
        disabled={!path || busy}
        data-testid="chat-artifact-open"
      >
        {busy ? (
          <Icon icon={Loader2} size="xs" className="animate-spin" />
        ) : (
          <Icon icon={ExternalLink} size="xs" />
        )}
        {t('chat.artifact_open')}
      </Button>
      <button
        type="button"
        onClick={onReveal}
        disabled={!path}
        title={t('chat.artifact_reveal')}
        className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elev-2 hover:text-fg disabled:opacity-40"
        data-testid="chat-artifact-reveal"
      >
        <Icon icon={FolderOpen} size="xs" />
      </button>
    </span>
  );
}
