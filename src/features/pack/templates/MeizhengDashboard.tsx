import { useState, useEffect } from 'react';
import {
  Fuel,
  DollarSign,
  Truck,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
} from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { workflowRun } from '@/lib/ipc/runtime';
import type { PackView } from '@/lib/ipc/pack';
import {
  packConfigGet,
  packViewData,
} from '@/lib/ipc/pack';

interface FuelRate {
  carrier: string;
  source_name: string;
  rate: number;
  effective_date: string;
  valid_to: string;
}

interface DashboardState {
  fuelRates: FuelRate[];
  exchangeRate: number | null;
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;
}

interface WorkflowEntry {
  id: string;
  name: string;
  description: string;
  schedule: string;
}

const WORKFLOWS: WorkflowEntry[] = [
  {
    id: 'update-fuel-rates-weekly',
    name: '燃油费率更新',
    description: 'UPS + FedEx 燃油附加费',
    schedule: '每周日 23:30',
  },
  {
    id: 'update-fuel-rates-monthly',
    name: 'DHL 燃油更新',
    description: 'DHL 燃油附加费',
    schedule: '每月 20 号',
  },
  {
    id: 'update-usd-exchange-rate',
    name: '美元汇率更新',
    description: '中行美元现汇卖出价',
    schedule: '每天 09:30/10:30',
  },
  {
    id: 'update-ups-zones',
    name: 'UPS 分区更新',
    description: '全美 902 ZIP3',
    schedule: '每月 1 号',
  },
  {
    id: 'update-usps-zones',
    name: 'USPS 分区更新',
    description: '全美 930 ZIP3',
    schedule: '每月 1 号',
  },
  {
    id: 'update-fedex-zones',
    name: 'FedEx 分区更新',
    description: 'FedEx Ground 分区',
    schedule: '每月 1 号',
  },
];

const CARRIER_COLORS: Record<string, string> = {
  UPS: 'bg-amber-500',
  FedEx: 'bg-purple-600',
  DHL: 'bg-red-600',
};

const CARRIER_TEXT_COLORS: Record<string, string> = {
  UPS: 'text-amber-600',
  FedEx: 'text-purple-600',
  DHL: 'text-red-600',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return dateStr;
  }
}

function isRatePercent(rate: number): boolean {
  return rate > 1;
}

