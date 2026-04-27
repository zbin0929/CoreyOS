import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  FolderOpen,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  appDataDirClear,
  appDataDirSet,
  appPaths,
  ipcErrorMessage,
  llmProfileList,
  type AppPaths,
} from '@/lib/ipc';

/**
 * One-time welcome modal. Shows on first launch (until the user
 * dismisses it) so non-engineer first-time users get a guided
 * starting point instead of a blank app.
 *
 * Two affordances:
 *   1. Confirm or change the Hermes data dir. The platform default
 *      lives under user-home on macOS/Linux and `%LOCALAPPDATA%`
 *      on Windows; users with limited C: space want to relocate
 *      this immediately rather than discovering it three months in.
 *   2. Jump to the Models page (where the LLM-profile wizard lives)
 *      so the user has at least one provider configured before they
 *      hit /chat and bounce off an empty model list.
 *
 * Persistence: a single localStorage flag. Reinstalling Corey on a
 * fresh user account re-runs onboarding; same account on the same
 * machine never sees it again. We also skip the modal when at least
 * one LLM profile already exists — that signals the user has been
 * here before, even if the localStorage is fresh (e.g. cleared by a
 * privacy tool, browser-cache wipe, etc.).
 */
const FIRST_RUN_KEY = 'corey:first-run-acknowledged-v1';

export function FirstRunModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // `null` = still deciding whether to show.
  // `false` = decided to render.
  // `true` = decided to skip / dismissed.
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decide whether to render. Async because we need to peek at the
  // profile list — first-launch is determined by `localStorage AND
  // no profiles`, not just the flag, so a re-install doesn't pester
  // a returning user.
  useEffect(() => {
    let alive = true;
    const flag = (() => {
      try {
        return window.localStorage.getItem(FIRST_RUN_KEY);
      } catch {
        return null;
      }
    })();
    if (flag === '1') {
      setAcknowledged(true);
      return;
    }
    (async () => {
      try {
        const [list, p] = await Promise.all([llmProfileList(), appPaths()]);
        if (!alive) return;
        if (list.profiles.length > 0) {
          // Returning user with profiles already configured — skip.
          // Also persist so we never query again next launch.
          try {
            window.localStorage.setItem(FIRST_RUN_KEY, '1');
          } catch {
            /* private mode / disabled storage — fine, will re-skip via the profile list. */
          }
          setAcknowledged(true);
        } else {
          setPaths(p);
          setAcknowledged(false);
        }
      } catch {
        // IPC may not be ready (Storybook, web preview). Just hide
        // the modal — Home stays usable without it.
        if (alive) setAcknowledged(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, '1');
    } catch {
      /* ignore — user will see the modal again next launch but the
         IPC cost is negligible and they can dismiss again. */
    }
    setAcknowledged(true);
  }

  async function refreshPaths() {
    try {
      setPaths(await appPaths());
    } catch {
      /* Non-fatal: we already have a paths snapshot from mount. */
    }
  }

  async function onChangeDir() {
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      setBusy(true);
      await appDataDirSet(picked);
      await refreshPaths();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onResetDir() {
    setError(null);
    setBusy(true);
    try {
      await appDataDirClear();
      await refreshPaths();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (acknowledged !== false || !paths) return null;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
      data-testid="home-first-run-modal"
      onClick={dismiss}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-elev-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-col gap-1.5 border-b border-border px-6 py-5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold-500">
            <Icon icon={Sparkles} size="xs" />
            {t('first_run.eyebrow')}
          </span>
          <h2 id="first-run-title" className="text-lg font-semibold text-fg">
            {t('first_run.title')}
          </h2>
          <p className="text-sm text-fg-muted">{t('first_run.desc')}</p>
        </header>

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* Step 1 — confirm data dir */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">
              {t('first_run.step1_title')}
            </h3>
            <p className="text-xs text-fg-muted">{t('first_run.step1_desc')}</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2">
              <code
                className="min-w-0 flex-1 truncate font-mono text-xs text-fg"
                title={paths.hermes_data_dir}
              >
                {paths.hermes_data_dir || '—'}
              </code>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void onChangeDir()}
              >
                <Icon icon={busy ? Loader2 : FolderOpen} size="sm" className={cn(busy && 'animate-spin')} />
                {t('first_run.change_dir')}
              </Button>
              {paths.hermes_data_dir_overridden && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onResetDir()}
                  title={t('first_run.reset_dir')}
                >
                  <Icon icon={RotateCcw} size="sm" />
                </Button>
              )}
            </div>
            {error && <div className="text-xs text-red-500">{error}</div>}
          </section>

          {/* Step 2 — add LLM profile */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">
              {t('first_run.step2_title')}
            </h3>
            <p className="text-xs text-fg-muted">{t('first_run.step2_desc')}</p>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                dismiss();
                void navigate({ to: '/models' });
              }}
              data-testid="home-first-run-add-profile"
            >
              <Icon icon={ArrowRight} size="sm" />
              {t('first_run.go_to_models')}
            </Button>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-bg-elev-2/40 px-6 py-3">
          <span className="text-[11px] text-fg-subtle">
            {t('first_run.footer_hint')}
          </span>
          <Button size="sm" variant="ghost" onClick={dismiss} data-testid="home-first-run-dismiss">
            <Icon icon={Check} size="sm" />
            {t('first_run.dismiss')}
          </Button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
