import { cn } from '@/lib/cn';

const isMac =
  typeof navigator !== 'undefined' &&
  (navigator.platform.toLowerCase().includes('mac') || navigator.userAgent.includes('Mac'));

const keyMap: Record<string, { mac: string; win: string }> = {
  mod: { mac: '⌘', win: 'Ctrl' },
  cmd: { mac: '⌘', win: 'Win' },
  alt: { mac: '⌥', win: 'Alt' },
  shift: { mac: '⇧', win: 'Shift' },
  ctrl: { mac: '⌃', win: 'Ctrl' },
  enter: { mac: '↵', win: '↵' },
  esc: { mac: 'Esc', win: 'Esc' },
  tab: { mac: 'Tab', win: 'Tab' },
  up: { mac: '↑', win: '↑' },
  down: { mac: '↓', win: '↓' },
  left: { mac: '←', win: '←' },
  right: { mac: '→', win: '→' },
};

function renderKey(k: string): string {
  const lookup = keyMap[k.toLowerCase()];
  if (lookup) return isMac ? lookup.mac : lookup.win;
  return k.toUpperCase();
}

export interface KbdProps {
  keys: string[];
  className?: string;
}

export function Kbd({ keys, className }: KbdProps) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-flex min-w-[18px] items-center justify-center',
            'rounded-sm border border-border bg-bg-elev-2 px-1',
            'text-[10px] font-medium text-fg-muted',
            'h-[18px]',
          )}
        >
          {renderKey(k)}
        </kbd>
      ))}
    </span>
  );
}
