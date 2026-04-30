import { useCallback, useEffect, useMemo, useState } from 'react';
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

function sourceBadge(source: string) {
  return SOURCE_BADGE[source] ?? { label: source.slice(0, 2).toUpperCase(), cls: 'border-fg-subtle text-fg-subtle' };
}

const SOURCE_LABELS: Record<string, string> = {
  weixin: '微信对话',
  dingtalk: '钉钉对话',
  feishu: '飞书对话',
  wecom: '企业微信对话',
  qq: 'QQ对话',
  qqbot: 'QQ对话',
  telegram: 'Telegram 对话',
  discord: 'Discord 对话',
  slack: 'Slack 对话',
  whatsapp: 'WhatsApp 对话',
  signal: 'Signal 对话',
  email: '邮件记录',
  sms: '短信记录',
};

interface SourceGroup {
  source: string;
  label: string;
  count: number;
  lastActivity: number | null;
}

export function GatewaySection() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const importSource = useChatStore((s) => s.importGatewaySource);

  const groups = useMemo<SourceGroup[]>(() => {
    const map = new Map<string, SourceGroup>();
    for (const s of sessions) {
      const src = s.source ?? 'unknown';
      const existing = map.get(src);
      if (existing) {
        existing.count += 1;
        if (s.lastActivity != null && (existing.lastActivity == null || s.lastActivity > existing.lastActivity)) {
          existing.lastActivity = s.lastActivity;
        }
      } else {
        map.set(src, {
          source: src,
          label: SOURCE_LABELS[src] ?? `${src} 对话`,
          count: 1,
          lastActivity: s.lastActivity ?? s.startedAt ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  }, [sessions]);

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

  if (loading || groups.length === 0) return null;

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
          {groups.length}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {groups.map((g) => {
            const badge = sourceBadge(g.source);
            return (
              <li key={g.source}>
                <button
                  onClick={() => importSource(g.source)}
                  className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-bg-elev-2 hover:text-fg"
                  title={`${g.label} — ${g.count} 条对话`}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1 py-0 font-mono text-[9px] uppercase tracking-wider',
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                  <span className="flex-none font-mono text-[10px] text-fg-subtle">
                    {g.count}
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
