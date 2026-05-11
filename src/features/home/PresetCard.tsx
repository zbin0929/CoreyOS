import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  presetDescribe,
  presetInstall,
  skillList,
  type PresetInstallResult,
} from '@/lib/ipc';

/**
 * Skills the v0.2.12 default preset bundles by name. If the user
 * already had Corey installed (v ≤ 0.2.11) the original preset
 * skills are in place but these four new doc-authoring ones are
 * not — the PresetCard surfaces a "refresh" CTA in that case so
 * the user picks up the new content with one click instead of
 * having to discover `hermes skills install` manually.
 *
 * Keep this list in sync with src-tauri/assets/presets/default/skills/.
 * When we bundle a new skill, add it here so existing users get
 * prompted. If a skill is removed from the preset, remove it here
 * (and bump the manifest version, see manifest.yaml).
 */
const BUNDLED_SKILL_NAMES = ['xlsx', 'docx', 'pdf', 'pptx'] as const;

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
    | { kind: 'outdated'; count: number; missing: string[] }
    | { kind: 'installing' }
    | { kind: 'installed'; result: PresetInstallResult }
    | { kind: 'error'; message: string }
  >({ kind: 'probing' });

  // Two probes in parallel:
  //  1. skillList — what does the user actually have installed?
  //  2. presetDescribe — what's in the bundled preset (for version + label)?
  // Then cross-check against BUNDLED_SKILL_NAMES. Three outcomes:
  //  - empty:     no skills at all → first-time install CTA
  //  - outdated:  has skills but missing some of our v0.2.12 bundle →
  //               smaller "Refresh starter content" CTA so existing
  //               users pick up new doc-authoring skills (xlsx etc.)
  //               without discovering `hermes skills install`
  //  - populated: has every bundled skill → stay out of the way
  // Errors collapse into the standard error state.
  useEffect(() => {
    Promise.all([skillList(), presetDescribe('default').catch(() => null)])
      .then(([rows, _manifest]) => {
        void _manifest;
        if (rows.length === 0) {
          setState({ kind: 'empty' });
          return;
        }
        // Match by either `<name>/SKILL.md` directory layout or a
        // flat `<name>.md` — Hermes accepts both, so we check by
        // basename without extension.
        const installedBaseNames = new Set(
          rows.map((r) => {
            const seg = r.path.split('/').filter(Boolean);
            // Drop trailing "SKILL.md" if present, then take the
            // last meaningful segment as the skill identifier.
            const last = seg[seg.length - 1] ?? '';
            if (last === 'SKILL.md' && seg.length >= 2) return seg[seg.length - 2];
            return last.replace(/\.md$/, '');
          }),
        );
        const missing = BUNDLED_SKILL_NAMES.filter(
          (n) => !installedBaseNames.has(n),
        );
        if (missing.length > 0) {
          setState({ kind: 'outdated', count: rows.length, missing });
        } else {
          setState({ kind: 'populated', count: rows.length });
        }
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

  // 'outdated' = has skills but is missing some of our v0.2.12 bundle.
  // Render a slimmer "Refresh starter content" card so existing users
  // can pick up the newly-bundled doc skills (xlsx/docx/pdf/pptx) with
  // one click. The same `presetInstall` IPC handles both paths — it's
  // idempotent and skips files the user already has.
  if (state.kind === 'outdated') {
    return (
      <section
        className={cn(
          'flex items-center gap-3 rounded-lg border border-gold-500/30 bg-gold-500/5 p-3',
        )}
        data-testid="home-preset-outdated"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-500">
          <Icon icon={Package} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">
            {t('home.preset_outdated_title', { n: state.missing.length })}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {state.missing.join(' · ')}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={install}
          disabled={state.kind !== 'outdated'}
          data-testid="home-preset-refresh"
        >
          {t('home.preset_refresh')}
        </Button>
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
