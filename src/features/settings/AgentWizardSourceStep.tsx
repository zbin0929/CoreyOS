import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import type { LlmProfile } from '@/lib/ipc';

import { PROVIDER_TEMPLATES, type ProviderTemplate } from './providerTemplates';

/**
 * Step 1 — "Where's this agent's LLM coming from?"
 *
 * If the user has already configured LLM profiles on the /models page,
 * those show up as primary picks at the top — one click jumps to a
 * minimal "just name it" Step 2 with the profile pre-attached, so you
 * don't re-enter the API key every time you want a second agent on the
 * same LLM.
 *
 * Below that, the provider template grid is always available for
 * creating a fresh profile + agent pair in one shot.
 */
export function SourcePickerStep({
  profiles,
  onPickProfile,
  onPickTemplate,
}: {
  profiles: LlmProfile[];
  onPickProfile: (profile: LlmProfile) => void;
  onPickTemplate: (template: ProviderTemplate) => void;
}) {
  const { t } = useTranslation();
  const hasProfiles = profiles.length > 0;
  return (
    <div className="flex flex-col gap-4 p-4">
      {hasProfiles && (
        <section
          className="flex flex-col gap-2"
          data-testid="agent-wizard-existing-profiles"
        >
          <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {t('agent_wizard.use_existing_title')}
          </h3>
          <p className="text-xs text-fg-muted">
            {t('agent_wizard.use_existing_desc')}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPickProfile(p)}
                  className={cn(
                    'group flex w-full flex-col items-start gap-1 rounded-md border border-gold-500/30 bg-gold-500/5 p-3 text-left',
                    'transition-colors hover:border-gold-500/60 hover:bg-gold-500/10',
                  )}
                  data-testid={`agent-wizard-profile-${p.id}`}
                >
                  <span className="text-sm font-medium text-fg">
                    {p.label || p.id}
                  </span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {p.model}
                  </span>
                  <code className="truncate text-[10px] text-fg-subtle">
                    {p.base_url}
                  </code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {hasProfiles
            ? t('agent_wizard.or_new_from_provider')
            : t('agent_wizard.pick_provider')}
        </h3>
        <ul
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          data-testid="agent-wizard-providers"
        >
          {PROVIDER_TEMPLATES.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPickTemplate(p)}
                className={cn(
                  'group flex w-full flex-col items-start gap-1 rounded-md border border-border bg-bg-elev-1 p-3 text-left',
                  'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
                )}
                data-testid={`agent-wizard-provider-${p.id}`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium text-fg">{p.label}</span>
                  {p.isLocal && (
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                      {t('agent_wizard.local_tag')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-fg-muted">{p.description}</p>
                <code className="truncate text-[10px] text-fg-subtle">
                  {p.baseUrl}
                </code>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
