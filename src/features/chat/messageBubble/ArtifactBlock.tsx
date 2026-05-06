import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';

import { formatArtifactBytes } from './artifactHelpers';

const LANGUAGE_TO_EXT: Record<string, string> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  rs: 'rs',
  rust: 'rs',
  go: 'go',
  java: 'java',
  kt: 'kt',
  c: 'c',
  cpp: 'cpp',
  cs: 'cs',
  rb: 'rb',
  php: 'php',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  ps1: 'ps1',
  powershell: 'ps1',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  xml: 'xml',
  html: 'html',
  css: 'css',
  sql: 'sql',
  md: 'md',
  markdown: 'md',
  toml: 'toml',
};

const COLLAPSE_LINE_COUNT = 50;

interface Props {
  rawContent: string;
  language?: string;
  highlightedHtml: string;
}

/**
 * Wraps a long fenced code block as an Artifact card with header
 * (language + line count) and toolbar (copy / download / collapse).
 *
 * Triggered when content has ≥ 30 lines or ≥ 2000 chars. Below that
 * we render the bare highlighted code block as before.
 */
export function ArtifactBlock({ rawContent, language, highlightedHtml }: Props) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const lineCount = useMemo(() => rawContent.split('\n').length, [rawContent]);
  const charCount = rawContent.length;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // best-effort; webview clipboard requires HTTPS or localhost which Tauri provides.
    }
  };

  const onDownload = () => {
    const ext = (language && LANGUAGE_TO_EXT[language.toLowerCase()]) ?? 'txt';
    const filename = `artifact-${Date.now()}.${ext}`;
    const blob = new Blob([rawContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const sizeLabel = `${lineCount} 行 · ${formatArtifactBytes(charCount)}`;
  const langLabel = language || 'text';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-bg-elev-1">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-elev-2 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={FileText} size={13} className="text-fg-muted" />
          <code className="font-mono text-[11px] font-medium text-fg">{langLabel}</code>
          <span className="truncate text-[11px] text-fg-subtle">{sizeLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToolbarButton
            label={copied ? '已复制' : '复制'}
            icon={copied ? Check : Copy}
            onClick={onCopy}
            highlighted={copied}
          />
          <ToolbarButton label="下载" icon={Download} onClick={onDownload} />
          <ToolbarButton
            label={collapsed ? '展开' : '折叠'}
            icon={collapsed ? ChevronDown : ChevronUp}
            onClick={() => setCollapsed((v) => !v)}
          />
        </div>
      </div>
      {!collapsed && (
        <code
          className={cn(
            'hljs block overflow-x-auto bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#e6edf3]',
            language && `language-${language}`,
            lineCount > COLLAPSE_LINE_COUNT && 'max-h-[420px] overflow-y-auto',
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  highlighted,
}: {
  label: string;
  icon: typeof Copy;
  onClick: () => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition',
        highlighted
          ? 'text-success'
          : 'text-fg-muted hover:bg-bg-elev-3 hover:text-fg',
      )}
    >
      <Icon icon={icon} size={12} />
      <span>{label}</span>
    </button>
  );
}

