/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  dangerous?: boolean;
  separator?: false;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

const Ctx = createContext<{
  show: (e: MouseEvent | React.MouseEvent, items: MenuEntry[]) => void;
}>({ show: () => {} });

export function useContextMenu(items: MenuEntry[]) {
  const { show } = useContext(Ctx);
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      show(e.nativeEvent, items);
    },
    [show, items],
  );
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const show = useCallback((e: MouseEvent | React.MouseEvent, items: MenuEntry[]) => {
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 32 - 16);
    setState({ x, y, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const onClick = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [state, close]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {state && (
        <div
          ref={containerRef}
          className={cn(
            'fixed z-[9999] min-w-[160px] max-w-[260px] overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 py-1 shadow-2',
          )}
          style={{ left: state.x, top: state.y }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {state.items.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="my-1 border-t border-border" />
            ) : (
              <button
                key={`item-${i}`}
                type="button"
                disabled={item.disabled}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  item.dangerous
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-fg hover:bg-bg-elev-2',
                )}
                onClick={() => {
                  item.onClick();
                  close();
                }}
              >
                {item.icon && <span className="flex-none text-fg-subtle">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
