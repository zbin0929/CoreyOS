import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Download,
  Loader2,
  Search,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  skillHubExec,
  type HubCommandResult,
} from '@/lib/ipc';

/**
 * Phase 7 · T7.4 — Skill Hub browser.
 *
 * Thin UI over `hermes skills browse / search / install`. The CLI
 * already federates 7+ hub sources (official, skills-sh, well-known,
 * github, clawhub, lobehub, claude-marketplace) — we just invoke it
 * and render the captured stdout. No upstream-format parsing: if
 * Hermes changes its output tomorrow, this panel still works.
 *
 * Layout:
 *   - Source dropdown + search input + Browse/Search button
 *   - Install-slug input + Install button
 *   - Output pane below, monospace <pre>
 *
 * What this intentionally does NOT do:
 *   - Parse the browse output into a structured list. The CLI output
 *     is stable enough to read but the exact shape is upstream's
 *     concern, not ours. A structured list would need a `--json`
 *     flag that isn't officially stable across subcommands.
 *   - Guarantee safety for `--force install`. Users paste the slug
 *     they want; if the CLI's security scan rejects, they see the
 *     output and decide whether to add `--force` themselves.
 */
export function HubPanel() {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('official');
  const [query, setQuery] = useState('');
  const [installSlug, setInstallSlug] = useState('');
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<HubCommandResult | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (args: string[]) => {
    setRunning(true);
    setError(null);
    setLastCommand(`hermes skills ${args.join(' ')}`);
    try {
      const res = await skillHubExec(args);
      setLast(res);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setLast(null);
    } finally {
      setRunning(false);
    }
  }, []);

  const onBrowse = () => {
    const q = query.trim();
    const args: string[] = q
      ? ['search', q, '--source', source]
      : ['browse', '--source', source];
    void run(args);
  };

  const onInstall = () => {
    const slug = installSlug.trim();
    if (!slug) return;
    void run(['install', slug]);
  };

  // When the CLI isn't installed, nothing else on this page works.
  // Show a single clear message instead of the usual panels.
  if (last && !last.cli_available) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div
          className="flex max-w-md flex-col items-center gap-3 rounded-md border border-warning/40 bg-warning/5 p-6 text-center text-sm"
          data-testid="skill-hub-cli-missing"
        >
          <Icon icon={AlertCircle} size="lg" className="text-warning" />
          <div className="font-semibold text-fg">{t('skill_hub.cli_missing_title')}</div>
          <p className="text-xs text-fg-muted">{t('skill_hub.cli_missing_desc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      data-testid="skill-hub-panel"
    >
      {/* Browse / search row */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t('skill_hub.browse_title')}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">{t('skill_hub.source')}</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
              data-testid="skill-hub-source"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs">
            <span className="text-fg-muted">{t('skill_hub.query')}</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('skill_hub.query_placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) onBrowse();
              }}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
              data-testid="skill-hub-query"
            />
          </label>
          <Button
            size="sm"
            variant="primary"
            onClick={onBrowse}
            disabled={running}
            data-testid="skill-hub-browse"
          >
            {running ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Search} size="sm" />
            )}
            {query.trim() ? t('skill_hub.search') : t('skill_hub.browse')}
          </Button>
        </div>
      </section>

      {/* Install row */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t('skill_hub.install_title')}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[320px] flex-1 flex-col gap-1 text-xs">
            <span className="text-fg-muted">{t('skill_hub.install_slug')}</span>
            <input
              type="text"
              value={installSlug}
              onChange={(e) => setInstallSlug(e.target.value)}
              placeholder="official/security/1password"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) onInstall();
              }}
              className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg focus:border-accent focus:outline-none"
              data-testid="skill-hub-install-slug"
            />
            <span className="text-[11px] text-fg-subtle">{t('skill_hub.install_hint')}</span>
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInstall}
            disabled={running || !installSlug.trim()}
            data-testid="skill-hub-install"
          >
            <Icon icon={Download} size="sm" />
            {t('skill_hub.install')}
          </Button>
        </div>
      </section>

      {/* Output */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
          data-testid="skill-hub-error"
        >
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {last && (
        <section
          className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3"
          data-testid="skill-hub-output"
        >
          <header className="flex items-center gap-2 text-xs text-fg-muted">
            <Icon icon={TerminalIcon} size="xs" />
            <code className="font-mono">{lastCommand}</code>
            <span
              className={cn(
                'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                last.status === 0
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-danger/10 text-danger',
              )}
              data-testid="skill-hub-status"
            >
              exit {last.status}
            </span>
          </header>
          {last.stdout && (
            <pre
              className="max-h-[400px] overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-bg p-2 font-mono text-[11px] text-fg"
              data-testid="skill-hub-stdout"
            >
              {last.stdout}
            </pre>
          )}
          {last.stderr && (
            <pre
              className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded border border-danger/40 bg-danger/5 p-2 font-mono text-[11px] text-danger"
              data-testid="skill-hub-stderr"
            >
              {last.stderr}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

type Source =
  | 'official'
  | 'skills-sh'
  | 'well-known'
  | 'github'
  | 'clawhub'
  | 'lobehub'
  | 'claude-marketplace';

/** The 7 federated sources Hermes supports out of the box (verified
 *  against hermes-agent.nousresearch.com/docs/reference/cli-commands
 *  2026-04-23). Kept in sync with `hermes skills` — if upstream adds
 *  a new source, this list updates and no other code changes. */
const SOURCES: Source[] = [
  'official',
  'skills-sh',
  'well-known',
  'github',
  'clawhub',
  'lobehub',
  'claude-marketplace',
];
