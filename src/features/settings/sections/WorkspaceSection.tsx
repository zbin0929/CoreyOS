import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { ipcErrorMessage, type SandboxAccessMode } from '@/lib/ipc';
import { useSandboxStore } from '@/stores/sandbox';

import { Section } from '../shared';
import { inputCls } from '../styles';

/**
 * Manage the PathAuthority's workspace roots + mode. Every mutation here
 * calls back to Rust and triggers an atomic write of `sandbox.json`.
 *
 * Adding the first root flips the mode from `dev_allow` to `enforced`
 * automatically; there's also an explicit "Enforce without adding a
 * root" button for users who want to lock everything down while they
 * decide which paths to whitelist.
 */
export function WorkspaceSection() {
  const { t } = useTranslation();
  const hydrated = useSandboxStore((s) => s.hydrated);
  const mode = useSandboxStore((s) => s.mode);
  const roots = useSandboxStore((s) => s.roots);
  const sessionGrants = useSandboxStore((s) => s.sessionGrants);
  const configPath = useSandboxStore((s) => s.configPath);
  const addRoot = useSandboxStore((s) => s.addRoot);
  const removeRoot = useSandboxStore((s) => s.removeRoot);
  const setEnforced = useSandboxStore((s) => s.setEnforced);
  const clearSessionGrants = useSandboxStore((s) => s.clearSessionGrants);

  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<SandboxAccessMode>('read_write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newPath.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addRoot({
        path: newPath.trim(),
        label: newLabel.trim() || newPath.trim().split(/[\\/]/).filter(Boolean).pop() || 'Root',
        mode: newMode,
      });
      setNewPath('');
      setNewLabel('');
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(path: string) {
    if (busy) return;
    setBusy(true);
    try {
      await removeRoot(path);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Native folder picker via tauri-plugin-dialog. Fails soft on non-Tauri
  // contexts (Storybook, Playwright mock) so the text input stays usable.
  async function onBrowse() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string' && picked) {
        setNewPath(picked);
        // Auto-fill label from the last path segment when empty so the
        // common case ("add ~/Projects/foo") is a one-click flow.
        if (!newLabel.trim()) {
          const seg = picked.split(/[\\/]/).filter(Boolean).pop();
          if (seg) setNewLabel(seg);
        }
      }
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  return (
    <Section
      id="settings-sandbox"
      title={t('settings.sandbox.title')}
      description={t('settings.sandbox.desc')}
    >
      {!hydrated ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('settings.loading')}
        </div>
      ) : (
        <>
          {/* Mode pill + enforce toggle */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
            <Icon
              icon={mode === 'enforced' ? ShieldCheck : Lock}
              size="sm"
              className={mode === 'enforced' ? 'text-emerald-500' : 'text-gold-500'}
            />
            <span className="font-medium text-fg">
              {t(`settings.sandbox.mode_${mode}`)}
            </span>
            <span className="flex-1 text-fg-subtle">
              {t(`settings.sandbox.mode_${mode}_hint`)}
            </span>
            {mode === 'dev_allow' && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  void setEnforced();
                }}
              >
                {t('settings.sandbox.enforce_now')}
              </Button>
            )}
          </div>

          {/* Status indicator + test guide */}
          {mode === 'enforced' && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
              <Icon icon={ShieldCheck} size="sm" className="mt-0.5 flex-none" />
              <div>
                <span className="font-medium">{t('settings.sandbox.active_title')}</span>
                <p className="mt-0.5 text-[11px] opacity-80">{t('settings.sandbox.test_guide')}</p>
              </div>
            </div>
          )}
          {mode === 'dev_allow' && (
            <div className="flex items-start gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-xs text-gold-600 dark:text-gold-400">
              <Icon icon={Lock} size="sm" className="mt-0.5 flex-none" />
              <span>{t('settings.sandbox.dev_hint')}</span>
            </div>
          )}

          {/* Existing roots */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-fg">
              {t('settings.sandbox.roots_title')}
            </div>
            {roots.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
                {t('settings.sandbox.no_roots')}
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {roots.map((r) => (
                  <li
                    key={r.path}
                    className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-fg">{r.label}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[10px]',
                            r.mode === 'read_write'
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-bg-elev-3 text-fg-subtle',
                          )}
                        >
                          {t(`settings.sandbox.mode_${r.mode}_short`)}
                        </span>
                      </div>
                      <code
                        className="truncate font-mono text-[11px] text-fg-muted"
                        title={r.path}
                      >
                        {r.path}
                      </code>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        void onRemove(r.path);
                      }}
                      aria-label={t('settings.sandbox.remove')}
                    >
                      <Icon icon={Trash2} size="sm" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add-root form */}
          <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="text-xs font-medium text-fg">
              {t('settings.sandbox.add_title')}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder={t('settings.sandbox.path_placeholder')}
                className={cn(inputCls, 'flex-1')}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void onBrowse();
                }}
              >
                <Icon icon={FolderOpen} size="sm" />
                {t('settings.sandbox.browse')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('settings.sandbox.label_placeholder')}
                className={cn(inputCls, 'flex-1 min-w-[160px]')}
                spellCheck={false}
                autoComplete="off"
              />
              <div
                role="radiogroup"
                aria-label={t('settings.sandbox.mode_label')}
                className="inline-flex rounded-md border border-border bg-bg-elev-1 p-0.5"
              >
                {(['read', 'read_write'] as SandboxAccessMode[]).map((m) => {
                  const active = newMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setNewMode(m)}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition',
                        active
                          ? 'bg-gold-500/20 text-fg'
                          : 'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
                      )}
                    >
                      {t(`settings.sandbox.mode_${m}_short`)}
                    </button>
                  );
                })}
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={!newPath.trim() || busy}>
                <Icon icon={FolderPlus} size="sm" />
                {t('settings.sandbox.add')}
              </Button>
            </div>
          </form>

          {/* Session grants */}
          {sessionGrants.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-fg">
                  {t('settings.sandbox.session_grants_title')}
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void clearSessionGrants();
                  }}
                >
                  <Icon icon={X} size="xs" />
                  {t('settings.sandbox.clear_grants')}
                </Button>
              </div>
              <ul className="flex flex-col gap-1">
                {sessionGrants.map((g) => (
                  <li
                    key={g}
                    className="truncate rounded border border-border bg-bg-elev-2 px-2 py-1 font-mono text-[11px] text-fg-muted"
                    title={g}
                  >
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
              <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {configPath && (
            <div className="text-[11px] text-fg-subtle">
              {t('settings.sandbox.config_path')}{' '}
              <code className="font-mono">{configPath}</code>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
