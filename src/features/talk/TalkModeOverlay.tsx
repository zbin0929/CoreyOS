import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Mic, MicOff, Square, X, Volume2, Settings as SettingsIcon } from 'lucide-react';

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
  const navigate = useNavigate();
  const {
    state,
    mode,
    level,
    finalTranscript,
    reply,
    error,
    readiness,
    setMode,
    pressPtt,
    releasePtt,
    stop,
    cancelTurn,
    micPermission,
    openMicSettings,
  } = useTalkMode();

  // Global keyboard shortcuts. Space = push-to-talk; Esc = close.
  //
  // The press/release tracking lives in a `useRef` (not a useEffect-
  // local `let`) because pressPtt/releasePtt are recreated whenever
  // `state` changes — which happens *during* the keydown handler
  // when state flips from idle → listening. Without the ref, the
  // useEffect re-runs, the local `pressed` resets to false, and the
  // subsequent keyup falls through `if (!pressed) return` → release
  // never fires, recording stays open until something else stops it.
  // Pulling the latest pressPtt/releasePtt out of refs also lets us
  // attach the listeners just once and never re-bind, dodging the
  // race entirely.
  const pressedRef = useRef(false);
  const pressPttRef = useRef(pressPtt);
  const releasePttRef = useRef(releasePtt);
  const stopRef = useRef(stop);
  const onCloseRef = useRef(onClose);
  const modeRef = useRef(mode);
  pressPttRef.current = pressPtt;
  releasePttRef.current = releasePtt;
  stopRef.current = stop;
  onCloseRef.current = onClose;
  modeRef.current = mode;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        stopRef.current();
        onCloseRef.current();
        return;
      }
      if (e.code !== 'Space') return;
      // In auto-listening mode the mic is always live — Space is a
      // no-op so the user can't accidentally double-trigger turns.
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

      <StateRing
        state={state}
        mode={mode}
        level={level}
        onPress={pressPtt}
        onRelease={releasePtt}
      />

      {/* Visible Stop button while a turn is in flight. Sits
          directly under the ring so the user has an obvious
          "make it stop" affordance — Esc and the X corner
          button were too discoverable-by-accident in user
          testing. Hooked to `stop()` (= cancelInFlight + reset)
          so it works for "thinking" (LLM stream still going)
          *and* "speaking" (TTS playing back). */}
      {(state === 'thinking' || state === 'speaking') && (
        <button
          type="button"
          onClick={cancelTurn}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-danger/40 bg-danger/5 px-4 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          data-testid="talk-stop"
          aria-label={t('talk.stop', { defaultValue: '停止' })}
        >
          <Icon icon={Square} size={14} />
          {state === 'thinking'
            ? t('talk.stop_thinking', { defaultValue: '停止生成' })
            : t('talk.stop_speaking', { defaultValue: '停止朗读' })}
        </button>
      )}

      <div className="mt-8 flex w-full max-w-xl flex-col gap-3 px-6 text-center">
        <StateLabel state={state} />
        {state === 'unconfigured' && (
          <div
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-left text-sm text-amber-500"
            data-testid="talk-unconfigured"
          >
            <p>{readiness.reason ?? t('talk.unconfigured', { defaultValue: '语音功能尚未配置' })}</p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-bg px-3 py-1.5 text-xs text-amber-500 hover:bg-amber-500/10"
              onClick={() => {
                stop();
                onClose();
                // Settings has its own section anchors; deep-linking
                // to /settings#voice would be ideal but the page
                // doesn't honour fragment IDs yet, so for now just
                // open the page and the user scrolls.
                navigate({ to: '/settings' });
              }}
            >
              <Icon icon={SettingsIcon} size={12} />
              {t('talk.open_settings', { defaultValue: '前往 Settings › Voice' })}
            </button>
          </div>
        )}
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
              Corey
            </span>
            <span className="mt-0.5 block whitespace-pre-wrap">{reply}</span>
          </div>
        )}
        {micPermission === 'denied' && (
          <div
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-left text-sm text-amber-600 dark:text-amber-400"
            data-testid="talk-mic-denied"
          >
            <p className="font-medium">
              {t('talk.mic_denied_title', {
                defaultValue: '麦克风权限被拒绝',
              })}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {t('talk.mic_denied_body', {
                defaultValue:
                  '系统未授权当前应用访问麦克风。点下方按钮打开「系统设置 → 隐私与安全性 → 麦克风」，开启 Corey 后完全退出应用（Cmd+Q）再重新打开即可。',
              })}
            </p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-bg px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
              onClick={() => {
                void openMicSettings();
              }}
              data-testid="talk-open-mic-settings"
            >
              <Icon icon={SettingsIcon} size={12} />
              {t('talk.mic_denied_open', {
                defaultValue: '打开系统设置 → 麦克风',
              })}
            </button>
          </div>
        )}
        {error && micPermission !== 'denied' && (
          <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-left text-sm text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Footer hint — single sentence, no keyboard kbd
          clutter, no dual-mode toggle in primary view. The user
          arriving in Talk Mode for the first time should just
          start talking; nothing else. The mode toggle moves to
          a small "advanced" button so it's still reachable
          but doesn't distract. */}
      <div className="mt-10 flex flex-col items-center gap-2 text-xs text-fg-subtle">
        <span>
          {mode === 'auto'
            ? t('talk.hint_auto', {
                defaultValue: '直接说话即可，停顿后自动发送',
              })
            : t('talk.hint_ptt', {
                defaultValue: '按住中央按钮（或 Space）说话，松开发送',
              })}
        </span>
        <button
          type="button"
          onClick={() => setMode(mode === 'auto' ? 'ptt' : 'auto')}
          className="text-[10px] text-fg-subtle/70 underline-offset-2 hover:text-fg-muted hover:underline"
          data-testid="talk-mode-toggle"
          aria-label={t('talk.mode_toggle', { defaultValue: '切换说话模式' })}
        >
          {mode === 'auto'
            ? t('talk.mode_switch_to_ptt', {
                defaultValue: '切换为按键说话（嘈杂环境推荐）',
              })
            : t('talk.mode_switch_to_auto', {
                defaultValue: '切换为持续监听',
              })}
        </button>
      </div>
    </div>
  );
}

