import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useCustomerConfig } from '@/stores/customer';

import { Section } from '../shared';

export function CustomerSection({ hermesDataDir }: { hermesDataDir?: string }) {
  const { t } = useTranslation();
  const cfg = useCustomerConfig();
  const [copied, setCopied] = useState(false);
  const loading = cfg === null;
  const present = !loading && cfg.present;
  const hasError = !loading && Boolean(cfg.error);
  const hiddenRoutes = !loading ? cfg.navigation.hiddenRoutes : [];
  const customerYamlPath = hermesDataDir ? `${hermesDataDir}/customer.yaml` : 'customer.yaml';
  const sample = `schema_version: 1
brand:
  app_name: My Company AI
navigation:
  hidden_routes:
    - analytics
packs:
  preinstall:
    - test_pack
  pin_to_primary:
    - test_pack/demo`;

  async function openCustomerDir() {
    if (!hermesDataDir) return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(hermesDataDir);
    } catch (err) {
      void err;
    }
  }

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(sample);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      void err;
    }
  }

  return (
    <Section
      id="settings-customer"
      title={t('settings.customer.title')}
      description={t('settings.customer.desc')}
    >
      <div className="rounded-md border border-border bg-bg-elev-1 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-subtle">{t('settings.customer.status_label')}</span>
          {loading ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-fg-muted">
              {t('settings.customer.status_loading')}
            </span>
          ) : hasError ? (
            <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-red-500">
              {t('settings.customer.status_invalid')}
            </span>
          ) : present ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
              {t('settings.customer.status_loaded')}
            </span>
          ) : (
            <span className="rounded-full border border-border px-2 py-0.5 text-fg-muted">
              {t('settings.customer.status_absent')}
            </span>
          )}
          {!loading && (
            <span className="text-fg-subtle">
              {t('settings.customer.schema')}: v{cfg.schemaVersion}
            </span>
          )}
        </div>

        {!loading && cfg.error && (
          <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-red-500">
            {cfg.error}
          </div>
        )}

        {!loading && cfg.error && (
          <div className="mt-2 rounded-md border border-border bg-bg-elev-2 px-2.5 py-2 text-fg">
            <div className="text-fg-subtle">{t('settings.customer.recovery_path_label')}</div>
            <code className="mt-1 block break-all text-fg">{customerYamlPath}</code>
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!hermesDataDir}
                onClick={() => void openCustomerDir()}
              >
                <Icon icon={FolderOpen} size="sm" />
                {t('settings.customer.open_dir')}
              </Button>
            </div>
            <div className="mt-2 text-fg-subtle">{t('settings.customer.recovery_example_label')}</div>
            <div className="mt-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => void copyExample()}>
                <Icon icon={copied ? Check : Copy} size="sm" className={copied ? 'text-emerald-500' : undefined} />
                {copied ? t('settings.customer.copied') : t('settings.customer.copy_example')}
              </Button>
            </div>
            <pre className="mt-1 overflow-x-auto rounded border border-border/70 bg-bg-elev-1 px-2 py-1.5 text-[11px] leading-5 text-fg">
{sample}
            </pre>
          </div>
        )}

        {!loading && present && (
          <div className="mt-3 grid gap-2">
            <Row
              label={t('settings.customer.brand_name')}
              value={cfg.brand.appName || t('settings.customer.unset')}
            />
            <Row
              label={t('settings.customer.brand_logo')}
              value={cfg.brand.logo || t('settings.customer.unset')}
            />
            <Row
              label={t('settings.customer.primary_color')}
              value={cfg.brand.primaryColor || t('settings.customer.unset')}
            />
            <Row
              label={t('settings.customer.hidden_routes')}
              value={
                hiddenRoutes.length > 0
                  ? hiddenRoutes.join(', ')
                  : t('settings.customer.none_hidden')
              }
            />
            <Row
              label={t('settings.customer.preinstall')}
              value={
                cfg.packs.preinstall.length > 0
                  ? cfg.packs.preinstall.join(', ')
                  : t('settings.customer.unset')
              }
            />
            <Row
              label={t('settings.customer.pin_to_primary')}
              value={
                cfg.packs.pinToPrimary.length > 0
                  ? cfg.packs.pinToPrimary.join(', ')
                  : t('settings.customer.unset')
              }
            />
          </div>
        )}

        <p className="mt-3 text-fg-subtle">{t('settings.customer.hint')}</p>
      </div>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[130px] text-fg-subtle">{label}</span>
      <code className="min-w-0 flex-1 break-all text-fg">{value}</code>
    </div>
  );
}