export function MeizhengDashboardTemplate({ view }: { view: PackView }) {
  const [state, setState] = useState<DashboardState>({
    fuelRates: [],
    exchangeRate: null,
    lastUpdated: null,
    loading: true,
    error: null,
  });
  const [runningWf, setRunningWf] = useState<string | null>(null);
  const [wfResults, setWfResults] = useState<Record<string, 'ok' | 'error'>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [rawData, rawConfig] = await Promise.all([
          packViewData(view.packId, view.viewId),
          packConfigGet(view.packId),
        ]);

        if (cancelled) return;

        const data = (rawData ?? {}) as Record<string, unknown>;
        const config = (rawConfig ?? {}) as Record<string, unknown>;

        const rawRates = data.fuel_rates ?? data.rates ?? data;
        const rates: FuelRate[] = Array.isArray(rawRates)
          ? rawRates
          : [];

        const er =
          config.exchange_rate ??
          data.exchange_rate ??
          null;

        setState({
          fuelRates: rates,
          exchangeRate: typeof er === 'number' ? er : null,
          lastUpdated: (data.last_updated as string | null) ?? null,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [view.packId, view.viewId]);

  async function handleRunWorkflow(wfId: string) {
    setRunningWf(wfId);
    setWfResults((prev) => {
      const next = { ...prev };
      delete next[wfId];
      return next;
    });
    try {
      await workflowRun(`pack__${view.packId}__${wfId}`, { packId: view.packId });
      setWfResults((prev) => ({ ...prev, [wfId]: 'ok' }));
    } catch {
      setWfResults((prev) => ({ ...prev, [wfId]: 'error' }));
    } finally {
      setRunningWf(null);
    }
  }

  const { fuelRates, exchangeRate, loading } = state;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <div className="flex items-center gap-2">
            <Icon icon={Fuel} size="sm" className="text-gold-500" />
            <h2 className="text-sm font-semibold text-fg">燃油附加费</h2>
            {fuelRates.length > 0 && (
              <span className="text-xs text-fg-subtle">
                更新于 {formatDate(fuelRates[0]?.effective_date ?? null)}
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-border/40 bg-bg-elev-1"
                />
              ))}
            </div>
          ) : fuelRates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-elev-1 p-8 text-center text-sm text-fg-subtle">
              <Icon icon={AlertCircle} size="lg" className="mx-auto mb-2 text-fg-muted" />
              暂无燃油数据，请先运行一次燃油更新工作流
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fuelRates.map((r, idx) => {
                const color = CARRIER_COLORS[r.carrier] ?? 'bg-gray-500';
                const textColor = CARRIER_TEXT_COLORS[r.carrier] ?? 'text-gray-600';
                const percent = isRatePercent(r.rate);
                return (
                  <div
                    key={`${r.carrier}-${idx}`}
                    className="relative overflow-hidden rounded-xl border border-border/50 bg-bg-elev-1 p-4 shadow-sm transition-shadow hover:shadow-1"
                  >
                    <div
                      className={`absolute left-0 top-0 h-full w-1 ${color}`}
                    />
                    <div className="pl-3">
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${color}`}
                        >
                          {r.carrier}
                        </span>
                        <span className="text-[10px] text-fg-subtle">
                          {formatDate(r.effective_date)} ~ {formatDate(r.valid_to)}
                        </span>
                      </div>
                      <div className={`mt-2 text-2xl font-bold tabular-nums ${textColor}`}>
                        {percent ? `${r.rate}%` : `$${r.rate.toFixed(2)}`}
                      </div>
                      <div className="mt-1 text-xs text-fg-subtle line-clamp-1">
                        {r.source_name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="flex items-center gap-2">
            <Icon icon={DollarSign} size="sm" className="text-gold-500" />
            <h2 className="text-sm font-semibold text-fg">美元汇率</h2>
          </div>
          <div className="rounded-xl border border-border/50 bg-bg-elev-1 p-5 shadow-sm">
            {loading ? (
              <div className="h-16 animate-pulse rounded-lg bg-bg-elev-2" />
            ) : exchangeRate !== null ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-fg-subtle">中行美元现汇卖出价</span>
                <span className="text-3xl font-bold tabular-nums text-fg">
                  {exchangeRate.toFixed(4)}
                </span>
                <span className="text-xs text-fg-subtle">CNY/USD</span>
              </div>
            ) : (
              <div className="text-sm text-fg-subtle">
                暂无汇率数据，请先运行汇率更新
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Icon icon={Truck} size="sm" className="text-gold-500" />
            <h2 className="text-sm font-semibold text-fg">承运商分区</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['UPS', 'USPS', 'FedEx'].map((carrier) => (
              <div
                key={carrier}
                className="flex flex-col items-center gap-1 rounded-lg border border-border/40 bg-bg-elev-1 px-2 py-3 text-center"
              >
                <span className="text-xs font-medium text-fg">{carrier}</span>
                <span className="text-[10px] text-fg-subtle">每月更新</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Icon icon={RefreshCw} size="sm" className="text-gold-500" />
        <h2 className="text-sm font-semibold text-fg">自动化工作流</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WORKFLOWS.map((wf) => {
          const isRunning = runningWf === wf.id;
          const result = wfResults[wf.id];
          return (
            <div
              key={wf.id}
              className="flex items-center gap-3 rounded-xl border border-border/50 bg-bg-elev-1 p-4 shadow-sm transition-shadow hover:shadow-1"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-fg">{wf.name}</span>
                <span className="text-xs text-fg-subtle">{wf.description}</span>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-fg-muted">
                  <Icon icon={Clock} size="xs" />
                  {wf.schedule}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                {result === 'ok' && (
                  <Icon icon={CheckCircle2} size="sm" className="text-success" />
                )}
                {result === 'error' && (
                  <Icon icon={AlertCircle} size="sm" className="text-danger" />
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isRunning}
                  onClick={() => void handleRunWorkflow(wf.id)}
                  className="gap-1 text-xs"
                >
                  {isRunning ? (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Icon icon={ChevronRight} size="xs" />
                  )}
                  {isRunning ? '执行中' : '执行'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
