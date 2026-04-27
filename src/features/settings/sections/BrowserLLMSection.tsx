import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Stethoscope } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import {
  browserConfigGet,
  browserConfigSet,
  browserDiagnose,
  ipcErrorMessage,
  type BrowserLLMConfig,
} from '@/lib/ipc';
import { llmProfileList, type LlmProfile } from '@/lib/ipc/hermes-instances';

import { Section } from '../shared';

/**
 * Configure the LLM the headless browser-runner uses for autonomous
 * page interactions. Writes to `~/.hermes/browser_config.json`.
 *
 * The UI intentionally exposes ONE control — a profile picker — and
 * auto-saves on selection. The earlier iteration asked users to retype
 * model + API key + base URL that they'd already set up on the LLMs
 * page; that duplication was the source of real bug reports ("I saved
 * a profile, why doesn't browser automation see it?"). Now selecting
 * a profile persists `{model, base_url, api_key_env}` and the Rust
 * runner resolves the actual key from `~/.hermes/.env` at launch via
 * `browser_config::resolve_api_key`.
 *
 * The Diagnose button stays — it surfaces Node.js / runner-script /
 * LLM-config readiness so users can debug a failing workflow step at
 * a glance.
 */
export function BrowserLLMSection() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<BrowserLLMConfig | null>(null);
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<Awaited<ReturnType<typeof browserDiagnose>> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    void browserConfigGet()
      .then(setCfg)
      .catch(() => setCfg({ model: '', api_key: '', base_url: '' }));
    // Load profiles from `llm_profile_list`. Failure is non-fatal —
    // the empty-profiles affordance below already covers that case.
    void llmProfileList()
      .then((file) => {
        setProfiles(file.profiles ?? []);
        setProfilesLoaded(true);
      })
      .catch(() => setProfilesLoaded(true));
  }, []);

  // Match the saved cfg back to a profile so the dropdown reflects
  // the current selection. Prefer id match via `api_key_env` when
  // present (new-style), fall back to model + base_url match for
  // legacy configs written by the old four-field form.
  const matchedProfileId = useMemo(() => {
    if (!cfg) return '';
    const byEnv = cfg.api_key_env
      ? profiles.find((p) => p.api_key_env === cfg.api_key_env && p.model === cfg.model)
      : null;
    if (byEnv) return byEnv.id;
    const byFields = profiles.find(
      (p) => p.model === cfg.model && (p.base_url || '') === (cfg.base_url || ''),
    );
    return byFields?.id ?? '';
  }, [profiles, cfg]);

  async function pickProfile(profile: LlmProfile) {
    setSaving(true);
    setError(null);
    setSaved(false);
    const next: BrowserLLMConfig = {
      model: profile.model,
      base_url: profile.base_url || '',
      // The api_key field stays empty for new-style writes; the Rust
      // runner resolves the secret from `api_key_env` at launch. We
      // deliberately don't copy over a legacy literal key that might
      // be sitting in the old config.
      api_key: '',
      api_key_env: profile.api_key_env ?? null,
    };
    try {
      await browserConfigSet(next);
      setCfg(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title={t('settings.browser_llm_title')}
      description={t('settings.browser_llm_desc')}
    >
      <div className="flex max-w-lg flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_profile')}</span>
          {!profilesLoaded ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-2.5 py-2 text-xs text-fg-subtle">
              <Icon icon={Loader2} size="xs" className="animate-spin" />
              {t('common.loading')}
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-bg-elev-1 px-2.5 py-2 text-xs text-fg-muted">
              <span>{t('settings.browser_llm_no_profiles')}</span>
              <Link to="/profiles" className="text-accent hover:underline">
                {t('settings.browser_llm_go_profiles')} →
              </Link>
            </div>
          ) : (
            <Combobox
              value={matchedProfileId}
              onChange={(id) => {
                const profile = profiles.find((p) => p.id === id);
                if (profile) void pickProfile(profile);
              }}
              options={profiles.map((p) => ({
                value: p.id,
                label: `${p.label} — ${p.model}`,
              }))}
              placeholder={t('settings.browser_llm_pick_profile')}
            />
          )}
        </label>

        {/* Inline status — saves happen on select, so the user needs a
            tiny signal that the click just persisted. Auto-dismisses
            after 2s. */}
        <div className="flex min-h-[20px] items-center gap-3 text-xs">
          {saving && (
            <span className="inline-flex items-center gap-1 text-fg-subtle">
              <Icon icon={Loader2} size="xs" className="animate-spin" />
              {t('settings.saving')}
            </span>
          )}
          {saved && !saving && (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Icon icon={Check} size="xs" />
              {t('settings.saved')}
            </span>
          )}
          {error && <span className="text-red-500">{error}</span>}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            disabled={diagLoading}
            onClick={async () => {
              setDiagLoading(true);
              try {
                setDiag(await browserDiagnose());
              } catch {
                setDiag(null);
              }
              setDiagLoading(false);
            }}
          >
            {diagLoading ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Stethoscope} size="xs" />
            )}
            {t('settings.browser_diag')}
          </Button>
        </div>

        {diag && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev-2 p-3 text-xs">
            <div className={diag.node_available ? 'text-green-500' : 'text-red-500'}>
              Node.js: {diag.node_available ? `✓ ${diag.node_version}` : '✗ 未找到'}
            </div>
            <div className={diag.runner_found ? 'text-green-500' : 'text-red-500'}>
              Browser Runner: {diag.runner_found ? '✓ 已找到' : '✗ 未找到'}
            </div>
            <div className={diag.browser_config_set ? 'text-green-500' : 'text-yellow-500'}>
              LLM 配置: {diag.browser_config_set ? '✓ 已设置' : '⚠ 未设置'}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