function StateRing({
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
  // Auto-mode VU halo: scale a glowing ring with the live RMS
  // level. Cap at 1.5× so a hard "AAA" doesn't blow past the
  // overlay bounds; clamp a small floor so it never collapses
  // entirely (gives the eye something to lock onto).
  const haloScale = mode === 'auto' ? Math.min(1.5, 1 + Math.max(0, level) * 4) : 0;

  // PTT mode keeps mouse/touch handlers; auto mode disables them
  // since the mic is always live.
  const interactive = mode === 'ptt';

  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {mode === 'auto' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500/40 transition-transform duration-100"
          style={{ transform: `scale(${haloScale})`, opacity: 0.4 + Math.min(0.5, level * 2) }}
          data-testid="talk-vu-halo"
        />
      )}
      {/* PTT listening halo — voice_record doesn't emit RMS so we
          can't show a real VU bar, but we can still tell the user
          "yes, recording is on" with two animated rings expanding
          outward at staggered intervals. CSS-only, no JS timers. */}
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
        className={`relative flex h-32 w-32 items-center justify-center rounded-full border-4 transition-colors ${colorByState[state]} ${interactive ? '' : 'cursor-default'}`}
        aria-label={`Talk state: ${state}`}
        data-testid="talk-mic"
      >
        <Icon icon={iconByState[state]} size={40} />
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
  // Animated trailing dots while thinking/speaking so the user
  // sees that work is in progress even when the streaming text
  // box hasn't filled in yet (the gap between PTT release and
  // first LLM token is typically 400-1500ms, plenty of time for
  // the user to wonder if the app froze). Pure CSS — no React
  // re-renders, no extra timers.
  const animated = state === 'thinking' || state === 'speaking';
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-fg-subtle">
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
