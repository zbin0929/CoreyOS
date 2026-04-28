import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { inputCls } from './styles';

export function CreateProfileForm({
  value,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  busy: boolean;
  error?: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3">
      <div className="flex items-center gap-2">
        <Icon icon={Plus} size="md" className="text-gold-500" />
        <span className="text-sm font-medium text-fg">{t('profiles.new')}</span>
      </div>
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('profiles.name_placeholder')} data-testid="profiles-new-input" className={inputCls} />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>{t('profiles.cancel')}</Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !value.trim()}>
          {busy ? <Icon icon={Loader2} size="sm" className="animate-spin" /> : <Icon icon={Check} size="sm" />}
          {t('profiles.create')}
        </Button>
      </div>
      {error && (
        <div className="flex items-start gap-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </form>
  );
}
