/**
 * Carrier configuration editor for Meizheng Pack.
 * Allows adding/removing carriers and configuring their settings.
 */
import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select, type SelectOption } from '@/components/ui/select';

import { CronPicker } from './shared/CronPicker';

type ApplyTo = 'default' | 'channels';

interface ServiceMapping {
  sourceName: string;
  country: string;
  applyTo: ApplyTo;
  serviceCodes?: string[];
}

const APPLY_TO_OPTIONS: SelectOption<ApplyTo>[] = [
  { value: 'default', label: '承运商默认费率' },
  { value: 'channels', label: '指定 channel（按服务代码匹配）' },
];

interface CarrierConfig {
  name: string;
  enabled: boolean;
  sourceUrl: string;
  updateFrequency: 'weekly' | 'monthly';
  cron: string;
  validityDays: number;
  services: ServiceMapping[];
}

interface CarrierConfigEditorProps {
  carriers: Record<string, CarrierConfig>;
  onChange: (carriers: Record<string, CarrierConfig>) => void;
}

const FREQUENCY_OPTIONS: SelectOption<'weekly' | 'monthly'>[] = [
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];

const VALIDITY_OPTIONS: SelectOption[] = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '-1', label: '整月（脚本自动计算到月末）' },
];

export function CarrierConfigEditor({ carriers, onChange }: CarrierConfigEditorProps) {
  const [expandedCarriers, setExpandedCarriers] = useState<Record<string, boolean>>({});

  const carrierIds = Object.keys(carriers);

  function addCarrier() {
    const newId = `carrier_${Date.now()}`;
    onChange({
      ...carriers,
      [newId]: {
        name: '',
        enabled: true,
        sourceUrl: '',
        updateFrequency: 'weekly',
        cron: '0 30 23 * * 0',
        validityDays: 7,
        services: [],
      },
    });
    setExpandedCarriers({ ...expandedCarriers, [newId]: true });
  }

  function removeCarrier(id: string) {
    const next = { ...carriers };
    delete next[id];
    onChange(next);
  }

  function updateCarrier(id: string, updates: Partial<CarrierConfig>) {
    const current = carriers[id];
    if (!current) return;
    onChange({
      ...carriers,
      [id]: { ...current, ...updates },
    });
  }

  function addService(carrierId: string) {
    const carrier = carriers[carrierId];
    if (!carrier) return;
    updateCarrier(carrierId, {
      services: [
        ...(carrier.services || []),
        { sourceName: '', country: 'US', applyTo: 'default' },
      ],
    });
  }

  function updateService(carrierId: string, serviceIdx: number, updates: Partial<ServiceMapping>) {
    const carrier = carriers[carrierId];
    if (!carrier || !carrier.services) return;
    const services = [...carrier.services];
    const current = services[serviceIdx];
    if (!current) return;
    services[serviceIdx] = {
      sourceName: current.sourceName,
      country: current.country,
      applyTo: current.applyTo,
      serviceCodes: current.serviceCodes,
      ...updates,
    };
    updateCarrier(carrierId, { services });
  }

  function removeService(carrierId: string, serviceIdx: number) {
    const carrier = carriers[carrierId];
    if (!carrier || !carrier.services) return;
    const services = carrier.services.filter((_, i) => i !== serviceIdx);
    updateCarrier(carrierId, { services });
  }

  function toggleExpanded(id: string) {
    setExpandedCarriers({ ...expandedCarriers, [id]: !expandedCarriers[id] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-gold-500" />
          <h3 className="text-base font-semibold text-fg">承运商配置</h3>
        </div>
        <Button type="button" size="sm" onClick={addCarrier} className="gap-1.5">
          <Icon icon={Plus} size="sm" />
          添加承运商
        </Button>
      </div>

      {carrierIds.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-border/50 bg-bg-elev-2/30 p-8 text-center">
          <p className="text-sm text-fg-subtle">暂无承运商配置</p>
          <p className="mt-1 text-xs text-fg-subtle/70">点击上方“添加承运商”按钮开始配置</p>
        </div>
      )}

      {carrierIds.map((id) => {
        const carrier = carriers[id];
        if (!carrier) return null;
        const isExpanded = expandedCarriers[id];

        return (
          <div key={id} className="rounded-lg border border-border/60 bg-bg shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => toggleExpanded(id)}
                className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-elev-1 hover:text-fg"
              >
                <Icon icon={isExpanded ? ChevronDown : ChevronRight} size="sm" />
              </button>

              <input
                type="text"
                value={carrier.name || ''}
                onChange={(e) => updateCarrier(id, { name: e.target.value })}
                placeholder="承运商名称（如 UPS）"
                className="flex-1 rounded-lg border border-border/60 bg-bg-elev-1 px-4 py-2 text-sm font-medium text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
              />

              <button
                type="button"
                onClick={() => updateCarrier(id, { enabled: !(carrier.enabled ?? true) })}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-elev-1"
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                  carrier.enabled ?? true
                    ? 'border-gold-500 bg-gold-500'
                    : 'border-border/60 bg-transparent'
                }`}>
                  {(carrier.enabled ?? true) && (
                    <Icon icon={Check} size="xs" className="text-white" />
                  )}
                </div>
                启用
              </button>

              <button
                type="button"
                onClick={() => removeCarrier(id)}
                className="rounded p-2 text-red-500 transition-colors hover:bg-red-500/10"
              >
                <Icon icon={Trash2} size="sm" />
              </button>
            </div>

            {isExpanded && (
              <div className="space-y-5 border-t border-border/50 bg-bg-elev-1/30 px-5 pb-5 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-fg">数据源 URL</label>
                    <input
                      type="url"
                      value={carrier.sourceUrl || ''}
                      onChange={(e) => updateCarrier(id, { sourceUrl: e.target.value })}
                      placeholder="https://www.ups.com/..."
                      className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-fg">更新频率</label>
                    <Select
                      value={carrier.updateFrequency || 'weekly'}
                      onChange={(v) => updateCarrier(id, { updateFrequency: v as 'weekly' | 'monthly' })}
                      options={FREQUENCY_OPTIONS}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-fg">触发时间</label>
                    <CronPicker
                      value={carrier.cron || ''}
                      onChange={(cron) => updateCarrier(id, { cron })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-fg">有效期（天）</label>
                    <Select
                      value={String(carrier.validityDays || 7)}
                      onChange={(v) => updateCarrier(id, { validityDays: Number(v) })}
                      options={VALIDITY_OPTIONS}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg">服务映射</label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => addService(id)}
                      className="gap-1"
                    >
                      <Icon icon={Plus} size="xs" />
                      添加映射
                    </Button>
                  </div>

                  {(!carrier.services || carrier.services.length === 0) && (
                    <div className="rounded-lg border border-dashed border-border/50 bg-bg-elev-2/50 p-4 text-center text-xs text-fg-subtle">
                      暂无服务映射
                    </div>
                  )}

                  {carrier.services && carrier.services.map((service, idx) => (
                    <div key={idx} className="space-y-2 rounded-lg border border-border/60 bg-bg p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={service.sourceName}
                          onChange={(e) => updateService(id, idx, { sourceName: e.target.value })}
                          placeholder="源服务名（如 Domestic Ground Surcharge）"
                          className="flex-1 rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
                        />
                        <input
                          type="text"
                          value={service.country}
                          onChange={(e) => updateService(id, idx, { country: e.target.value })}
                          placeholder="国家"
                          className="w-20 rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
                        />
                        <button
                          type="button"
                          onClick={() => removeService(id, idx)}
                          className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
                        >
                          <Icon icon={Trash2} size="xs" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-fg-subtle">写入到：</span>
                        <div className="w-56">
                          <Select
                            value={service.applyTo}
                            onChange={(value) => updateService(id, idx, { applyTo: value, serviceCodes: value === 'channels' ? (service.serviceCodes || []) : undefined })}
                            options={APPLY_TO_OPTIONS}
                          />
                        </div>
                        {service.applyTo === 'channels' && (
                          <input
                            type="text"
                            value={(service.serviceCodes || []).join(', ')}
                            onChange={(e) => updateService(id, idx, {
                              serviceCodes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            })}
                            placeholder="服务代码，逗号分隔（如 NEXT_DAY_AIR, SECOND_DAY_AIR）"
                            className="flex-1 rounded-md border border-border/60 bg-bg-elev-1 px-3 py-1.5 text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
