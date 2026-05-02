import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Info } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import type { VoiceProviderTemplate } from './providers';

export function ProviderCard({
  icon,
  title,
  template,
  disabled,
  children,
}: {
  icon: ReactNode;
  title: string;
  template: VoiceProviderTemplate;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className={cn(
      'flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4',
      disabled && 'opacity-50',
    )}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        {template.isFree && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
            免费
          </span>
        )}
        {template.isLocal && (
          <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
            本地
          </span>
        )}
      </div>
      <p className="text-xs text-fg-subtle">{template.description}</p>
      {template.setupUrl && (
        <a
          href={template.setupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:border-gold-500/40 hover:text-fg"
        >
          <Icon icon={ExternalLink} size="xs" />
          {template.setupLabel ?? t('voice.get_api_key')}
        </a>
      )}
      {template.isLocal && template.id === 'edge' && (
        <div className="flex items-start gap-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-blue-600 dark:text-blue-400">
          <Icon icon={Info} size="xs" className="mt-0.5 flex-none" />
          <span>
            启动命令：<code className="rounded bg-blue-500/10 px-1 py-0.5 text-[11px]">docker run -d -p 5050:5050 travisvn/openai-edge-tts:latest</code>
          </span>
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-fg-muted">{label}</span>
      {children}
      <style>{`.input{width:100%;border-radius:var(--radius-md,6px);border:1px solid var(--color-border,var(--color-gray-6,#e5e7eb));background:var(--color-bg-elev-1,var(--color-gray-2,#f9fafb));padding:6px 10px;font-size:12px;color:var(--color-fg,var(--color-gray-12,#111827))}.input:focus{outline:none;border-color:var(--color-gold-500,#d4a843);box-shadow:0 0 0 1px var(--color-gold-500,#d4a843)}`}</style>
    </label>
  );
}
