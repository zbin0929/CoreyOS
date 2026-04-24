import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, FileCode2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { UiMessage } from '@/stores/chat';

/**
 * T-polish — one-click export of the current chat session.
 *
 * Two formats:
 *   - **Markdown** (`.md`) — role-labeled, easy to paste into docs /
 *     issue trackers. Attachments render as bullet refs with a
 *     `(path)` hint; binary content is NOT embedded.
 *   - **JSON** (`.json`) — full-fidelity dump of every `UiMessage`
 *     field (tool calls, reasoning, feedback, ids, timestamps). Good
 *     for re-importing elsewhere or running offline diagnostics.
 *
 * Both go through the browser's native download flow (a synthesized
 * `<a download>` click) so nothing hits the network or the Tauri
 * sandbox — the file lands in the user's Downloads folder exactly
 * like any other web download.
 */
export function ExportSessionMenu({
  title,
  messages,
}: {
  /** Session title, used to seed the suggested filename. */
  title: string;
  messages: UiMessage[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Empty / pending-only sessions have nothing to export. Mirrors the
  // pattern used by the neighbouring SaveAsSkill button.
  const canExport = messages.some(
    (m) => !m.pending && !m.error && m.content.length > 0,
  );

  // Outside-click + ESC to close. Pointerdown beats `click` so the
  // menu closes BEFORE a button inside is processed, which matters
  // for tests that simulate fast interactions.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handle(format: 'md' | 'json') {
    setOpen(false);
    const slug = fileSlug(title);
    if (format === 'md') {
      downloadBlob(
        `${slug}.md`,
        'text/markdown;charset=utf-8',
        sessionToMarkdown(title, messages),
      );
    } else {
      downloadBlob(
        `${slug}.json`,
        'application/json;charset=utf-8',
        JSON.stringify(
          { title, exportedAt: new Date().toISOString(), messages },
          null,
          2,
        ),
      );
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={!canExport}
        title={
          canExport
            ? t('chat_page.export_title')
            : t('chat_page.export_disabled_hint')
        }
        data-testid="chat-export"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon icon={Download} size="sm" />
        {t('chat_page.export')}
        <Icon icon={ChevronDown} size="xs" className="opacity-60" />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md',
            'border border-border bg-bg-elev-1 shadow-2 text-xs',
          )}
          data-testid="chat-export-menu"
        >
          <MenuItem
            icon={FileText}
            label={t('chat_page.export_markdown')}
            hint=".md"
            onClick={() => handle('md')}
            testId="chat-export-md"
          />
          <MenuItem
            icon={FileCode2}
            label={t('chat_page.export_json')}
            hint=".json"
            onClick={() => handle('json')}
            testId="chat-export-json"
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  testId,
}: {
  icon: typeof FileText;
  label: string;
  hint: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg hover:bg-bg-elev-2"
    >
      <Icon icon={icon} size="xs" className="text-fg-subtle" />
      <span className="flex-1">{label}</span>
      <span className="font-mono text-[10px] text-fg-subtle">{hint}</span>
    </button>
  );
}

/** Format the conversation as role-labeled Markdown. Keeps it
 *  readable when pasted into GitHub / Notion / Obsidian. */
function sessionToMarkdown(title: string, messages: UiMessage[]): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Exported ${new Date().toLocaleString()}_`);
  lines.push('');
  for (const m of messages) {
    if (m.pending && !m.content) continue; // skip empty pending turn
    const role =
      m.role === 'user'
        ? 'User'
        : m.role === 'assistant'
          ? 'Assistant'
          : m.role;
    lines.push(`## ${role}`);
    lines.push('');
    if (m.reasoning && m.reasoning.trim()) {
      lines.push('<details><summary>Reasoning</summary>');
      lines.push('');
      lines.push(m.reasoning.trimEnd());
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (m.error) {
      lines.push(`> **Error:** ${m.error}`);
    } else if (m.content) {
      lines.push(m.content.trimEnd());
    }
    if (m.attachments && m.attachments.length > 0) {
      lines.push('');
      lines.push('**Attachments:**');
      for (const a of m.attachments) {
        lines.push(`- \`${a.name}\` (${a.mime}) — ${a.path}`);
      }
    }
    if (m.toolCalls && m.toolCalls.length > 0) {
      lines.push('');
      lines.push('**Tools used:**');
      for (const tc of m.toolCalls) {
        lines.push(`- ${tc.emoji ?? ''} \`${tc.tool}\` · ${tc.label}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function fileSlug(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'chat';
}

function downloadBlob(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // `revokeObjectURL` after a tick — some browsers cancel the
  // download if the URL is revoked synchronously in the same frame
  // as the click().
  window.setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
