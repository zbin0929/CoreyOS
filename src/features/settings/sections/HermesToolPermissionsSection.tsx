import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Shield,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  hermesConfigWriteSecurity,
  ipcErrorMessage,
  type HermesSecuritySection,
} from '@/lib/ipc';

import { Field, Section } from '../shared';
import { inputCls } from '../styles';

/**
 * Settings → Sandbox → Hermes tool permissions.
 *
 * The other half of the permission story. Corey's `WorkspaceSection`
 * (above) gates **Corey's own IPC** (attachments, knowledge upload,
 * file-picker MCP tool) by **path**. This section gates **Hermes
 * agent's tools** (shell, read_file, write_file, etc.) by
 * **command pattern + LLM risk-judgment** — a totally different
 * model.
 *
 * Surfacing both on one page kills the "I set sandbox to Enforced
 * but Hermes still ran `ls ~/Desktop`!" confusion: users can see
 * with their own eyes that the two are independent and which is
 * which.
 *
 * The settings here write straight into `~/.hermes/config.yaml` —
 * any other Hermes GUI / CLI sees the same values. No extra
 * gateway restart needed for the approval knobs (Hermes reads them
 * lazily on the next tool call).
 */

const APPROVAL_MODES: Array<{ value: string; i18nKey: string }> = [
  { value: 'manual', i18nKey: 'settings.hermes_security.mode_manual' },
  { value: 'auto', i18nKey: 'settings.hermes_security.mode_auto' },
  { value: 'yolo', i18nKey: 'settings.hermes_security.mode_yolo' },
];

const CRON_MODES: Array<{ value: string; i18nKey: string }> = [
  { value: 'deny', i18nKey: 'settings.hermes_security.cron_deny' },
  { value: 'ask', i18nKey: 'settings.hermes_security.cron_ask' },
  { value: 'allow', i18nKey: 'settings.hermes_security.cron_allow' },
];

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

