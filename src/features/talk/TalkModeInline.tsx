import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Square, Volume2, X } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores/chat';

import { ApprovalCard } from '@/features/chat/ApprovalCard';

import { useTalkMode, type TalkState } from './useTalkMode';

/**
 * **Inline Talk Mode** — the composer's voice mode.
 *
 * Replaces the full-screen `TalkModeOverlay` for the in-conversation
 * voice flow. Lives inside the chat composer area: a compact ring +
 * status row + transcript/reply preview, no backdrop, no `z-50`.
 * Closes back to text mode via the `onExit` callback the parent
 * composer wires up.
 *
 * Owns no state of its own — everything comes from `useTalkMode`,
 * the same hook the legacy overlay consumed. That means the user
 * can switch between `TalkModeOverlay` (legacy code path, soon to
 * be removed) and `TalkModeInline` without losing in-flight audio.
 *
 * Keyboard:
 * - Space (held) = push-to-talk in PTT mode
 * - Esc = exit voice mode (does not close the entire chat)
 *
 * Visual hierarchy mirrors the overlay (ring → status label →
 * "you said" + "Corey's reply" cards) so muscle memory carries
 * over for users who used the topbar entry pre-v1.1.
 */
export function TalkModeInline({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  const {
    state,
    mode,
    level,
    error,
    readiness,
    setMode,
    pressPtt,
    releasePtt,
    stop,
    cancelTurn,
    micPermission,
    openMicSettings,
    pendingApproval,
    setPendingApproval,
  } = useTalkMode();
  const sessionId = useChatStore((s) => s.currentId) ?? '';

  // Same ref-based handler trick as the overlay — pressPtt /
  // releasePtt are recreated on every state change, but the
  // listener should attach once. See TalkModeOverlay.tsx for the
  // full backstory; the gist is: storing handlers in a ref +
  // empty-deps useEffect dodges the "press resets pressed flag
  // and keyup falls through" race that broke Space-PTT in v1.0.
  const pressedRef = useRef(false);
  const pressPttRef = useRef(pressPtt);
  const releasePttRef = useRef(releasePtt);
  const stopRef = useRef(stop);
  const onExitRef = useRef(onExit);
  const modeRef = useRef(mode);
  pressPttRef.current = pressPtt;
  releasePttRef.current = releasePtt;
  stopRef.current = stop;
  onExitRef.current = onExit;
  modeRef.current = mode;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        // Esc exits voice mode — stop in-flight audio first so
        // the user gets clean silence, but DON'T wipe the
        // transcript / reply (those are persisted into the chat
        // session anyway and clearing them flashes the cards
        // empty before the textarea fades back in).
        e.preventDefault();
        stopRef.current();
        onExitRef.current();
        return;
      }
      if (e.code !== 'Space') return;
      if (modeRef.current === 'auto') return;
      if (pressedRef.current) return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      pressedRef.current = true;
      pressPttRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!pressedRef.current) return;
      pressedRef.current = false;
      e.preventDefault();
      void releasePttRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elev-1 p-4"
      data-testid="talk-mode-inline"
      role="region"
      aria-label={t('talk.title', { defaultValue: '语音对话' })}
    >
      {/* Top row: ring + status + exit button */}
      <div className="flex items-center gap-4">
        <CompactRing
          state={state}
          mode={mode}
          level={level}
          onPress={pressPtt}
          onRelease={releasePtt}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <StateLabel state={state} />
          {readiness.reason && state === 'unconfigured' && (
            <span className="text-xs text-amber-500">{readiness.reason}</span>
          )}
          <span className="text-[10px] text-fg-subtle">
            {mode === 'auto'
              ? t('talk.hint_auto', {
                  defaultValue: '直接说话即可，停顿后自动发送',
                })
              : t('talk.hint_ptt', {
                  defaultValue: '按住中央按钮（或 Space）说话，松开发送',
                })}
            {' · '}
            <button
              type="button"
              onClick={() => setMode(mode === 'auto' ? 'ptt' : 'auto')}
              className="underline-offset-2 hover:text-fg-muted hover:underline"
              data-testid="talk-mode-toggle"
            >
              {mode === 'auto'
                ? t('talk.mode_switch_to_ptt', {
                    defaultValue: '切按键说话',
                  })
                : t('talk.mode_switch_to_auto', {
                    defaultValue: '切持续监听',
                  })}
            </button>
          </span>
        </div>

        {/* Inline stop button while a turn is in flight — keeps
            transcript + reply visible (cancelTurn, not stop). */}
        {(state === 'thinking' || state === 'speaking') && (
          <button
            type="button"
            onClick={cancelTurn}
            className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/5 px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
            data-testid="talk-stop"
            aria-label={t('talk.stop', { defaultValue: '停止' })}
          >
            <Icon icon={Square} size={12} />
            {state === 'thinking'
              ? t('talk.stop_thinking', { defaultValue: '停止生成' })
              : t('talk.stop_speaking', { defaultValue: '停止朗读' })}
          </button>
        )}

        {/* Exit voice mode → composer goes back to text. */}
        <button
          type="button"
          onClick={() => {
            stop();
            onExit();
          }}
          className="rounded-full p-1.5 text-fg-muted hover:bg-bg-elev-2 hover:text-fg"
          aria-label={t('talk.exit_voice', { defaultValue: '退出语音模式' })}
          title={t('talk.exit_voice', { defaultValue: '退出语音模式' })}
          data-testid="talk-exit"
        >
          <Icon icon={X} size={14} />
        </button>
      </div>

      {/* Transcript + reply cards intentionally omitted: when
          Talk Mode is inline (composer-mounted), the chat
          message list directly above already shows the user's
          turn and Corey's reply as normal chat bubbles, so
          duplicating them inside the talk panel would just
          visually compete with the canonical conversation
          surface. The full-screen `TalkModeOverlay` keeps the
          cards because it covers the chat list.

          Permission + error banners stay because they are
          talk-specific and have nowhere else to surface. */}
      {pendingApproval && (
        <ApprovalCard
          approval={pendingApproval}
          sessionId={sessionId}
          onResolved={() => setPendingApproval(null)}
        />
      )}
      {micPermission === 'denied' && (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left text-xs text-amber-600 dark:text-amber-400"
          data-testid="talk-mic-denied"
        >
          <p className="font-medium">
            {t('talk.mic_denied_title', { defaultValue: '麦克风权限被拒绝' })}
          </p>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/50 bg-bg px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
            onClick={() => void openMicSettings()}
            data-testid="talk-open-mic-settings"
          >
            {t('talk.mic_denied_open', {
              defaultValue: '打开系统设置 → 麦克风',
            })}
          </button>
        </div>
      )}
      {error && micPermission !== 'denied' && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Compact mic ring — half the size of the full-screen overlay's
 * 128×128 disc since it has to share horizontal space with the
 * status label, exit button, and the rest of the chat composer.
 */
function CompactRing({
  state,
  mode,
  level,
  onPress,
  onRelease,
}: {
  state: TalkState;
  mode: 'ptt' | 'auto';
  level: number;
  onPress: () => void;
  onRelease: () => void;
}) {
  const colorByState: Record<TalkState, string> = {
    idle: 'border-border bg-bg-elev-1 text-fg-muted',
    listening: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-500 animate-pulse',
    thinking: 'border-amber-500/40 bg-amber-500/5 text-amber-500',
    speaking: 'border-gold-500/60 bg-gold-500/10 text-gold-500',
    error: 'border-danger/60 bg-danger/10 text-danger',
    unconfigured: 'border-border bg-bg-elev-1 text-fg-subtle opacity-60',
  };
  const iconByState: Record<TalkState, typeof Mic> = {
    idle: Mic,
    listening: Mic,
    thinking: Square,
    speaking: Volume2,
    error: MicOff,
    unconfigured: MicOff,
  };
  const haloScale = mode === 'auto' ? Math.min(1.5, 1 + Math.max(0, level) * 4) : 0;
  const interactive = mode === 'ptt';
  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      {mode === 'auto' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500/40 transition-transform duration-100"
          style={{
            transform: `scale(${haloScale})`,
            opacity: 0.4 + Math.min(0.5, level * 2),
          }}
          data-testid="talk-vu-halo"
        />
      )}
      {state === 'listening' && mode === 'ptt' && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500/60 motion-safe:animate-ping"
            style={{ animationDuration: '1.4s' }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500/30 motion-safe:animate-ping"
            style={{ animationDuration: '1.4s', animationDelay: '0.6s' }}
          />
        </>
      )}
      <button
        type="button"
        onMouseDown={interactive ? onPress : undefined}
        onMouseUp={interactive ? () => void onRelease() : undefined}
        onTouchStart={interactive ? onPress : undefined}
        onTouchEnd={interactive ? () => void onRelease() : undefined}
        className={cn(
          'relative flex h-14 w-14 items-center justify-center rounded-full border-2 transition-colors',
          colorByState[state],
          interactive ? '' : 'cursor-default',
        )}
        aria-label={`Talk state: ${state}`}
        data-testid="talk-mic"
      >
        <Icon icon={iconByState[state]} size={20} />
      </button>
    </div>
  );
}

function StateLabel({ state }: { state: TalkState }) {
  const { t } = useTranslation();
  const labelByState: Record<TalkState, string> = {
    idle: t('talk.state_idle', { defaultValue: '准备好了 — 按住 Space 开始说话' }),
    listening: t('talk.state_listening', { defaultValue: '我在听...' }),
    thinking: t('talk.state_thinking', { defaultValue: 'Corey 正在思考' }),
    speaking: t('talk.state_speaking', { defaultValue: 'Corey 正在回答' }),
    error: t('talk.state_error', { defaultValue: '出错了' }),
    unconfigured: t('talk.state_unconfigured', {
      defaultValue: '语音功能尚未就绪',
    }),
  };
  const animated = state === 'thinking' || state === 'speaking';
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-fg">
      <span>{labelByState[state]}</span>
      {animated && (
        <span className="inline-flex gap-0.5" aria-hidden>
          <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
        </span>
      )}
    </div>
  );
}
