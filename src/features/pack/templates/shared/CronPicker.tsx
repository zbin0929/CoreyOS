import { Select, type SelectOption } from '@/components/ui/select';

export type CronMode = 'weekly' | 'monthly' | 'daily' | 'custom';

export interface ParsedCron {
  mode: CronMode;
  hour: number;
  minute: number;
  weekday: number;
  dom: number;
}

export const WEEKDAY_OPTIONS: SelectOption[] = [
  { value: '0', label: '周日' },
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
];

export const DOM_OPTIONS: SelectOption[] = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} 号`,
}));

export const MODE_OPTIONS: SelectOption[] = [
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'daily', label: '每天' },
  { value: 'custom', label: '自定义' },
];

export function parseCron(expr: string): ParsedCron {
  const fallback: ParsedCron = { mode: 'custom', hour: 23, minute: 30, weekday: 0, dom: 1 };
  if (!expr) return fallback;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 6) return fallback;
  const sec = parts[0] ?? '';
  const min = parts[1] ?? '';
  const hour = parts[2] ?? '';
  const dom = parts[3] ?? '';
  const month = parts[4] ?? '';
  const dow = parts[5] ?? '';
  if (sec !== '0') return fallback;
  const minNum = parseInt(min, 10);
  const hourNum = parseInt(hour, 10);
  if (isNaN(minNum) || isNaN(hourNum)) return fallback;
  if (dom === '*' && month === '*' && /^[0-7]$/.test(dow)) {
    return { mode: 'weekly', weekday: parseInt(dow, 10) % 7, hour: hourNum, minute: minNum, dom: 1 };
  }
  if (/^\d+$/.test(dom) && month === '*' && dow === '*') {
    return { mode: 'monthly', dom: parseInt(dom, 10), hour: hourNum, minute: minNum, weekday: 0 };
  }
  if (dom === '*' && month === '*' && dow === '*') {
    return { mode: 'daily', hour: hourNum, minute: minNum, weekday: 0, dom: 1 };
  }
  return fallback;
}

export function buildCron(p: ParsedCron, fallbackRaw: string): string {
  switch (p.mode) {
    case 'weekly':
      return `0 ${p.minute} ${p.hour} * * ${p.weekday}`;
    case 'monthly':
      return `0 ${p.minute} ${p.hour} ${p.dom} * *`;
    case 'daily':
      return `0 ${p.minute} ${p.hour} * * *`;
    default:
      return fallbackRaw;
  }
}

export function describeCron(expr: string): string {
  const p = parseCron(expr);
  const t = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  if (p.mode === 'weekly') {
    return `每${WEEKDAY_OPTIONS[p.weekday]?.label ?? '周日'} ${t}`;
  }
  if (p.mode === 'monthly') {
    return `每月 ${p.dom} 号 ${t}`;
  }
  if (p.mode === 'daily') {
    return `每天 ${t}`;
  }
  return `自定义：${expr || '(空)'}`;
}

interface CronPickerProps {
  value: string;
  onChange: (cron: string) => void;
}

export function CronPicker({ value, onChange }: CronPickerProps) {
  const parsed = parseCron(value);
  const timeStr = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;

  const setMode = (mode: CronMode) => {
    if (mode === 'custom') return;
    const next: ParsedCron = { ...parsed, mode };
    onChange(buildCron(next, value));
  };
  const setWeekday = (w: number) => {
    const next: ParsedCron = { ...parsed, weekday: w };
    onChange(buildCron(next, value));
  };
  const setDom = (d: number) => {
    const next: ParsedCron = { ...parsed, dom: d };
    onChange(buildCron(next, value));
  };
  const setTime = (t: string) => {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr ?? '0', 10);
    const m = parseInt(mStr ?? '0', 10);
    if (isNaN(h) || isNaN(m)) return;
    const next: ParsedCron = { ...parsed, hour: h, minute: m };
    onChange(buildCron(next, value));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={parsed.mode}
          onChange={(v) => setMode(v as CronMode)}
          options={MODE_OPTIONS}
          className="w-full"
        />
        {parsed.mode === 'weekly' && (
          <Select
            value={String(parsed.weekday)}
            onChange={(v) => setWeekday(Number(v))}
            options={WEEKDAY_OPTIONS}
            className="w-full"
          />
        )}
        {parsed.mode === 'monthly' && (
          <Select
            value={String(parsed.dom)}
            onChange={(v) => setDom(Number(v))}
            options={DOM_OPTIONS}
            className="w-full"
          />
        )}
        {(parsed.mode === 'daily' || parsed.mode === 'custom') && <div />}
      </div>
      {parsed.mode !== 'custom' ? (
        <input
          type="time"
          value={timeStr}
          onChange={(e) => setTime(e.target.value)}
          className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 text-xs text-fg transition-colors hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
        />
      ) : (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 30 23 * * 0"
            className="w-full rounded-lg border border-border/60 bg-bg px-3 py-2 font-mono text-xs text-fg transition-colors placeholder:text-fg-subtle/50 hover:border-border focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
          />
          <p className="mt-1 text-[10px] text-fg-subtle/70">
            提示：每月28号{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 text-[10px]">0 30 23 28 * *</code>{' '}
            或每天{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 text-[10px]">0 30 23 * * *</code>
            （脚本内判断月末）
          </p>
        </>
      )}
      <p className="text-[11px] text-fg-subtle">预览：{describeCron(value)}</p>
    </div>
  );
}
