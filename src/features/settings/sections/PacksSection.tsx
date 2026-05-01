import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { FileUp, Lock, Package, RefreshCw, Settings2, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { usePackStore } from '@/lib/usePackStore';
import { packImportZip, packUninstall, packConfigGet, packConfigSet } from '@/lib/ipc/pack';

import { Section } from '../shared';

export function PacksSection() {
  const { t } = useTranslation();
  const packs = usePackStore((s) => s.packs);
  const loading = usePackStore((s) => s.loading);
  const error = usePackStore((s) => s.error);
  const refresh = usePackStore((s) => s.refresh);
  const setEnabled = usePackStore((s) => s.setEnabled);

  const [importing, setImporting] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleImport() {
    setImporting(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Pack ZIP', extensions: ['zip'] }],
      });
      if (selected) {
        await packImportZip(selected);
        void refresh();
      }
    } catch (e) {
      console.error('pack import failed:', e);
    } finally {
      setImporting(false);
    }
  }

  async function handleUninstall(packId: string) {
    try {
      await packUninstall(packId);
      void refresh();
    } catch (e) {
      console.error('pack uninstall failed:', e);
    }
  }

  async function openConfig(packId: string) {
    setConfiguring(packId);
    try {
      const cfg = await packConfigGet(packId);
      setConfigData(cfg);
    } catch {
      setConfigData({});
    }
  }

  async function saveConfig() {
    if (!configuring || !configData) return;
    setConfigBusy(true);
    try {
      await packConfigSet(configuring, configData);
      setConfiguring(null);
      setConfigData(null);
    } catch (e) {
      console.error('pack config save failed:', e);
    } finally {
      setConfigBusy(false);
    }
  }

  return (
    <Section
      id="settings-packs"
      title={t('settings.packs.title')}
      description={t('settings.packs.desc')}
    >
      <div className="mb-2 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={importing}
          onClick={() => void handleImport()}
        >
          <Icon icon={FileUp} size="sm" />
          {t('settings.packs.import_zip')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <Icon icon={RefreshCw} size="sm" className={loading ? 'animate-spin' : undefined} />
          {t('settings.packs.rescan')}
        </Button>
      </div>

      {configuring && configData && (
        <div className="mb-3 rounded-md border border-border bg-bg-elev-1 p-3">
          <div className="mb-2 text-sm font-medium text-fg">
            {t('settings.packs.config_for', { id: configuring })}
          </div>
          <textarea
            className="w-full rounded border border-border bg-bg-elev-2 p-2 font-mono text-xs text-fg"
            rows={8}
            value={JSON.stringify(configData, null, 2)}
            onChange={(e) => {
              try { setConfigData(JSON.parse(e.target.value)); } catch { /* invalid, keep old */ }
            }}
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={configBusy} onClick={() => void saveConfig()}>
              {t('settings.packs.save_config')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfiguring(null); setConfigData(null); }}>
              {t('settings.packs.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-bg-elev-1 p-3 text-xs">
        {loading && (
          <span className="text-fg-muted">{t('settings.packs.loading')}</span>
        )}

        {error && (
          <div className="text-red-500">{error}</div>
        )}

        {!loading && !error && packs.length === 0 && (
          <span className="text-fg-muted">{t('settings.packs.empty')}</span>
        )}

        {!loading && packs.length > 0 && (
          <ul className="flex flex-col gap-2">
            {packs.map((p) => (
              <li
                key={p.manifestId}
                className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-2 px-3 py-2"
              >
                <Icon icon={Package} size="sm" className="text-fg-subtle shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">
                      {p.title || p.manifestId}
                    </span>
                    <span className="shrink-0 text-fg-subtle">v{p.version}</span>
                    {p.author && (
                      <span className="shrink-0 text-fg-subtle">· {p.author}</span>
                    )}
                  </div>
                  {p.description && (
                    <div className="mt-0.5 truncate text-fg-subtle">{p.description}</div>
                  )}
                  {p.error && (
                    <div className="mt-1 text-red-500">{p.error}</div>
                  )}
                  {p.licenseGated && (
                    <div className="mt-1 flex items-center gap-1 text-amber-500">
                      <Icon icon={Lock} size="xs" />
                      {t('settings.packs.license_required')}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.enabled && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void openConfig(p.manifestId)}
                      title={t('settings.packs.configure')}
                    >
                      <Icon icon={Settings2} size="xs" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(p.error) || p.licenseGated}
                    onClick={() => void setEnabled(p.manifestId, !p.enabled)}
                    title={p.enabled ? t('settings.packs.disable') : t('settings.packs.enable')}
                  >
                    <Icon
                      icon={p.enabled ? ToggleRight : ToggleLeft}
                      size="sm"
                      className={p.enabled ? 'text-emerald-500' : 'text-fg-subtle'}
                    />
                    {p.enabled ? t('settings.packs.on') : t('settings.packs.off')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleUninstall(p.manifestId)}
                    title={t('settings.packs.uninstall')}
                  >
                    <Icon icon={Trash2} size="xs" className="text-danger" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
