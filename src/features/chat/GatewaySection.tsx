import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { gatewaySessionsList, type GatewaySession } from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  cli: { label: 'CLI', cls: 'border-amber-500/50 text-amber-600' },
  telegram: { label: 'TG', cls: 'border-sky-500/50 text-sky-600' },
  discord: { label: 'DC', cls: 'border-indigo-500/50 text-indigo-600' },
  slack: { label: 'SL', cls: 'border-emerald-500/50 text-emerald-600' },
  whatsapp: { label: 'WA', cls: 'border-green-500/50 text-green-600' },
  weixin: { label: '微信', cls: 'border-red-500/50 text-red-500' },
  dingtalk: { label: '钉钉', cls: 'border-blue-500/50 text-blue-500' },
  qq: { label: 'QQ', cls: 'border-cyan-500/50 text-cyan-500' },
  qqbot: { label: 'QQ', cls: 'border-cyan-500/50 text-cyan-500' },
  feishu: { label: '飞书', cls: 'border-violet-500/50 text-violet-500' },
  wecom: { label: '企微', cls: 'border-orange-500/50 text-orange-500' },
  signal: { label: 'SG', cls: 'border-blue-400/50 text-blue-400' },
  email: { label: '邮件', cls: 'border-yellow-500/50 text-yellow-500' },
  sms: { label: 'SMS', cls: 'border-pink-500/50 text-pink-500' },
};

function sourceBadge(source: string | null) {
  if (!source) return { label: '??', cls: 'border-fg-subtle text-fg-subtle' };
  return SOURCE_BADGE[source] ?? { label: source.slice(0, 2).toUpperCase(), cls: 'border-fg-subtle text-fg-subtle' };
}

export function GatewaySection() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const importSession = useChatStore((s) => s.importGatewaySession);

  const refresh = useCallback(() => {
    gatewaySessionsList()
      .then((list) => {
        setSessions(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading || sessions.length === 0) return null;

  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <Icon icon={Radio} size="xs" className="text-gold-500" />
        {t('chat_page.gateway_title')}
        <span className="ml-auto font-mono text-[10px] text-fg-subtle">
          {sessions.length}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {sessions.map((s) => {
            const badge = sourceBadge(s.source);
            return (
              <li key={s.id}>
                <button
                  onClick={() => importSession(s)}
                  className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-bg-elev-2 hover:text-fg"
                  title={`${s.title} — ${s.source ?? ''}`}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1 py-0 font-mono text-[9px] uppercase tracking-wider',
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.title || s.id}</span>
                  <span className="flex-none text-[10px] text-fg-subtle opacity-0 transition group-hover:opacity-100">
                    {t('chat_page.gateway_import')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
