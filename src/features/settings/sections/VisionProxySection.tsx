import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, ExternalLink, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  llmProfileList,
  visionProxyClearCache,
  visionProxyGet,
  visionProxySet,
  type LlmProfile,
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
 * Two configuration modes:
 *
 *   1. **Profile mode** (default + recommended) — pick a vision-
 *      capable profile from Settings → Models. Single source of
 *      truth: model / base_url / api_key_env all come from the
 *      profile, so re-keying / re-pointing happens once.
 *
 *   2. **Manual mode** (advanced) — type model + base_url +
 *      api_key_env yourself. For users who don't keep an LLM
 *      Profile but already have, say, `OPENAI_API_KEY` in their
 *      env. Toggle "高级配置 (手填)" to expose.
 *
 * Cache lives at `~/.hermes/vision_cache/<sha256>.txt`. Clear
 * after changing the model to force re-describe the same image.
 */

type Mode = 'profile' | 'manual';

export function VisionProxySection() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<VisionProxyConfig | null>(null);
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('profile');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cfg, profilesFile] = await Promise.all([
          visionProxyGet(),
          llmProfileList().catch(() => ({ profiles: [] })),
        ]);
        if (cancelled) return;
        setDraft(cfg);
        setProfiles(profilesFile.profiles);
        // Pick the right initial mode: if there's no profile id
        // saved AND any of the inline fields are non-empty, the
        // user's already in manual mode; otherwise default to
        // profile mode (the new preferred path).
        const hasManual = !cfg.llm_profile_id && (cfg.model || cfg.base_url);
        setMode(hasManual ? 'manual' : 'profile');
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
      // When saving in profile mode, blank out the inline fields so
      // a switch back to manual later starts from a clean slate (no
      // stale model + stale profile_id fighting each other).
      const next: VisionProxyConfig =
        mode === 'profile'
          ? {
              ...draft,
              llm_profile_id: draft.llm_profile_id.trim(),
              model: '',
              base_url: '',
              api_key: '',
              api_key_env: null,
            }
          : {
              ...draft,
              llm_profile_id: '',
              model: draft.model.trim(),
              base_url: draft.base_url.trim(),
              api_key: draft.api_key.trim(),
              api_key_env: draft.api_key_env?.trim() || null,
            };
      await visionProxySet(next);
      setDraft(next);
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
  // Only show vision-capable profiles in the picker, but keep the
  // currently-saved id even if it isn't flagged vision (so a user
  // who flipped vision=false on their profile still sees the
  // selection and gets a chance to fix it).
  const visionProfiles = profiles.filter((p) => p.vision === true);
  const selectedProfileExists =
    !draft.llm_profile_id ||
    profiles.some((p) => p.id === draft.llm_profile_id);

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
          {t('settings.vision_proxy.enable', {
            defaultValue: '启用视觉代理（仅在当前模型不支持视觉时触发）',
          })}
        </span>
      </label>

      <div
        className={`flex flex-col gap-3 ${draft.enabled ? '' : 'opacity-50 pointer-events-none'}`}
      >
        {/* Mode toggle. Profile mode is the headline path. */}
        <div className="flex gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setMode('profile')}
            className={`rounded-full border px-3 py-1 ${
              mode === 'profile'
                ? 'border-gold-500/60 bg-gold-500/10 text-fg'
                : 'border-border text-fg-subtle hover:bg-bg-elev-2'
            }`}
          >
            <Icon icon={Sparkles} size={11} />
            {t('settings.vision_proxy.mode_profile', { defaultValue: '从大模型库选择' })}
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`rounded-full border px-3 py-1 ${
              mode === 'manual'
                ? 'border-gold-500/60 bg-gold-500/10 text-fg'
                : 'border-border text-fg-subtle hover:bg-bg-elev-2'
            }`}
          >
            {t('settings.vision_proxy.mode_manual', { defaultValue: '高级 · 手填字段' })}
          </button>
        </div>

        {mode === 'profile' ? (
          <ProfileMode
            draft={draft}
            setDraft={setDraft}
            visionProfiles={visionProfiles}
            allProfiles={profiles}
            selectedExists={selectedProfileExists}
          />
        ) : (
          <ManualMode draft={draft} setDraft={setDraft} />
        )}

        <Field
          label={t('settings.vision_proxy.prompt', { defaultValue: '识别提示词（留空走默认）' })}
        >
          <textarea
            rows={4}
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            placeholder={t('settings.vision_proxy.prompt_placeholder', {
              defaultValue:
                '默认会让模型描述对象、可见文字（含坐标）、风格、表格数据。可覆盖以适配你的场景。',
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

function ProfileMode({
  draft,
  setDraft,
  visionProfiles,
  allProfiles,
  selectedExists,
}: {
  draft: VisionProxyConfig;
  setDraft: (next: VisionProxyConfig) => void;
  visionProfiles: LlmProfile[];
  allProfiles: LlmProfile[];
  selectedExists: boolean;
}) {
  const { t } = useTranslation();

  if (visionProfiles.length === 0) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-fg-muted">
        <p className="mb-2">
          {t('settings.vision_proxy.no_vision_profiles', {
            defaultValue:
              '没有标记为「支持视觉」的大模型配置。先去 /models 添加一条 vision-capable profile（GPT-4o / Claude 3.5 / Qwen-VL 等），或者切到「高级 · 手填字段」。',
          })}
        </p>
        <Link
          to="/models"
          className="inline-flex items-center gap-1 text-gold-500 hover:underline"
        >
          <Icon icon={ExternalLink} size={11} />
          {t('settings.vision_proxy.go_to_models', { defaultValue: '去 /models 配置' })}
        </Link>
      </div>
    );
  }

  return (
    <Field
      label={t('settings.vision_proxy.profile_picker', { defaultValue: '视觉模型 Profile' })}
      hint={t('settings.vision_proxy.profile_picker_hint', {
        defaultValue: '只列出标记为「支持视觉」的 profile。Provider / model / API Key 都从 profile 解析。',
      })}
    >
      <select
        value={draft.llm_profile_id}
        onChange={(e) => setDraft({ ...draft, llm_profile_id: e.target.value })}
        className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 text-xs text-fg outline-none focus:border-gold-500"
        data-testid="vision-proxy-profile"
      >
        <option value="">
          {t('settings.vision_proxy.profile_picker_empty', { defaultValue: '— 选一个 profile —' })}
        </option>
        {visionProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label || p.id} · {p.provider}/{p.model}
          </option>
        ))}
      </select>
      {!selectedExists && draft.llm_profile_id && (
        <span className="text-[11px] text-danger">
          {t('settings.vision_proxy.profile_missing', {
            defaultValue: `所选 profile "${draft.llm_profile_id}" 已被删除，请重新选择。`,
            id: draft.llm_profile_id,
          })}
        </span>
      )}
      {draft.llm_profile_id && selectedExists && (
        <ProfileSummary
          profile={
            allProfiles.find((p) => p.id === draft.llm_profile_id) ?? null
          }
        />
      )}
    </Field>
  );
}

function ProfileSummary({ profile }: { profile: LlmProfile | null }) {
  if (!profile) return null;
  return (
    <div className="mt-1 rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-[10px] text-fg-subtle">
      <div>provider: {profile.provider}</div>
      <div>model: {profile.model}</div>
      <div>base_url: {profile.base_url}</div>
      <div>api_key_env: {profile.api_key_env ?? '(none)'}</div>
      <div>vision: {profile.vision === true ? 'true' : 'false'}</div>
    </div>
  );
}

function ManualMode({
  draft,
  setDraft,
}: {
  draft: VisionProxyConfig;
  setDraft: (next: VisionProxyConfig) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
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
          defaultValue:
            '比如 OPENAI_API_KEY、DASHSCOPE_API_KEY，从进程 env 或 ~/.hermes/.env 读取。',
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
      >
        <input
          type="password"
          value={draft.api_key}
          onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
          placeholder="sk-..."
          className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
        />
      </Field>
    </div>
  );
}
