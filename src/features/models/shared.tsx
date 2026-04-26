import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { HermesConfigView } from '@/lib/ipc';

import type { ProbeState, SaveStatus } from './types';

/**
 * Small layout primitives + status helpers shared across the legacy
 * single-model config form. Co-located here (rather than in a global
 * `components/`) because they're styled to match the Models page's
 * specific spacing/typography rather than serving as design-system
 * primitives.
 */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-fg-muted">{children}</span>;
}

export function Value({ value, mono }: { value?: string | null; mono?: boolean }) {
  if (!value) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <span className={cn('truncate text-sm text-fg', mono && 'font-mono text-xs')}>
      {value}
    </span>
  );
}

/** Read-only summary card showing the currently-saved model section. */
export function CurrentCard({ view }: { view: HermesConfigView }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Icon icon={FileText} size="sm" />
        <code className="font-mono">{view.config_path}</code>
      </div>
      <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <Label>{t('models_page.current_provider')}</Label>
        <Value value={view.model.provider} />
        <Label>{t('models_page.current_model')}</Label>
        <Value value={view.model.default} mono />
        <Label>{t('models_page.current_base_url')}</Label>
        <Value value={view.model.base_url} mono />
      </div>
    </div>
  );
}

/** Inline status line under the Discover button. */
export function ProbeStatus({ state }: { state: ProbeState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'probing') {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-fg-muted">
        <Icon icon={Loader2} size="xs" className="animate-spin" />
        Probing…
      </span>
    );
  }
  if (state.kind === 'ok') {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-500">
        <Icon icon={CheckCircle2} size="xs" />
        {state.count} model{state.count === 1 ? '' : 's'} from{' '}
        <code className="font-mono text-[11px]">{state.endpoint}</code> ({state.latencyMs} ms)
      </span>
    );
  }
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-danger">
      <Icon icon={AlertCircle} size="xs" />
      {state.message}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
      <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
      <div className="flex-1">
        <div className="font-medium">{t('models_page.unable_to_read_config')}</div>
        <div className="mt-1 break-all text-xs opacity-80">{message}</div>
        <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
          <Icon icon={RefreshCw} size="sm" />
          {t('models_page.try_again')}
        </Button>
      </div>
    </div>
  );
}

export function StatusMsg({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  const { t } = useTranslation();
  if (status.kind === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <Icon icon={CheckCircle2} size="sm" />
        Saved to config.yaml.
      </span>
    );
  }
  if (status.kind === 'err') {
    return (
      <span className="inline-flex items-start gap-1 text-xs text-danger">
        <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
        <span className="break-all">{status.message}</span>
      </span>
    );
  }
  if (dirty) return <span className="text-xs text-fg-muted">{t('models_page.unsaved_changes')}</span>;
  return <span className="text-xs text-fg-subtle">{t('models_page.no_changes')}</span>;
}
