import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chrome, Loader2, LogIn, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  browserCdpStatus,
  browserCdpLaunch,
  browserCdpStop,
  browserCdpClearCookies,
  ipcErrorMessage,
  type BrowserCdpStatus,
} from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Settings → AI Browser panel.
 *
 * Single-screen UX:
 *
 *   - Status row: 🟢 running / 🔴 stopped + port + profile path
 *   - Primary action: "Open AI Browser & Sign In" (idempotent — calls
 *     `browser_cdp_launch` whether Chrome is already up or not)
 *   - Secondary actions: Stop (clears env, leaves Chrome alive) +
 *     Clear cookies (wipes the dedicated profile)
 *
 * The customer never sees `--remote-debugging-port`, `BROWSER_CDP_URL`,
 * or any other CLI flag. The whole flow reduces to: "click button →
 * a Chrome window opens → sign into your backends → close the
 * Settings panel and chat normally". That's the bar.
 */
export function BrowserCdpSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BrowserCdpStatus | null>(null);
  const [busy, setBusy] = useState<'launch' | 'stop' | 'clear' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setStatus(await browserCdpStatus());
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }

  useEffect(() => {
    void refresh();
    // Poll while the user is on this page — Chrome can be quit
    // externally (Cmd-Q), and the status badge should reflect that
    // without forcing a manual refresh. 4 s feels right (TCP probe is
    // ~200 ms so well below the next tick).
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, []);

  async function onLaunch() {
    setBusy('launch');
    setError(null);
    setMessage(null);
    try {
      const result = await browserCdpLaunch();
      setStatus(result.status);
      setMessage(result.message);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onStop() {
    setBusy('stop');
    setError(null);
    setMessage(null);
    try {
      setStatus(await browserCdpStop());
      setMessage(t('settings.browser_cdp.stopped_msg'));
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    if (!window.confirm(t('settings.browser_cdp.clear_confirm'))) return;
    setBusy('clear');
    setError(null);
    setMessage(null);
    try {
      setStatus(await browserCdpClearCookies());
      setMessage(t('settings.browser_cdp.cleared_msg'));
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const noChrome = status !== null && status.chrome_path === null;

  return (
    <Section
      id="settings-browser-cdp"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon icon={Chrome} size="sm" />
          {t('settings.browser_cdp.title')}
        </span>
      }
      description={t('settings.browser_cdp.desc')}
    >
      <div className="flex flex-col gap-4">
        {/* Status badge */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elev-1 p-3 text-xs">
          {status === null ? (
            <span className="inline-flex items-center gap-2 text-fg-subtle">
              <Icon icon={Loader2} size="xs" className="animate-spin" />
              {t('common.loading')}
            </span>
          ) : (
            <>
              <span
                className={
                  status.running
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-500'
                    : 'inline-flex items-center gap-1.5 rounded-full bg-fg-subtle/10 px-2 py-0.5 font-medium text-fg-muted'
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${status.running ? 'bg-emerald-500' : 'bg-fg-muted'}`}
                />
                {status.running
                  ? t('settings.browser_cdp.running')
                  : t('settings.browser_cdp.stopped')}
              </span>
              <span className="text-fg-subtle">
                {t('settings.browser_cdp.port_label')}: localhost:{status.port}
              </span>
              {status.env_configured && (
                <span className="text-fg-subtle">
                  · {t('settings.browser_cdp.env_set')}
                </span>
              )}
            </>
          )}
        </div>

        {/* Help text for the very first interaction */}
        {status && !status.running && !noChrome && (
          <p className="rounded-md border border-gold-500/30 bg-gold-500/5 p-3 text-xs text-fg-muted">
            {t('settings.browser_cdp.first_time_hint')}
          </p>
        )}

        {noChrome && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
            {t('settings.browser_cdp.no_chrome_hint')}
          </p>
        )}

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={onLaunch}
            disabled={busy !== null || noChrome}
            data-testid="browser-cdp-launch"
          >
            {busy === 'launch' ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={LogIn} size="xs" />
            )}
            {status?.running
              ? t('settings.browser_cdp.relaunch')
              : t('settings.browser_cdp.launch')}
          </Button>

          {status?.env_configured && (
            <Button
              variant="ghost"
              onClick={onStop}
              disabled={busy !== null}
              data-testid="browser-cdp-stop"
            >
              {busy === 'stop' ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : (
                <Icon icon={RotateCcw} size="xs" />
              )}
              {t('settings.browser_cdp.stop')}
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={onClear}
            disabled={busy !== null || status?.running === true}
            data-testid="browser-cdp-clear"
            title={
              status?.running
                ? t('settings.browser_cdp.clear_blocked_hint')
                : undefined
            }
          >
            {busy === 'clear' ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Trash2} size="xs" />
            )}
            {t('settings.browser_cdp.clear')}
          </Button>
        </div>

        {/* Toast-style inline status messages */}
        {message && (
          <p className="text-xs text-emerald-500" data-testid="browser-cdp-msg">
            {message}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-500" data-testid="browser-cdp-error">
            {error}
          </p>
        )}

        {/* Logged-in sites — the answer to "did my login take?".
            Read from Chrome's Cookies sqlite when stopped. While
            Chrome is running we can't read the locked db, so the
            UI explains *why* the list is empty in that case. */}
        {status && status.env_configured && (
          <div className="rounded-md border border-border bg-bg-elev-2 p-3 text-xs">
            <div className="mb-2 font-medium text-fg">
              {t('settings.browser_cdp.logged_in_label')}
            </div>
            {status.running ? (
              <div className="text-fg-subtle">
                {t('settings.browser_cdp.logged_in_running_hint')}
              </div>
            ) : status.logged_in_domains.length === 0 ? (
              <div className="text-fg-subtle">
                {t('settings.browser_cdp.logged_in_empty')}
              </div>
            ) : (
              <ul className="flex flex-wrap gap-1.5" data-testid="browser-cdp-domains">
                {status.logged_in_domains.map((d) => (
                  <li
                    key={d}
                    className="rounded-full border border-border bg-bg-elev-1 px-2 py-0.5 font-mono text-[11px]"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Power-user disclosure: profile path + detected chrome */}
        {status && (
          <details className="text-xs text-fg-subtle">
            <summary className="cursor-pointer select-none">
              {t('settings.browser_cdp.details_label')}
            </summary>
            <div className="mt-2 flex flex-col gap-1 rounded-md bg-bg-elev-2 p-2 font-mono">
              <div>
                <span className="text-fg-muted">profile:</span> {status.profile_dir}
              </div>
              <div>
                <span className="text-fg-muted">chrome:</span>{' '}
                {status.chrome_path ?? '(not detected)'}
              </div>
            </div>
          </details>
        )}
      </div>
    </Section>
  );
}
