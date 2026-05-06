import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Loader2, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  visionProxyClearCache,
  visionProxyGet,
  visionProxySet,
  type VisionProxyConfig,
} from '@/lib/ipc';

import { Field, Section } from '../shared';

/**
 * **Vision Proxy** Settings section.
 *
 * Lets a user route image attachments through a separate vision-
 * capable LLM when their primary chat model can't see images. The
 * proxy turns each image into a text description that's inlined
 * into the user's message, so non-vision models like
 * `deepseek-chat` / `o1-preview` / many local LLMs can still
 * respond meaningfully to screenshots.
 *
 * Behaviour:
 * - Disabled by default. Toggle on, fill in model + endpoint +
 *   key (or env var name), save.
 * - Cache lives at `~/.hermes/vision_cache/<sha256>.txt`. The
 *   "Clear cache" button wipes it; use after changing the model
 *   to force re-describe the same image with the new one.
 * - Default prompt asks for objects + on-image text + relative
 *   coordinates. Override prompt to tune for your use case
 *   (e.g. "extract all numeric values as a markdown table").
 */
export function VisionProxySection() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<VisionProxyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await visionProxyGet();
        if (!cancelled) setDraft(cfg);
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await visionProxySet({
        enabled: draft.enabled,
        model: draft.model.trim(),
        base_url: draft.base_url.trim(),
        api_key: draft.api_key.trim(),
        api_key_env: draft.api_key_env?.trim() || null,
        prompt: draft.prompt,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onClearCache = async () => {
    try {
      const n = await visionProxyClearCache();
      setClearedCount(n);
      setTimeout(() => setClearedCount(null), 4000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  if (loading || !draft) {
    return (
      <Section
        id="settings-vision-proxy"
        title={
          <span className="flex items-center gap-2">
            <Icon icon={Eye} size={16} className="text-fg-muted" />
            <span>{t('settings.vision_proxy.title', { defaultValue: '视觉代理' })}</span>
          </span>
        }
      >
        <div className="text-xs text-fg-muted">
          <Icon icon={Loader2} size={12} className="animate-spin" /> {t('common.loading')}
        </div>
      </Section>
    );
  }

  const justSaved = savedAt && Date.now() - savedAt < 2000;

  return (
    <Section
      id="settings-vision-proxy"
      title={
        <span className="flex items-center gap-2">
          <Icon icon={Eye} size={16} className="text-fg-muted" />
          <span>{t('settings.vision_proxy.title', { defaultValue: '视觉代理' })}</span>
        </span>
      }
      description={t('settings.vision_proxy.description', {
        defaultValue:
          '当前对话模型不支持图片时，自动调用支持视觉的模型识别图片，把描述（含可见文字、坐标、对象）转给当前模型。零修改 Hermes Agent；通过 Corey 的 chat IPC 预处理实现。',
      })}
    >
      {error && (
        <div className="rounded border border-danger/40 bg-danger/5 px-2 py-1 text-[11px] text-danger">
          {error}
        </div>
      )}
      {clearedCount !== null && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-600 dark:text-emerald-400">
          {t('settings.vision_proxy.cleared', {
            defaultValue: `缓存已清空（${clearedCount} 张图）`,
            count: clearedCount,
          })}
        </div>
      )}

      <label className="flex items-center gap-2 rounded border border-border bg-bg-elev-1 p-3 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="accent-gold-500"
          data-testid="vision-proxy-enabled"
        />
        <span>
          {t('settings.vision_proxy.enable', { defaultValue: '启用视觉代理（仅在当前模型不支持视觉时触发）' })}
        </span>
      </label>

      <div className={`flex flex-col gap-3 ${draft.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <Field
          label={t('settings.vision_proxy.model', { defaultValue: '视觉模型' })}
          hint={t('settings.vision_proxy.model_hint', {
            defaultValue: '示例：openai/gpt-4o-mini · qwen-vl-plus · anthropic/claude-3.5-sonnet',
          })}
        >
          <input
            type="text"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="gpt-4o-mini"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field label={t('settings.vision_proxy.base_url', { defaultValue: 'Base URL' })}>
          <input
            type="text"
            value={draft.base_url}
            onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field
          label={t('settings.vision_proxy.api_key_env', { defaultValue: 'API Key 环境变量名（推荐）' })}
          hint={t('settings.vision_proxy.api_key_env_hint', {
            defaultValue: '比如 OPENAI_API_KEY、DASHSCOPE_API_KEY，从进程 env 或 ~/.hermes/.env 读取。优先级高于下面的明文。',
          })}
        >
          <input
            type="text"
            value={draft.api_key_env ?? ''}
            onChange={(e) => setDraft({ ...draft, api_key_env: e.target.value })}
            placeholder="OPENAI_API_KEY"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field
          label={t('settings.vision_proxy.api_key', { defaultValue: 'API Key（明文，备用）' })}
          hint={t('settings.vision_proxy.api_key_hint', {
            defaultValue: '不推荐写在这里。设置上面的环境变量名后留空即可。',
          })}
        >
          <input
            type="password"
            value={draft.api_key}
            onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
            placeholder="sk-..."
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field
          label={t('settings.vision_proxy.prompt', { defaultValue: '识别提示词（留空走默认）' })}
        >
          <textarea
            rows={4}
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            placeholder={t('settings.vision_proxy.prompt_placeholder', {
              defaultValue: '默认会让模型描述对象、可见文字（含坐标）、风格、表格数据。可覆盖以适配你的场景。',
            })}
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void onClearCache()}
          data-testid="vision-proxy-clear-cache"
        >
          <Icon icon={Trash2} size={12} />
          {t('settings.vision_proxy.clear_cache', { defaultValue: '清空缓存' })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => void onSave()}
          disabled={saving}
          data-testid="vision-proxy-save"
        >
          <Icon icon={saving ? Loader2 : Save} size={12} className={saving ? 'animate-spin' : ''} />
          {justSaved
            ? t('common.saved', { defaultValue: '已保存' })
            : t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Section>
  );
}
