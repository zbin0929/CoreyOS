import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Save, Stethoscope } from 'lucide-react';

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

import { Section } from '../shared';

/**
 * Configure the LLM the headless browser-runner uses for autonomous
 * page interactions. Save is independent of the gateway form — this
 * config lives in its own JSON, persisted by `browser_config_set`.
 *
 * The Diagnose button surfaces the three preconditions the runner
 * needs (Node.js, runner script, LLM config) so users can see at a
 * glance which one is missing.
 */
export function BrowserLLMSection() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<BrowserLLMConfig>({
    model: 'openai/gpt-4o-mini',
    api_key: '',
    base_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<Awaited<ReturnType<typeof browserDiagnose>> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    void browserConfigGet()
      .then(setCfg)
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await browserConfigSet(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={t('settings.browser_llm_title')}
      description={t('settings.browser_llm_desc')}
    >
      <div className="flex max-w-lg flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_model')}</span>
          <Combobox
            value={cfg.model}
            onChange={(v) => setCfg({ ...cfg, model: v })}
            options={[
              { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
              { value: 'openai/gpt-4o', label: 'GPT-4o' },
              { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
              { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
              { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
              { value: 'ollama/llama3', label: 'Ollama Llama 3 (本地)' },
            ]}
            placeholder="选择模型或输入自定义名称"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_api_key')}</span>
          <input
            type="password"
            className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
            value={cfg.api_key}
            onChange={(e) => setCfg({ ...cfg, api_key: e.target.value })}
            placeholder="sk-..."
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_base_url')}</span>
          <input
            className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
            value={cfg.base_url}
            onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })}
            placeholder="https://api.openai.com/v1（留空用默认）"
          />
        </label>

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Save} size="xs" />
            )}
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
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
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <Icon icon={Check} size="xs" /> {t('settings.saved')}
            </span>
          )}
          {error && <span className="text-xs text-red-500">{error}</span>}
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