export function HermesToolPermissionsSection() {
  const { t } = useTranslation();
  const [view, setView] = useState<HermesSecuritySection | null>(null);
  const [approvalMode, setApprovalMode] = useState('manual');
  const [approvalTimeout, setApprovalTimeout] = useState(60);
  const [cronMode, setCronMode] = useState('deny');
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const v = await hermesConfigRead();
        setView(v.security);
        setApprovalMode(v.security.approval_mode ?? 'manual');
        setApprovalTimeout(v.security.approval_timeout_s ?? 60);
        setCronMode(v.security.cron_mode ?? 'deny');
        setAllowlist(v.security.command_allowlist ?? []);
      } catch (e) {
        setError(ipcErrorMessage(e));
      }
    })();
  }, []);

  function addPattern() {
    const p = newPattern.trim();
    if (!p) return;
    if (allowlist.includes(p)) {
      setNewPattern('');
      return;
    }
    setAllowlist([...allowlist, p]);
    setNewPattern('');
  }

  function removePattern(p: string) {
    setAllowlist(allowlist.filter((x) => x !== p));
  }

  async function onSave() {
    if (save.kind === 'saving') return;
    setSave({ kind: 'saving' });
    setError(null);
    try {
      const next = await hermesConfigWriteSecurity({
        approval_mode: approvalMode,
        approval_timeout_s: approvalTimeout,
        cron_mode: cronMode,
        command_allowlist: allowlist,
      });
      setView(next.security);
      setSave({ kind: 'saved' });
      window.setTimeout(() => {
        setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2500);
    } catch (e) {
      setSave({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  // Dirty = current state diverges from last-saved view.
  const dirty =
    view !== null &&
    (approvalMode !== (view.approval_mode ?? 'manual') ||
      approvalTimeout !== (view.approval_timeout_s ?? 60) ||
      cronMode !== (view.cron_mode ?? 'deny') ||
      JSON.stringify(allowlist) !== JSON.stringify(view.command_allowlist ?? []));

  return (
    <Section
      id="settings-hermes-tools"
      title={t('settings.hermes_security.title', { defaultValue: 'Hermes 工具权限' })}
      description={t('settings.hermes_security.description', {
        defaultValue:
          'Hermes agent 跑 shell 命令时的权限策略。与上方 Corey 沙箱独立——Corey 沙箱按路径管 Corey 自己的 IPC，这里按命令模式管 Hermes shell。',
      })}
    >
      {/* Crucial honesty about the scope: this section ONLY gates
          the `shell` tool. Structured file ops (delete_file,
          write_file, edit_file, etc.) go through Hermes's own
          file_operations API which doesn't pass through the
          DANGEROUS_PATTERNS approval layer — they're considered
          first-class API calls, not arbitrary commands. Without
          this callout users test with "delete this file", see
          the agent succeed without a prompt, and assume the whole
          system is broken (it's not — it just doesn't apply
          here). To gate file ops, lock the `read_write` Corey
          sandbox scope above instead. */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-fg-muted">
        ⚠️ {t('settings.hermes_security.scope_note', {
          defaultValue:
            '审批仅对 agent 跑的 shell 命令生效（`rm -rf /tmp` 这类）。Hermes 内置的结构化文件工具（delete_file / write_file / edit_file 等）走另一套 API，不经过这里——要限制文件读写请到上方 Corey 沙箱配置路径白名单。',
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs text-danger flex items-start gap-2">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Approval mode */}
      <fieldset>
        <legend className="text-xs font-medium text-fg-muted mb-2 flex items-center gap-2">
          <Icon icon={Shield} size="xs" className="text-gold-500" />
          {t('settings.hermes_security.mode_legend', { defaultValue: '审批模式' })}
        </legend>
        <div className="grid gap-2">
          {APPROVAL_MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-2.5 transition-colors',
                approvalMode === m.value
                  ? 'border-gold-500/50 bg-gold-500/5'
                  : 'border-border hover:border-border-strong',
                m.value === 'yolo' && approvalMode === m.value && 'border-red-500/50 bg-red-500/5',
              )}
            >
              <input
                type="radio"
                name="hermes-approval-mode"
                checked={approvalMode === m.value}
                onChange={() => setApprovalMode(m.value)}
                className="mt-0.5 accent-gold-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg">
                  {t(`${m.i18nKey}.title`)}
                </div>
                <div className="text-xs text-fg-muted mt-0.5">
                  {t(`${m.i18nKey}.detail`)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Approval timeout + cron mode */}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('settings.hermes_security.timeout_label', { defaultValue: '审批超时（秒）' })}
          hint={t('settings.hermes_security.timeout_hint', {
            defaultValue: '超时未操作时按拒绝处理。默认 60。',
          })}
        >
          <input
            type="number"
            min={5}
            max={3600}
            step={5}
            className={inputCls}
            value={approvalTimeout}
            onChange={(e) => setApprovalTimeout(Math.max(5, Math.min(3600, parseInt(e.target.value, 10) || 60)))}
          />
        </Field>
        <Field
          label={t('settings.hermes_security.cron_label', { defaultValue: 'Cron 任务遇到危险命令' })}
          hint={t('settings.hermes_security.cron_hint', {
            defaultValue: 'Cron 没有用户在场，默认拒绝最稳。',
          })}
        >
          <Select
            value={cronMode}
            onChange={setCronMode}
            options={CRON_MODES.map((m) => ({ value: m.value, label: t(m.i18nKey) }))}
            ariaLabel={t('settings.hermes_security.cron_label', { defaultValue: 'Cron 任务遇到危险命令' })}
          />
        </Field>
      </div>

      {/* Command allowlist */}
      <div className="rounded-lg border border-border bg-bg-elev-1 p-3 flex flex-col gap-3">
        <div className="text-sm font-medium text-fg">
          {t('settings.hermes_security.allowlist_title', {
            defaultValue: '永久允许的命令模式',
          })}
        </div>
        <p className="text-xs text-fg-muted">
          {t('settings.hermes_security.allowlist_desc', {
            defaultValue:
              '匹配到的命令直接放行，不弹审批。每行一条 glob-ish 模式（例：git status、npm install、ls *）。',
          })}
        </p>
        <div className="flex flex-col gap-1.5">
          {allowlist.length === 0 && (
            <p className="text-[11px] text-fg-subtle italic">
              {t('settings.hermes_security.allowlist_empty', {
                defaultValue: '空 — 所有非白名单的危险命令都会按上方"审批模式"处理。',
              })}
            </p>
          )}
          {allowlist.map((p) => (
            <div
              key={p}
              className="flex items-center gap-2 rounded border border-border/60 bg-bg-elev-2/50 px-2 py-1.5"
            >
              <code className="flex-1 break-all font-mono text-xs text-fg">{p}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removePattern(p)}
                aria-label="remove pattern"
              >
                <Icon icon={Trash2} size="xs" className="text-red-500" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder={t('settings.hermes_security.allowlist_placeholder', {
              defaultValue: 'git status / npm install / ls *',
            })}
            className="flex-1 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPattern();
              }
            }}
          />
          <Button variant="secondary" size="sm" onClick={addPattern} disabled={!newPattern.trim()}>
            <Icon icon={Plus} size="xs" />
            {t('settings.hermes_security.allowlist_add', { defaultValue: '添加' })}
          </Button>
        </div>
      </div>

      {/* Save row */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-xs text-fg-muted">
          {save.kind === 'saved' && (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Icon icon={CheckCircle2} size="xs" />
              {t('settings.hermes_security.saved', { defaultValue: '已保存（下次工具调用立即生效）' })}
            </span>
          )}
          {save.kind === 'err' && (
            <span className="inline-flex items-start gap-1 text-danger">
              <Icon icon={AlertCircle} size="xs" className="mt-0.5" />
              <span className="break-all">{save.message}</span>
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void onSave()}
          disabled={!dirty || save.kind === 'saving'}
        >
          {save.kind === 'saving' ? (
            <Icon icon={Loader2} size="xs" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="xs" />
          )}
          {t('settings.hermes_security.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Section>
  );
}
