import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  presetInstall,
  skillList,
  type PresetInstallResult,
} from '@/lib/ipc';

/**
 * "Activate starter content" CTA, rendered on Home above the
 * onboarding checklist when the user has no skills installed.
 *
 * Wraps the `preset_install` IPC: one click drops 5 generic skills +
 * a `fetch` MCP server + memory-file templates into ~/.hermes/. Safe
 * to re-run (backend skips existing files).
 *
 * After install, the card collapses into a subtle confirmation with
 * a link to the Skills page so the user can peek at what arrived.
 */
export function PresetCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { kind: 'probing' }
    | { kind: 'empty' }
    | { kind: 'populated'; count: number }
    | { kind: 'installing' }
    | { kind: 'installed'; result: PresetInstallResult }
    | { kind: 'error'; message: string }
  >({ kind: 'probing' });

  // Detect whether the user already has skills. If yes, the card goes
  // into quiet "populated" state. If no, we show the big CTA.
  useEffect(() => {
    skillList()
      .then((rows) => {
        setState(
          rows.length === 0
            ? { kind: 'empty' }
            : { kind: 'populated', count: rows.length },
        );
      })
      .catch((e) => setState({ kind: 'error', message: ipcErrorMessage(e) }));
  }, []);

  async function install() {
    setState({ kind: 'installing' });
    try {
      const result = await presetInstall('default');
      setState({ kind: 'installed', result });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  // Nothing to show while we're probing; avoids layout jump.
  if (state.kind === 'probing') return null;

  // Already has skills + hasn't just installed → stay out of the way.
  if (state.kind === 'populated') return null;

  if (state.kind === 'installed') {
    const n = state.result.installed.length;
    return (
      <section
        className={cn(
          'flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4',
        )}
        data-testid="home-preset-installed"
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
          <Icon icon={Check} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">
            {t('home.preset_done_title', { n })}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {state.result.installed.slice(0, 5).join(' · ')}
            {state.result.installed.length > 5 && ' · …'}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'flex items-center gap-4 rounded-lg border border-gold-500/40 bg-gold-500/5 p-4',
      )}
      data-testid="home-preset-card"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-500">
        <Icon icon={Package} size="md" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">
          {t('home.preset_title')}
        </div>
        <div className="text-xs text-fg-muted">
          {t('home.preset_desc')}
        </div>
        {state.kind === 'error' && (
          <div
            className="mt-1 text-xs text-danger"
            data-testid="home-preset-error"
          >
            {state.message}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={install}
        disabled={state.kind === 'installing'}
        data-testid="home-preset-install"
      >
        {state.kind === 'installing' ? (
          <>
            <Icon icon={Loader2} size="xs" className="animate-spin" />
            {t('home.preset_installing')}
          </>
        ) : (
          t('home.preset_install')
        )}
      </Button>
    </section>
  );
}
