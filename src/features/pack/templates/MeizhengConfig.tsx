/**
 * Meizheng Pack 专用配置界面
 * 完整的企业级配置，包含承运商动态配置
 */
import { useState, useEffect } from 'react';
import { Save, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select, type SelectOption } from '@/components/ui/select';
import { packConfigGet, packConfigSet, packExchangeRateConfigGet, packExchangeRateConfigSet, packZoneConfigGet, packZoneConfigSet } from '@/lib/ipc/pack';
import type { PackView } from '@/lib/ipc/pack';
import { CarrierConfigEditor } from './CarrierConfigEditor';
import {
  ExchangeRateConfigEditor,
  buildDefaultExchangeRateConfig,
} from './ExchangeRateConfigEditor';
import {
  ZoneConfigEditor,
  buildDefaultZoneConfig,
} from './ZoneConfigEditor';

interface MeizhengConfig {
  meizheng_os: {
    base_url: string;
    api_base_url: string;
    credentials: {
      username: string;
      password: string;
    };
  };
  carriers: Record<string, {
    name: string;
    enabled: boolean;
    sourceUrl: string;
    updateFrequency: 'weekly' | 'monthly';
    cron: string;
    validityDays: number;
    services: Array<{
      sourceName: string;
      country: string;
      applyTo: 'default' | 'channels';
      serviceCodes?: string[];
    }>;
  }>;
  advanced: {
    browserTimeout: number;
    retryAttempts: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

const DEFAULT_CONFIG: MeizhengConfig = {
  meizheng_os: {
    base_url: 'http://dev.mazonlabel.com/ship',
    api_base_url: 'http://dev.mazonlabel.com/ship',
    credentials: {
      username: '',
      password: '',
    },
  },
  carriers: {},
  advanced: {
    browserTimeout: 60,
    retryAttempts: 3,
    logLevel: 'info',
  },
};

const LOG_LEVEL_OPTIONS: SelectOption<'debug' | 'info' | 'warn' | 'error'>[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

export function MeizhengConfigTemplate({ view }: { view: PackView }) {
  const [config, setConfig] = useState<MeizhengConfig>(DEFAULT_CONFIG);
  const [exchangeRateConfig, setExchangeRateConfig] = useState(() => buildDefaultExchangeRateConfig());
  const [zoneConfig, setZoneConfig] = useState(() => buildDefaultZoneConfig());
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loading, setLoading] = useState(true);

  const packId = view.packId;

  useEffect(() => {
    async function load() {
      try {
        const [data, erData, zData] = await Promise.all([
          packConfigGet(packId),
          packExchangeRateConfigGet(packId),
          packZoneConfigGet(packId),
        ]);
        setConfig({ ...DEFAULT_CONFIG, ...data } as MeizhengConfig);
        if (erData && Object.keys(erData).length > 0) {
          setExchangeRateConfig(prev => ({ ...prev, ...erData }) as ReturnType<typeof buildDefaultExchangeRateConfig>);
        }
        if (zData && Object.keys(zData).length > 0) {
          setZoneConfig(prev => ({ ...prev, ...zData }) as ReturnType<typeof buildDefaultZoneConfig>);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [packId]);

  async function handleSave() {
    setSaving(true);
    setSaveStatus('saving');
    try {
      await Promise.all([
        packConfigSet(packId, config as unknown as Record<string, unknown>),
        packExchangeRateConfigSet(packId, exchangeRateConfig as unknown as Record<string, unknown>),
        packZoneConfigSet(packId, zoneConfig as unknown as Record<string, unknown>),
      ]);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      console.error('Failed to save config:', e);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-fg-subtle">
        加载配置中...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg">系统配置</h1>
          <p className="text-base text-fg-subtle">配置美正OS连接和承运商自动化参数</p>
        </div>
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium shadow-sm"
        >
          {saveStatus === 'saving' && (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              保存中...
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Icon icon={CheckCircle2} size="sm" className="text-green-500" />
              已保存
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <Icon icon={AlertCircle} size="sm" className="text-red-500" />
              保存失败
            </>
          )}
          {saveStatus === 'idle' && (
            <>
              <Icon icon={Save} size="sm" />
              保存配置
            </>
          )}
        </Button>
      </div>

      {/* 基础配置 - 合并地址和凭证 */}
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-bg-elev-1 to-bg-elev-2/50 p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-gold-500" />
          <h3 className="text-base font-semibold text-fg">基础配置</h3>
        </div>
        
        {/* 美正OS地址 */}
        <div className="mb-6 grid grid-cols-2 gap-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">
              美正OS Web 地址 <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="url"
              value={config.meizheng_os.base_url}
              onChange={(e) =>
                setConfig({
                  ...config,
                  meizheng_os: { ...config.meizheng_os, base_url: e.target.value },
                })
              }
              placeholder="http://dev.mazonlabel.com/ship"
              className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
            <p className="mt-2 text-xs leading-relaxed text-fg-subtle">用于浏览器自动化的Web界面地址</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">
              美正OS API 地址 <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="url"
              value={config.meizheng_os.api_base_url}
              onChange={(e) =>
                setConfig({
                  ...config,
                  meizheng_os: { ...config.meizheng_os, api_base_url: e.target.value },
                })
              }
              placeholder="http://dev.mazonlabel.com/ship"
              className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
            <p className="mt-2 text-xs leading-relaxed text-fg-subtle">用于REST API调用的接口地址</p>
          </div>
        </div>

        {/* 登录凭证 */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">
              用户名 <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={config.meizheng_os.credentials.username}
              onChange={(e) =>
                setConfig({
                  ...config,
                  meizheng_os: {
                    ...config.meizheng_os,
                    credentials: { ...config.meizheng_os.credentials, username: e.target.value },
                  },
                })
              }
              placeholder="zidonghua"
              className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">
              密码 <span className="ml-0.5 text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={config.meizheng_os.credentials.password}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    meizheng_os: {
                      ...config.meizheng_os,
                      credentials: { ...config.meizheng_os.credentials, password: e.target.value },
                    },
                  })
                }
                className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 pr-11 text-sm text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition-colors hover:bg-bg-elev-1 hover:text-fg"
              >
                <Icon icon={showPassword ? EyeOff : Eye} size="sm" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-subtle">🔒 密码将加密存储</p>
          </div>
        </div>
      </div>

      {/* 承运商配置 */}
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-bg-elev-1 to-bg-elev-2/50 p-6 shadow-sm">
        <CarrierConfigEditor
          carriers={config.carriers}
          onChange={(carriers) => setConfig({ ...config, carriers })}
        />
      </div>

      {/* 汇率配置 */}
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-bg-elev-1 to-bg-elev-2/50 p-6 shadow-sm">
        <ExchangeRateConfigEditor
          config={exchangeRateConfig}
          onChange={setExchangeRateConfig}
        />
      </div>

      {/* UPS 分区配置 */}
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-bg-elev-1 to-bg-elev-2/50 p-6 shadow-sm">
        <ZoneConfigEditor
          config={zoneConfig}
          onChange={setZoneConfig}
        />
      </div>

      {/* 高级选项 */}
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-bg-elev-1 to-bg-elev-2/50 p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-gold-500" />
          <h3 className="text-base font-semibold text-fg">高级选项</h3>
        </div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">浏览器超时（秒）</label>
            <input
              type="number"
              value={config.advanced.browserTimeout}
              onChange={(e) =>
                setConfig({
                  ...config,
                  advanced: { ...config.advanced, browserTimeout: Number(e.target.value) },
                })
              }
              className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 text-sm text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">失败重试次数</label>
            <input
              type="number"
              value={config.advanced.retryAttempts}
              onChange={(e) =>
                setConfig({
                  ...config,
                  advanced: { ...config.advanced, retryAttempts: Number(e.target.value) },
                })
              }
              className="w-full rounded-lg border border-border/60 bg-bg px-4 py-2.5 text-sm text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">日志级别</label>
            <Select
              value={config.advanced.logLevel}
              onChange={(value) =>
                setConfig({
                  ...config,
                  advanced: { ...config.advanced, logLevel: value },
                })
              }
              options={LOG_LEVEL_OPTIONS}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
