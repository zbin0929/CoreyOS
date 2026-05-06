import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Square, X, Volume2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';

import { useTalkMode, type TalkState } from './useTalkMode';

/**
 * Full-screen Talk Mode overlay (B-8 v0).
 *
 * Three visual states match the underlying state machine:
 *   - **listening**  → pulsing mic ring, live transcript appears
 *   - **thinking**   → settling dots, last transcript shown
 *   - **speaking**   → waveform halo, reply text streams in
 *
 * Push-to-talk: hold `Space` (Esc closes). Click on the mic area
 * also works for trackpad-only users.
 *
 * Keep this component visual-only — all state lives in
 * `useTalkMode`. That means a future "voice indicator badge in
 * topbar" can reuse the same hook and read the same state.
 */
export function TalkModeOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { state, finalTranscript, reply, error, pressPtt, releasePtt, stop } =
    useTalkMode();

  // Global keyboard shortcuts. Space = push-to-talk; Esc = close.
  // We deliberately ignore Space when the user is typing somewhere
  // (e.g. a search input) — the overlay covers everything anyway,
  // but defence in depth.
  useEffect(() => {
    let pressed = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        stop();
        onClose();
        return;
      }
      if (e.code !== 'Space') return;
      // Repeat events fire every keyboard tick while held; we only
      // want the first press to start recording.
      if (pressed) return;
      if (e.repeat) return;
      // Don't hijack Space if focus is on an input / textarea (e.g.
      // a system field bubbling up before our overlay swallowed
      // focus).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      pressed = true;
      pressPtt();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!pressed) return;
      pressed = false;
      e.preventDefault();
      void releasePtt();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onClose, pressPtt, releasePtt, stop]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/95 backdrop-blur-sm"
      data-testid="talk-mode-overlay"
      role="dialog"
      aria-label={t('talk.title', { defaultValue: '语音对话' })}
    >
      {/* Close button — top-right, always visible. */}
      <button
        type="button"
        onClick={() => {
          stop();
          onClose();
        }}
        className="absolute right-6 top-6 rounded-full p-2 text-fg-muted hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('talk.close', { defaultValue: '关闭' })}
        data-testid="talk-close"
      >
        <Icon icon={X} size={18} />
      </button>

      <StateRing state={state} onPress={pressPtt} onRelease={releasePtt} />

      <div className="mt-8 flex w-full max-w-xl flex-col gap-3 px-6 text-center">
        <StateLabel state={state} />
        {finalTranscript && (
          <div
            className="rounded-lg border border-border/40 bg-bg-elev-1 px-4 py-3 text-left text-sm text-fg-muted"
            data-testid="talk-transcript"
          >
            <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
              {t('talk.you_said', { defaultValue: '你说' })}
            </span>
            <span className="mt-0.5 block">{finalTranscript}</span>
          </div>
        )}
        {reply && (
          <div
            className="rounded-lg border border-gold-500/30 bg-gold-500/5 px-4 py-3 text-left text-sm text-fg"
            data-testid="talk-reply"
          >
            <span className="block text-[10px] uppercase tracking-wider text-gold-500">
              Hermes
            </span>
            <span className="mt-0.5 block whitespace-pre-wrap">{reply}</span>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-left text-sm text-danger">
            {error}
          </div>
        )}
      </div>

      <div className="mt-10 flex items-center gap-3 text-[11px] text-fg-subtle">
        <kbd className="rounded border border-border bg-bg-elev-2 px-2 py-0.5 font-mono">
          Space
        </kbd>
        <span>{t('talk.hint_ptt', { defaultValue: '按住说话' })}</span>
        <span className="opacity-50">·</span>
        <kbd className="rounded border border-border bg-bg-elev-2 px-2 py-0.5 font-mono">
          Esc
        </kbd>
        <span>{t('talk.hint_close', { defaultValue: '退出' })}</span>
      </div>
    </div>
  );
}

function StateRing({
  state,
  onPress,
  onRelease,
}: {
  state: TalkState;
  onPress: () => void;
  onRelease: () => void;
}) {
  const colorByState: Record<TalkState, string> = {
    idle: 'border-border bg-bg-elev-1 text-fg-muted',
    listening: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-500 animate-pulse',
    thinking: 'border-amber-500/40 bg-amber-500/5 text-amber-500',
    speaking: 'border-gold-500/60 bg-gold-500/10 text-gold-500',
    error: 'border-danger/60 bg-danger/10 text-danger',
  };
  const iconByState: Record<TalkState, typeof Mic> = {
    idle: Mic,
    listening: Mic,
    thinking: Square,
    speaking: Volume2,
    error: MicOff,
  };
  return (
    <button
      type="button"
      onMouseDown={onPress}
      onMouseUp={() => void onRelease()}
      onTouchStart={onPress}
      onTouchEnd={() => void onRelease()}
      className={`flex h-32 w-32 items-center justify-center rounded-full border-4 transition-colors ${colorByState[state]}`}
      aria-label={`Talk state: ${state}`}
      data-testid="talk-mic"
    >
      <Icon icon={iconByState[state]} size={40} />
    </button>
  );
}

function StateLabel({ state }: { state: TalkState }) {
  const { t } = useTranslation();
  const labelByState: Record<TalkState, string> = {
    idle: t('talk.state_idle', { defaultValue: '准备好了 — 按住 Space 开始说话' }),
    listening: t('talk.state_listening', { defaultValue: '我在听...' }),
    thinking: t('talk.state_thinking', { defaultValue: 'Hermes 正在思考...' }),
    speaking: t('talk.state_speaking', { defaultValue: 'Hermes 正在回答' }),
    error: t('talk.state_error', { defaultValue: '出错了' }),
  };
  return <div className="text-sm text-fg-subtle">{labelByState[state]}</div>;
}
