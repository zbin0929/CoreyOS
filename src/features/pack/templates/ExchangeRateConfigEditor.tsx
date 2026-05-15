import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { CronPicker, describeCron } from './shared/CronPicker';

interface ExchangeRateSchedule {
  name: string;
  cron: string;
}

interface ExchangeRateConfig {
  enabled: boolean;
  source: {
    name: string;
    url: string;
    rateType: string;
    queryKeyword: string;
    earliestTime: string;
  };
  conversion: {
    divideBy: number;
  };
  schedules: ExchangeRateSchedule[];
  target: {
    currencyCode: string;
    currencyName: string;
  };
  remarkTemplate: string;
  advanced: {
    retryAttempts: number;
    requestTimeout: number;
  };
}

interface ExchangeRateConfigEditorProps {
  config: ExchangeRateConfig;
  onChange: (config: ExchangeRateConfig) => void;
}

const DEFAULT_SCHEDULES: ExchangeRateSchedule[] = [
  { name: '早盘抓取', cron: '0 30 9 * * *' },
  { name: '兜底抓取', cron: '0 30 10 * * *' },
];

export function buildDefaultExchangeRateConfig(): ExchangeRateConfig {
  return {
    enabled: true,
    source: {
      name: '中国银行',
      url: 'https://srh.bankofchina.com/search/whpj/search_cn.jsp',
      rateType: '现汇卖出价',
      queryKeyword: '美元',
      earliestTime: '09:30',
    },
    conversion: { divideBy: 100 },
    schedules: DEFAULT_SCHEDULES,
    target: {
      currencyCode: 'USD',
      currencyName: '美金',
    },
    remarkTemplate: '更新汇率{datetime}  {rate}',
    advanced: {
      retryAttempts: 3,
      requestTimeout: 30,
    },
  };
}

export function ExchangeRateConfigEditor({ config, onChange }: ExchangeRateConfigEditorProps) {
  function updateSchedule(idx: number, updates: Partial<ExchangeRateSchedule>) {
    const schedules = [...config.schedules];
    const current = schedules[idx];
    if (!current) return;
    schedules[idx] = { name: updates.name ?? current.name, cron: updates.cron ?? current.cron };
    onChange({ ...config, schedules });
  }

  function addSchedule() {
    onChange({
      ...config,
      schedules: [...config.schedules, { name: '', cron: '0 30 9 * * *' }],
    });
  }

  function removeSchedule(idx: number) {
    const schedules = config.schedules.filter((_, i) => i !== idx);
    onChange({ ...config, schedules });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-gold-500" />
        <h3 className="text-base font-semibold text-fg">汇率配置</h3>
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
            启用美金汇率自动更新
          </button>
        </div>

        {config.enabled && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">数据源</label>
                <input
                  type="text"
                  value={config.source.name}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, name: e.target.value } })
                  }
                  placeholder="中国银行"
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">汇率类型</label>
                <input
                  type="text"
                  value={config.source.rateType}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, rateType: e.target.value } })
                  }
                  placeholder="现汇卖出价"
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">搜索关键词</label>
                <input
                  type="text"
                  value={config.source.queryKeyword}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, queryKeyword: e.target.value } })
                  }
                  placeholder="美元"
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
                <p className="text-[10px] text-fg-subtle">数据源页面上的货币名称</p>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">抓取时间起点</label>
                <input
                  type="time"
                  value={config.source.earliestTime}
                  onChange={(e) =>
                    onChange({ ...config, source: { ...config.source, earliestTime: e.target.value } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
                <p className="text-[10px] text-fg-subtle">取此时间后第一笔汇率</p>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">除以系数</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={config.conversion.divideBy}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        conversion: { divideBy: Number(e.target.value) },
                      })
                    }
                    className="w-24 rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                  />
                  <span className="text-xs text-fg-subtle">
                    示例: 682.78 ÷ {config.conversion.divideBy} ={' '}
                    {(682.78 / config.conversion.divideBy).toFixed(4)}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-fg">抓取计划</label>
                <Button type="button" size="sm" variant="ghost" onClick={addSchedule} className="gap-1">
                  <Icon icon={Plus} size="xs" />
                  添加计划
                </Button>
              </div>

              {config.schedules.map((schedule, idx) => (
                <div key={idx} className="space-y-2 rounded-lg border border-border/60 bg-bg p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={schedule.name}
                      onChange={(e) => updateSchedule(idx, { name: e.target.value })}
                      placeholder="计划名称（如 早盘抓取）"
                      className="flex-1 rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => removeSchedule(idx)}
                      className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Icon icon={Trash2} size="xs" />
                    </button>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">货币代码</label>
                <input
                  type="text"
                  value={config.target.currencyCode}
                  onChange={(e) =>
                    onChange({ ...config, target: { ...config.target, currencyCode: e.target.value } })
                  }
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg">备注模板</label>
                <input
                  type="text"
                  value={config.remarkTemplate}
                  onChange={(e) => onChange({ ...config, remarkTemplate: e.target.value })}
                  placeholder="更新汇率{datetime}  {rate}"
                  className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
