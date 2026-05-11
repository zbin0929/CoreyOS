import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play, Sparkles, Lock, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { skillCuratorExec, type CuratorCommandResult } from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Settings → Skill Curator panel.
 *
 * Surfaces Hermes Agent's built-in curator (`hermes curator`)
 * to non-CLI users. The curator is a background pass that:
 *
 *  - tracks `view / use / patch` count per agent-created skill
 *  - moves long-unused skills `active → stale → archived`
 *  - periodically asks an aux LLM to consolidate near-duplicates
 *
 * It runs automatically on the gateway's cron ticker (every 7 days
 * by default, only when the agent has been idle ≥ 2 h). This panel
 * is the "show me what it's doing + let me intervene" UI.
 *
 * Layout:
 *
 *   [status panel — raw `hermes curator status` output in <pre>]
 *   [Run review now]  [Pause / Resume]
 *   [pin / unpin / restore <skill_name>]
 *
 * We don't try to parse the curator output into structured chrome
 * because Hermes doesn't expose a stable JSON schema and the plain
 * text is already quite readable. If we ever get a `--json` flag
 * upstream we can revisit.
 *
 * Pin / unpin / restore take a skill name — the user types it. We
 * don't preload a dropdown because the *interesting* skill name
 * is usually visible in the status output above (LRU list).
 */
export function SkillCuratorSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CuratorCommandResult | null>(null);
  const [busy, setBusy] = useState<'status' | 'run' | 'pause' | 'resume' | 'pin' | null>(null);
  const [actionResult, setActionResult] = useState<CuratorCommandResult | null>(null);
  const [skillNameInput, setSkillNameInput] = useState('');

  const refresh = useCallback(async () => {
    setBusy('status');
    try {
      const r = await skillCuratorExec(['status']);
      setStatus(r);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runOnce() {
    setBusy('run');
    setActionResult(null);
    try {
      // `--sync` is spliced in server-side so the user sees the
      // review summary in the action panel. Long runs (minutes)
      // block the button but at least there's no "did it work?"
      // ambiguity.
      const r = await skillCuratorExec(['run']);
      setActionResult(r);
      // Re-pull status after the run completes so the LRU list +
      // last-run timestamp reflect what just happened.
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(next: 'pause' | 'resume') {
    setBusy(next);
    setActionResult(null);
    try {
      const r = await skillCuratorExec([next]);
      setActionResult(r);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function skillAction(verb: 'pin' | 'unpin' | 'restore') {
    const name = skillNameInput.trim();
    if (!name) return;
    setBusy('pin');
    setActionResult(null);
    try {
      const r = await skillCuratorExec([verb, name]);
      setActionResult(r);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const cliMissing = status?.cli_available === false;

  return (
    <Section
      id="settings-skill-curator"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon icon={Sparkles} size="sm" />
          {t('settings.curator.title')}
        </span>
      }
      description={t('settings.curator.desc')}
    >
      <div className="flex flex-col gap-3">
        {cliMissing && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
            {t('settings.curator.cli_missing')}
          </p>
        )}

        {/* Status panel — raw stdout, mono, scrollable. */}
        <div className="rounded-md border border-border bg-bg-elev-2 p-3 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-fg">
              {t('settings.curator.status_label')}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy !== null}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elev-1 hover:text-fg disabled:opacity-40"
              title={t('settings.curator.refresh')}
              data-testid="curator-refresh"
            >
              {busy === 'status' ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : (
                <Icon icon={RefreshCcw} size="xs" />
              )}
            </button>
          </div>
          {status === null && busy === 'status' ? (
            <span className="text-fg-subtle">{t('common.loading')}</span>
          ) : status === null ? (
            <span className="text-fg-subtle">{t('settings.curator.empty')}</span>
          ) : (
            <pre
              className="max-h-72 overflow-auto whitespace-pre font-mono text-[11px] text-fg"
              data-testid="curator-status"
            >
              {status.stdout || status.stderr || t('settings.curator.empty')}
            </pre>
          )}
        </div>

        {/* Action row 1: run review + pause/resume */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={runOnce}
            disabled={busy !== null || cliMissing}
            data-testid="curator-run"
          >
            {busy === 'run' ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Play} size="xs" />
            )}
            {t('settings.curator.run')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void toggleEnabled('pause')}
            disabled={busy !== null || cliMissing}
            data-testid="curator-pause"
          >
            {t('settings.curator.pause')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void toggleEnabled('resume')}
            disabled={busy !== null || cliMissing}
            data-testid="curator-resume"
          >
            {t('settings.curator.resume')}
          </Button>
        </div>

        {/* Action row 2: per-skill pin/unpin/restore */}
        <div className="rounded-md border border-border bg-bg-elev-2 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Icon icon={Lock} size="xs" className="text-fg-muted" />
            <span className="font-medium text-fg">
              {t('settings.curator.pin_label')}
            </span>
          </div>
          <p className="mb-2 text-xs text-fg-subtle">
            {t('settings.curator.pin_hint')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={skillNameInput}
              onChange={(e) => setSkillNameInput(e.target.value)}
              placeholder={t('settings.curator.pin_ph')}
              className="min-w-[10rem] flex-1 rounded-md border border-border bg-bg-elev-1 px-2 py-1 font-mono text-xs text-fg outline-none focus:border-gold-500"
              data-testid="curator-skill-name"
            />
            <Button
              variant="ghost"
              onClick={() => void skillAction('pin')}
              disabled={busy !== null || cliMissing || !skillNameInput.trim()}
              data-testid="curator-pin"
            >
              {t('settings.curator.pin')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void skillAction('unpin')}
              disabled={busy !== null || cliMissing || !skillNameInput.trim()}
              data-testid="curator-unpin"
            >
              {t('settings.curator.unpin')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void skillAction('restore')}
              disabled={busy !== null || cliMissing || !skillNameInput.trim()}
              data-testid="curator-restore"
            >
              {t('settings.curator.restore')}
            </Button>
          </div>
        </div>

        {/* Last action output — collapses to nothing when no
            action has fired yet. */}
        {actionResult && (
          <pre
            className="max-h-52 overflow-auto whitespace-pre rounded-md border border-border bg-bg-elev-1 p-3 font-mono text-[11px] text-fg"
            data-testid="curator-action-output"
          >
            {actionResult.stdout || actionResult.stderr || ''}
          </pre>
        )}
      </div>
    </Section>
  );
}
