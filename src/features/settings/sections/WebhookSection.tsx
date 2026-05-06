import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, RefreshCw, Webhook as WebhookIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  webhookListenerPort,
  webhookTokenGet,
  webhookTokenRotate,
} from '@/lib/ipc';

import { Section } from '../shared';

/**
 * **B-10.7 Settings · Webhook**.
 *
 * Surface the local webhook URL + bearer token + a copy-pasteable
 * curl example. Listener binds to 127.0.0.1 only so the user is
 * driving the call from the same box (cron / local IM bot / IFTTT
 * via local-area-network bridge); the token is defense in depth
 * against other LOCAL apps starting workflows without consent.
 *
 * The listener port is OS-assigned, so we poll until it resolves
 * (worst case ~50 ms after app boot). Token is read once on mount;
 * rotate replaces it and clipboards the new value.
 */
const POLL_MS = 800;

export function WebhookSection() {
  const { t } = useTranslation();
  const [port, setPort] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'url' | 'token' | 'curl' | null>(null);

  // Initial load + port polling. The token resolves on the first
  // call (lazy-generated server-side); the port may still be null
  // for ~50 ms while the axum bind races, so we re-poll only that.
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      try {
        const [p, tok] = await Promise.all([webhookListenerPort(), webhookTokenGet()]);
        if (cancelled) return;
        setPort(p);
        setToken(tok);
        if (p == null) {
          poll = setInterval(async () => {
            try {
              const next = await webhookListenerPort();
              if (cancelled) return;
              if (next != null) {
                setPort(next);
                if (poll) clearInterval(poll);
              }
            } catch {
              /* ignore — keep polling */
            }
          }, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      }
    })();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, []);

  const onRotate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await webhookTokenRotate();
      setToken(next);
      void copy(next, 'token', setCopied);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const url = port != null ? `http://127.0.0.1:${port}/webhook/<workflow_id>` : null;
  const curl =
    port != null && token
      ? `curl -X POST http://127.0.0.1:${port}/webhook/<workflow_id> \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"input_key": "value"}'`
      : null;

  return (
    <Section
      id="settings-webhook"
      title={
        <span className="flex items-center gap-2">
          <Icon icon={WebhookIcon} size={16} className="text-fg-muted" />
          <span>{t('settings.webhook.title', { defaultValue: 'Webhook 触发器' })}</span>
        </span>
      }
      description={t('settings.webhook.description', {
        defaultValue:
          '让外部脚本 / cron / IFTTT / IM 机器人通过 HTTP POST 启动工作流。监听绑定 127.0.0.1，且必须带 Bearer Token。',
      })}
    >
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label={t('settings.webhook.url', { defaultValue: 'URL' })}>
          {url ? (
            <CopyableCode value={url} mode="url" copied={copied} setCopied={setCopied} />
          ) : (
            <SkeletonInline />
          )}
        </Field>

        <Field label={t('settings.webhook.token', { defaultValue: 'Token' })}>
          {token ? (
            <CopyableCode
              value={token}
              mode="token"
              copied={copied}
              setCopied={setCopied}
              masked
            />
          ) : (
            <SkeletonInline />
          )}
        </Field>

        <Field label={t('settings.webhook.curl_example', { defaultValue: 'curl 示例' })}>
          {curl ? (
            <CopyableCode value={curl} mode="curl" copied={copied} setCopied={setCopied} block />
          ) : (
            <SkeletonInline />
          )}
        </Field>
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onRotate()}
          disabled={busy || token == null}
          data-testid="webhook-rotate"
        >
          {busy ? (
            <Icon icon={Loader2} size={12} className="animate-spin" />
          ) : (
            <Icon icon={RefreshCw} size={12} />
          )}
          {t('settings.webhook.rotate', { defaultValue: '轮换 Token' })}
        </Button>
      </div>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
    </div>
  );
}

function SkeletonInline() {
  return <div className="h-7 w-full animate-pulse rounded bg-bg-elev-2" />;
}

interface CopyProps {
  value: string;
  mode: 'url' | 'token' | 'curl';
  copied: 'url' | 'token' | 'curl' | null;
  setCopied: (v: 'url' | 'token' | 'curl' | null) => void;
  masked?: boolean;
  block?: boolean;
}

function CopyableCode({ value, mode, copied, setCopied, masked, block }: CopyProps) {
  const [reveal, setReveal] = useState(false);
  const display = masked && !reveal ? value.replace(/./g, '•') : value;
  const isCopied = copied === mode;
  return (
    <div className="flex items-stretch gap-2">
      <code
        className={`flex-1 select-all rounded border border-border bg-bg-elev-1 px-2.5 py-1.5 font-mono text-xs text-fg ${
          block ? 'whitespace-pre-wrap' : 'truncate'
        }`}
      >
        {display}
      </code>
      {masked && (
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="rounded border border-border px-2 text-[11px] text-fg-subtle hover:bg-bg-elev-2 hover:text-fg"
        >
          {reveal ? '隐藏' : '显示'}
        </button>
      )}
      <button
        type="button"
        onClick={() => void copy(value, mode, setCopied)}
        className="inline-flex items-center gap-1 rounded border border-border px-2 text-[11px] text-fg-subtle hover:bg-bg-elev-2 hover:text-fg"
      >
        <Icon icon={isCopied ? Check : Copy} size={12} />
        {isCopied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

async function copy(
  value: string,
  mode: 'url' | 'token' | 'curl',
  setCopied: (v: 'url' | 'token' | 'curl' | null) => void,
) {
  try {
    await navigator.clipboard.writeText(value);
    setCopied(mode);
    setTimeout(() => setCopied(null), 1800);
  } catch {
    /* ignore — webview clipboard requires HTTPS / localhost which Tauri provides */
  }
}
