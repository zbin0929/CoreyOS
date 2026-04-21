import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Plug, Sparkles, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CaduceusMark } from '@/components/ui/caduceus-mark';
import { homeStats, type HomeStats } from '@/lib/ipc';

export function HomeRoute() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    homeStats()
      .then(setStats)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-8">
      {/* Ambient gold glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 10%, hsl(var(--gold-500) / 0.14), transparent 70%)',
        }}
      />

      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-6 text-center">
        <CaduceusMark className="h-14 w-14 text-gold-500" />
        <div className="flex flex-col gap-3">
          <h1 className="text-display font-semibold leading-tight tracking-tight text-fg">
            {t('home.title')}
          </h1>
          <p className="text-md text-fg-muted">{t('home.subtitle')}</p>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button variant="primary" size="md">
            <Plug size={14} />
            {t('home.cta_connect')}
          </Button>
          <Button variant="secondary" size="md">
            <BookOpen size={14} />
            {t('home.cta_docs')}
          </Button>
        </div>

        <div className="mt-8 flex items-center gap-2 text-xs text-fg-subtle">
          <Sparkles size={12} />
          <span>Phase 0 dev build · fixtures only · no live gateway</span>
        </div>

        {/* IPC round-trip demo: React → Tauri IPC → Rust std::fs → back. */}
        <div
          className="mt-4 flex items-center gap-2 rounded-md border border-border bg-bg-elev-1/60 px-3 py-1.5 text-xs font-mono text-fg-muted"
          data-tabular
        >
          <HardDrive size={12} className="text-gold-500" />
          {error ? (
            <span className="text-danger">IPC error: {error}</span>
          ) : stats ? (
            <span className="flex items-center gap-2">
              <span>
                <span className="text-fg-subtle">$HOME</span>
                {' '}contains{' '}
                <span className="text-fg">{stats.entry_count}</span>{' '}
                <span className="text-fg-subtle">entries</span>
              </span>
              <span
                className={
                  stats.sandbox_mode === 'enforced'
                    ? 'rounded-sm border border-gold-500/50 bg-gold-500/10 px-1.5 py-0.5 text-[10px] text-gold-500'
                    : 'rounded-sm border border-border bg-bg-elev-2 px-1.5 py-0.5 text-[10px] text-fg-subtle'
                }
              >
                sandbox:{stats.sandbox_mode}
              </span>
            </span>
          ) : (
            <span className="text-fg-subtle">probing disk via IPC…</span>
          )}
        </div>
      </div>
    </div>
  );
}
