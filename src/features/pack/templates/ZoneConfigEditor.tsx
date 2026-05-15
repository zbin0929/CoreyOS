import { CronPicker, describeCron } from './shared/CronPicker';

interface ZoneSchedule {
  name: string;
  cron: string;
}

interface ZoneConfig {
  enabled: boolean;
  schedules: ZoneSchedule[];
  source: {
    carrier: string;
    service: string;
    totalZip3: number;
  };
  upload: {
    maxRetries: number;
    retryDelay: number;
    requestInterval: number;
  };
}

interface ZoneConfigEditorProps {
  config: ZoneConfig;
  onChange: (config: ZoneConfig) => void;
}

const DEFAULT_SCHEDULES: ZoneSchedule[] = [
  { name: '月度分区更新', cron: '0 0 2 1 * *' },
];

export function buildDefaultZoneConfig(): ZoneConfig {
  return {
    enabled: true,
    schedules: DEFAULT_SCHEDULES,
    source: {
      carrier: 'UPS',
      service: 'GROUND',
      totalZip3: 902,
    },
    upload: {
      maxRetries: 3,
      retryDelay: 2,
      requestInterval: 1,
    },
  };
}

export function ZoneConfigEditor({ config, onChange }: ZoneConfigEditorProps) {
  function updateSchedule(idx: number, updates: Partial<ZoneSchedule>) {
    const schedules = [...config.schedules];
    const current = schedules[idx];
    if (!current) return;
    schedules[idx] = { name: updates.name ?? current.name, cron: updates.cron ?? current.cron };
    onChange({ ...config, schedules });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-gold-500" />
        <h3 className="text-base font-semibold text-fg">UPS 分区配置</h3>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-bg-elev-1/30 p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...config, enabled: !config.enabled })}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-elev-1"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                config.enabled ? 'border-gold-500 bg-gold-500' : 'border-border/60 bg-transparent'
              }`}
            >
              {config.enabled && (
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            启用 UPS 分区自动更新
          </button>
        </div>

        {config.enabled && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">承运商</label>
                <input
                  type="text"
                  value={config.source.carrier}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, carrier: e.target.value } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">服务类型</label>
                <input
                  type="text"
                  value={config.source.service}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, service: e.target.value } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">ZIP3 总数</label>
                <input
                  type="number"
                  value={config.source.totalZip3}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, totalZip3: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
                <p className="text-[10px] text-fg-subtle">美国 3 位邮编前缀总数</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-fg">更新计划</label>
              {config.schedules.map((schedule, idx) => (
                <div key={idx} className="space-y-2 rounded-lg border border-border/60 bg-bg p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={schedule.name}
                      onChange={(e) => updateSchedule(idx, { name: e.target.value })}
                      className="flex-1 rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
                    />
                  </div>
                  <div className="text-[10px] text-fg-subtle">
                    预览：{describeCron(schedule.cron)}
                  </div>
                  <CronPicker
                    value={schedule.cron}
                    onChange={(cron) => updateSchedule(idx, { cron })}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">最大重试次数</label>
                <input
                  type="number"
                  value={config.upload.maxRetries}
                  onChange={(e) =>
                    onChange({ ...config, upload: { ...config.upload, maxRetries: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">重试间隔（秒）</label>
                <input
                  type="number"
                  value={config.upload.retryDelay}
                  onChange={(e) =>
                    onChange({ ...config, upload: { ...config.upload, retryDelay: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">请求间隔（秒）</label>
                <input
                  type="number"
                  value={config.upload.requestInterval}
                  onChange={(e) =>
                    onChange({ ...config, upload: { ...config.upload, requestInterval: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
                <p className="text-[10px] text-fg-subtle">每个 ZIP3 之间的等待时间</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
